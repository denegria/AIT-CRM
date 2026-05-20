import { createHmac, timingSafeEqual } from 'crypto';
import { SESSION_SECRET_ENV } from '@/lib/auth';

export const SIGNUP_INVITE_VERSION = 1;

function getInviteSecret() {
  return process.env[SESSION_SECRET_ENV] || '';
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signPayload(payload, secret = getInviteSecret()) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSignupInviteToken(payload, secret = getInviteSecret()) {
  if (!secret) throw new Error(`${SESSION_SECRET_ENV} is required to create signup invites.`);
  const encodedPayload = encodeJson({
    ...payload,
    version: SIGNUP_INVITE_VERSION,
  });
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifySignupInviteToken(token, secret = getInviteSecret()) {
  if (!secret) return { ok: false, error: 'Signup invites are not configured.' };

  const [encodedPayload, signature, extra] = String(token || '').split('.');
  if (!encodedPayload || !signature || extra) {
    return { ok: false, error: 'Invalid signup link.' };
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, error: 'Invalid signup link.' };
  }

  let payload;
  try {
    payload = decodeJson(encodedPayload);
  } catch {
    return { ok: false, error: 'Invalid signup link.' };
  }

  if (payload?.version !== SIGNUP_INVITE_VERSION) {
    return { ok: false, error: 'Unsupported signup link.' };
  }

  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) {
    return { ok: false, error: 'Signup link expired.' };
  }

  return { ok: true, payload };
}
