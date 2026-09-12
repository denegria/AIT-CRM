import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizedContactIdentity } from './contact-identity.js';

const MAX_AGE_MS = 10 * 60 * 1000;

function secret(env = process.env) {
  return String(env.CRM_MANUAL_CONFIRMATION_SECRET || env.AUTH_SECRET || '').trim();
}

function payload(input = {}) {
  const identity = normalizedContactIdentity(input.contactValues);
  return {
    organizationId: String(input.organizationId || ''),
    actorUserId: String(input.actorUserId || ''),
    businessUnitId: String(input.businessUnitId || ''),
    contactId: String(input.contactId || ''),
    email: identity.email,
    phone: identity.phone,
    expiresAt: Number(input.expiresAt || 0),
  };
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(value, key) {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function issueManualAitUsaConfirmation(input, env = process.env, now = Date.now()) {
  const key = secret(env);
  if (!key) return '';
  const body = encoded(payload({ ...input, expiresAt: now + MAX_AGE_MS }));
  return `${body}.${signature(body, key)}`;
}

export function verifyManualAitUsaConfirmation(token, input, env = process.env, now = Date.now()) {
  const key = secret(env);
  const [body, received] = String(token || '').split('.');
  if (!key || !body || !received) return false;
  const expected = signature(body, key);
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const expectedPayload = payload({ ...input, expiresAt: decoded.expiresAt });
    return decoded.expiresAt > now && JSON.stringify(decoded) === JSON.stringify(expectedPayload);
  } catch {
    return false;
  }
}

export const manualAitUsaConfirmationMaxAgeMs = MAX_AGE_MS;
