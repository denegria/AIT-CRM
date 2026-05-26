import { NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  FB_APP_SECRET_ENV,
  META_APP_SECRET_ENV,
  META_VERIFY_TOKEN_ENV,
  META_WHATSAPP_BUSINESS_UNIT_MAP_ENV,
  WHATSAPP_APP_SECRET_ENV,
  WHATSAPP_VERIFY_TOKEN_ENV,
  createMetaProviderConfig,
  flattenMetaWhatsAppMessages,
  validateMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from '@/lib/messaging/providers/meta.js';
import { ingestWhatsAppInboundEvents } from '@/lib/ingestion/whatsapp-inbound.js';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getWhatsAppProviderConfig() {
  return createMetaProviderConfig({
    whatsappVerifyToken: process.env[WHATSAPP_VERIFY_TOKEN_ENV],
    metaVerifyToken: process.env[META_VERIFY_TOKEN_ENV],
    appSecret: process.env[WHATSAPP_APP_SECRET_ENV]
      || process.env[META_APP_SECRET_ENV]
      || process.env[FB_APP_SECRET_ENV],
    whatsappBusinessUnitMapRaw: process.env[META_WHATSAPP_BUSINESS_UNIT_MAP_ENV],
  });
}

function verifyTokenConfigured(metaConfig) {
  return Boolean(metaConfig.verifyToken);
}

function verifyTokenErrorMessage() {
  return `${WHATSAPP_VERIFY_TOKEN_ENV} or ${META_VERIFY_TOKEN_ENV} is required before WhatsApp webhook verification can run.`;
}

function appSecretConfigured(metaConfig) {
  return Boolean(metaConfig.appSecret);
}

function appSecretErrorMessage() {
  return `${WHATSAPP_APP_SECRET_ENV}, ${META_APP_SECRET_ENV}, or ${FB_APP_SECRET_ENV} is required before WhatsApp webhook POST processing can run.`;
}

async function withClient(handler) {
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

export async function GET(request) {
  const metaConfig = getWhatsAppProviderConfig();
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
  const metaConfig = getWhatsAppProviderConfig();
  if (!verifyTokenConfigured(metaConfig)) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }
  if (!appSecretConfigured(metaConfig)) {
    return jsonError(appSecretErrorMessage(), 503);
  }
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required before WhatsApp webhook POST processing can run.', 503);
  }

  const signature = request.headers.get('x-hub-signature-256');
  const rawBody = await request.text();
  if (!validateMetaAppSecretSignature({ bodyText: rawBody, signatureHeader: signature, config: metaConfig }).ok) {
    return jsonError('Invalid WhatsApp webhook signature.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError('Invalid JSON payload.', 400);
  }

  const whatsappEvents = flattenMetaWhatsAppMessages(payload);
  if (!whatsappEvents.length) {
    return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped: 0 });
  }

  try {
    const result = await withClient(async (client) => {
      const organizationId = await resolveOrganizationId(client);
      const received = whatsappEvents.length;
      if (!organizationId) return { inserted: 0, skipped: received, received, reason: 'No organization found' };

      return ingestWhatsAppInboundEvents(client, {
        organizationId,
        events: whatsappEvents,
        metaConfig,
      });
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error.message || 'Failed to ingest WhatsApp webhook.', 500);
  }
}
