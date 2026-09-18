import { NextResponse } from 'next/server';

import { getPool } from '@/db/index.js';
import { createHostedCollectionLink } from '@/lib/collections/service.js';
import { resolveAitUsaEventBusinessUnit } from '@/lib/ingestion/website-leads.js';
import { orchestrateRegistration } from '@/lib/registration/action.js';
import {
  assertPublicRegistrationProgram,
  createPreviewRegistrationAdapter,
  createPublicRegistrationQuote,
  loadPublicRegistrationStatus,
  normalizeReturnState,
  PublicRegistrationError,
  verifyPublicRegistrationSecret,
} from '@/lib/registration/public-service.js';

const SECRET_HEADER = 'x-ait-registration-secret';
const MAX_BODY_BYTES = 32_768;

function clean(value) { return String(value || '').trim(); }
function enabled(value) { return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase()); }

function errorResponse(error) {
  const status = Number(error?.status) || 500;
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  return NextResponse.json({
    error: {
      code: error?.code || 'registration_unavailable',
      message: safeStatus >= 500 ? 'Registration is temporarily unavailable.' : error.message,
    },
  }, { status: safeStatus, headers: { 'Cache-Control': 'private, no-store' } });
}

async function body(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new PublicRegistrationError('request_too_large', 'Registration request is too large.', 413);
  let raw = '';
  let total = 0;
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new PublicRegistrationError('request_too_large', 'Registration request is too large.', 413);
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  }
  const value = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicRegistrationError('request_invalid', 'Registration request must be a JSON object.');
  }
  return value;
}

function siteOrigin() {
  let parsed;
  try { parsed = new URL(clean(process.env.AITUSA_REGISTRATION_SITE_ORIGIN)); } catch {
    throw new PublicRegistrationError('registration_site_unconfigured', 'Registration site origin is not configured.', 503);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new PublicRegistrationError('registration_site_unconfigured', 'Registration site origin must be secure.', 503);
  }
  return parsed.origin;
}

function crmOrigin(request) {
  const host = process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  return host ? `https://${clean(host).replace(/^https?:\/\//, '').replace(/\/$/, '')}` : new URL(request.url).origin;
}

async function scope(client) {
  const businessUnit = await resolveAitUsaEventBusinessUnit(client, {
    reviewBusinessUnit: process.env.AITUSA_REGISTRATION_BUSINESS_UNIT || process.env.AITUSA_REVIEW_BUSINESS_UNIT || 'AIT USA Institute',
  });
  if (!businessUnit?.id || !businessUnit.organization_id) {
    throw new PublicRegistrationError('registration_scope_unavailable', 'AIT USA registration scope is unavailable.', 503);
  }
  return { organizationId: businessUnit.organization_id, businessUnitId: businessUnit.id };
}

function customerUrls(origin, state) {
  const encoded = encodeURIComponent(state);
  return {
    returnUrl: `${origin}/inscribete/?payment=return&state=${encoded}`,
    failureUrl: `${origin}/inscribete/?payment=failed&state=${encoded}`,
    cancelUrl: `${origin}/inscribete/?payment=cancelled&state=${encoded}`,
  };
}

export async function POST(request) {
  if (!verifyPublicRegistrationSecret(request.headers.get(SECRET_HEADER), process.env.AITUSA_REGISTRATION_SHARED_SECRET)) {
    return errorResponse(new PublicRegistrationError('registration_unauthorized', 'Registration service authorization failed.', 401));
  }
  let client;
  try {
    const input = await body(request);
    if (input.action === 'quote') {
      return NextResponse.json(createPublicRegistrationQuote(input), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    client = await getPool().connect();
    const registrationScope = await scope(client);
    if (input.action === 'create') {
      const programCode = assertPublicRegistrationProgram(input.registration?.programCode);
      const result = await orchestrateRegistration(client, {
        ...input.registration,
        ...registrationScope,
        channel: 'public',
        programCode,
        actor: {
          portalAccountId: clean(input.actor?.portalAccountId) || null,
          verifiedCrmContactIds: [],
        },
      });
      return NextResponse.json({ result }, {
        status: result.duplicate ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (input.action === 'hosted_link') {
      const returnState = normalizeReturnState(input.returnState);
      const origin = siteOrigin();
      const fakeProvider = enabled(process.env.AITUSA_REGISTRATION_FAKE_PROVIDER);
      if (process.env.VERCEL_ENV === 'production' && fakeProvider) {
        throw new PublicRegistrationError('preview_provider_forbidden', 'Preview payment mode is unavailable in production.', 503);
      }
      const result = await createHostedCollectionLink(client, {
        ...registrationScope,
        paymentRequestId: input.paymentRequestId,
        idempotencyKey: input.idempotencyKey,
        environment: process.env.VERCEL_ENV === 'production' ? 'production' : 'uat',
        baseUrl: crmOrigin(request),
        customerUrls: customerUrls(origin, returnState),
        requiredSourceType: 'registration',
        adapter: fakeProvider ? createPreviewRegistrationAdapter({ siteOrigin: origin, returnState }) : undefined,
      });
      return NextResponse.json({ result }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (input.action === 'status') {
      const result = await loadPublicRegistrationStatus(client, registrationScope, input.paymentRequestId);
      return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    throw new PublicRegistrationError('registration_action_invalid', 'Registration action is not supported.');
  } catch (error) {
    return errorResponse(error);
  } finally {
    client?.release();
  }
}
