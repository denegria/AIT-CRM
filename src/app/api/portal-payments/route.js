import { NextResponse } from 'next/server';

import { getPool } from '@/db/index.js';
import { resolveAitUsaEventBusinessUnit } from '@/lib/ingestion/website-leads.js';
import {
  createPortalHostedLink,
  createPortalPaymentRequest,
  createPreviewPortalPaymentsAdapter,
  loadPortalPaymentStatus,
  loadPortalPaymentsSnapshot,
  verifyPortalPaymentsSecret,
} from '@/lib/portal-payments/service.js';
import { PortalPaymentsError } from '@/lib/portal-payments/model.js';

const SECRET_HEADER = 'x-ait-portal-payments-secret';
const MAX_BODY_BYTES = 16_384;
const RETURN_STATE_PATTERN = /^[A-Za-z0-9._~-]{20,2048}$/;

function clean(value) { return String(value || '').trim(); }
function enabled(value) { return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase()); }

function responseError(error) {
  const status = Number(error?.status) || 500;
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  return NextResponse.json({
    error: {
      code: error?.code || 'portal_payments_unavailable',
      message: safeStatus >= 500 ? 'Portal payments are temporarily unavailable.' : error.message,
      details: safeStatus < 500 ? error?.details || {} : {},
    },
  }, { status: safeStatus, headers: { 'Cache-Control': 'private, no-store' } });
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new PortalPaymentsError('request_too_large', 'Payment request is too large.', 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new PortalPaymentsError('request_too_large', 'Payment request is too large.', 413);
  let value;
  try { value = JSON.parse(raw); } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortalPaymentsError('request_invalid', 'Payment request must be a JSON object.');
  }
  return value;
}

async function scope(client) {
  const businessUnit = await resolveAitUsaEventBusinessUnit(client, {
    reviewBusinessUnit: process.env.AITUSA_PORTAL_PAYMENTS_BUSINESS_UNIT || process.env.AITUSA_REVIEW_BUSINESS_UNIT || 'AIT USA Institute',
  });
  if (!businessUnit?.id || !businessUnit.organization_id) {
    throw new PortalPaymentsError('portal_payments_scope_unavailable', 'Portal payment scope is unavailable.', 503);
  }
  return { organizationId: businessUnit.organization_id, businessUnitId: businessUnit.id };
}

function crmOrigin(request) {
  const host = process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  return host ? `https://${clean(host).replace(/^https?:\/\//, '').replace(/\/$/, '')}` : new URL(request.url).origin;
}

function siteOrigin() {
  let parsed;
  try { parsed = new URL(clean(process.env.AITUSA_PORTAL_SITE_ORIGIN)); } catch {
    throw new PortalPaymentsError('portal_site_unconfigured', 'Portal site origin is not configured.', 503);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new PortalPaymentsError('portal_site_unconfigured', 'Portal site origin must be secure.', 503);
  }
  return parsed.origin;
}

function customerUrls(origin, state) {
  const token = clean(state);
  if (!RETURN_STATE_PATTERN.test(token)) throw new PortalPaymentsError('return_state_invalid', 'Payment return state is invalid.');
  const encoded = encodeURIComponent(token);
  return {
    returnUrl: `${origin}/portal/payments/?payment=return&state=${encoded}`,
    failureUrl: `${origin}/portal/payments/?payment=failed&state=${encoded}`,
    cancelUrl: `${origin}/portal/payments/?payment=cancelled&state=${encoded}`,
  };
}

export async function POST(request) {
  if (!verifyPortalPaymentsSecret(request.headers.get(SECRET_HEADER), process.env.AITUSA_PORTAL_PAYMENTS_SHARED_SECRET)) {
    return responseError(new PortalPaymentsError('portal_payments_unauthorized', 'Portal payment authorization failed.', 401));
  }
  let client;
  try {
    const input = await readBody(request);
    client = await getPool().connect();
    const paymentScope = await scope(client);
    const identity = input.identity;
    if (input.action === 'snapshot') {
      const result = await loadPortalPaymentsSnapshot(client, paymentScope, identity);
      return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (input.action === 'create_request') {
      const result = await createPortalPaymentRequest(client, paymentScope, identity, input.payment);
      return NextResponse.json({ result }, { status: result.duplicate ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (input.action === 'hosted_link') {
      const origin = siteOrigin();
      const fakeProvider = enabled(process.env.AITUSA_PORTAL_PAYMENTS_FAKE_PROVIDER);
      if (process.env.VERCEL_ENV === 'production' && fakeProvider) {
        throw new PortalPaymentsError('preview_provider_forbidden', 'Preview payment mode is unavailable in production.', 503);
      }
      const result = await createPortalHostedLink(client, paymentScope, identity, {
        paymentRequestId: input.paymentRequestId,
        idempotencyKey: input.idempotencyKey,
        environment: process.env.VERCEL_ENV === 'production' ? 'production' : 'uat',
        baseUrl: crmOrigin(request),
        customerUrls: customerUrls(origin, input.returnState),
        adapter: fakeProvider ? createPreviewPortalPaymentsAdapter({ siteOrigin: origin, returnState: input.returnState }) : undefined,
      });
      return NextResponse.json({ result }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (input.action === 'status') {
      const result = await loadPortalPaymentStatus(client, paymentScope, identity, input.paymentRequestId);
      return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    throw new PortalPaymentsError('portal_payment_action_invalid', 'Payment action is not supported.');
  } catch (error) {
    return responseError(error);
  } finally {
    client?.release();
  }
}
