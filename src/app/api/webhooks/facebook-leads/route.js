import { NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  FB_APP_SECRET_ENV,
  FB_VERIFY_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_MAP_ENV,
  META_PAGE_BUSINESS_UNIT_MAP_ENV,
  META_VERIFY_TOKEN_ENV,
  createMetaProviderConfig,
  flattenMetaLeadgenChanges,
  flattenMetaMessengerEvents,
  validateMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from '@/lib/messaging/providers/meta.js';
import { ingestFacebookLeadAdsEvents } from '@/lib/ingestion/facebook-lead-ads.js';
import { ingestMessengerInboundEvents } from '@/lib/ingestion/messenger-inbound.js';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getMetaProviderConfig() {
  return createMetaProviderConfig({
    facebookVerifyToken: process.env[FB_VERIFY_TOKEN_ENV],
    metaVerifyToken: process.env[META_VERIFY_TOKEN_ENV],
    appSecret: process.env[FB_APP_SECRET_ENV],
    defaultPageAccessToken: process.env[META_PAGE_ACCESS_TOKEN_ENV],
    pageAccessTokenMapRaw: process.env[META_PAGE_ACCESS_TOKEN_MAP_ENV],
    pageBusinessUnitMapRaw: process.env[META_PAGE_BUSINESS_UNIT_MAP_ENV],
  });
}

function verifyTokenConfigured(metaConfig) {
  return Boolean(metaConfig.verifyToken);
}

function verifyTokenErrorMessage() {
  return `${FB_VERIFY_TOKEN_ENV} or ${META_VERIFY_TOKEN_ENV} is required before Facebook lead webhook verification can run.`;
}

function appSecretConfigured(metaConfig) {
  return Boolean(metaConfig.appSecret);
}

function appSecretErrorMessage() {
  return `${FB_APP_SECRET_ENV} is required before Facebook lead webhook POST processing can run.`;
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return { inserted: 0, skipped: 0, received: 0, reason: 'DATABASE_URL missing' };
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function resolveOrganizationId(client) {
  const result = await client.query('select id from organizations order by created_at asc limit 1');
  return result.rows[0]?.id || null;
}

function aggregateWebhookResults({ received, leadResult, messengerResult }) {
  const reasons = [leadResult.reason, messengerResult.reason].filter(Boolean);
  return {
    received,
    inserted: leadResult.inserted + messengerResult.inserted,
    promoted: leadResult.promoted + messengerResult.promoted,
    linked: messengerResult.linked,
    review: (leadResult.eventResults || []).filter((event) => event.review).length + messengerResult.review,
    graphFetched: leadResult.graphFetched,
    profileFetched: messengerResult.profileFetched,
    skipped: leadResult.skipped + messengerResult.skipped,
    leadBatchId: leadResult.batchId,
    messengerBatchId: messengerResult.batchId,
    eventResults: {
      leadgen: leadResult.eventResults || [],
      messenger: messengerResult.eventResults || [],
    },
    ...(reasons.length ? { reason: reasons.join('; ') } : {}),
  };
}

export async function GET(request) {
  const metaConfig = getMetaProviderConfig();
  if (!verifyTokenConfigured(metaConfig)) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }

  const url = new URL(request.url);
  const verification = verifyMetaWebhookChallenge({
    mode: url.searchParams.get('hub.mode'),
    verifyToken: url.searchParams.get('hub.verify_token'),
    challenge: url.searchParams.get('hub.challenge'),
    config: metaConfig,
  });

  if (verification.ok) {
    return new NextResponse(verification.challenge, { status: 200 });
  }

  return jsonError('Verification token mismatch.', 403);
}

export async function POST(request) {
  const metaConfig = getMetaProviderConfig();
  if (!verifyTokenConfigured(metaConfig)) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }
  if (!appSecretConfigured(metaConfig)) {
    return jsonError(appSecretErrorMessage(), 503);
  }

  const signature = request.headers.get('x-hub-signature-256');
  const rawBody = await request.text();
  if (!validateMetaAppSecretSignature({ bodyText: rawBody, signatureHeader: signature, config: metaConfig }).ok) {
    return jsonError('Invalid Facebook webhook signature.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError('Invalid JSON payload.', 400);
  }

  const leadgenEvents = flattenMetaLeadgenChanges(payload);
  const messengerEvents = flattenMetaMessengerEvents(payload);
  if (!leadgenEvents.length && !messengerEvents.length) {
    return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped: 0 });
  }

  const result = await withClient(async (client) => {
    const organizationId = await resolveOrganizationId(client);
    const received = leadgenEvents.length + messengerEvents.length;
    if (!organizationId) return { inserted: 0, skipped: received, received, reason: 'No organization found' };

    const leadResult = await ingestFacebookLeadAdsEvents(client, {
      organizationId,
      events: leadgenEvents,
      metaConfig,
    });
    const messengerResult = await ingestMessengerInboundEvents(client, {
      organizationId,
      events: messengerEvents,
      metaConfig,
    });

    return aggregateWebhookResults({ received, leadResult, messengerResult });
  });

  return NextResponse.json({ ok: true, ...result });
}
