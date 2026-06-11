import { timingSafeEqual } from 'crypto';

export const ADMIN_COOKIE_NAME = 'ait_crm_admin';
export const ADMIN_HEADER_NAME = 'x-ait-admin-token';
export const ADMIN_TOKEN_ENV = 'AIT_CRM_ADMIN_TOKEN';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getConfiguredAdminToken() {
  return process.env[ADMIN_TOKEN_ENV] || '';
}

export function hasConfiguredAdminToken() {
  return Boolean(getConfiguredAdminToken());
}

export function isAdminTokenUnlockEnabled() {
  if (process.env.ENABLE_IMPORT_REVIEW_ADMIN_UNLOCK === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

export function isValidAdminToken(value) {
  const expected = getConfiguredAdminToken();
  if (!expected || !value) return false;
  return safeEqual(value, expected);
}

export function getRequestAdminToken(request) {
  const bearer = request.headers.get('authorization') || '';
  if (bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim();
  }

  const headerToken = request.headers.get(ADMIN_HEADER_NAME);
  if (headerToken) return headerToken.trim();

  return request.cookies?.get(ADMIN_COOKIE_NAME)?.value || '';
}

export function isImportReviewAdmin(request) {
  if (!isAdminTokenUnlockEnabled()) return false;
  return isValidAdminToken(getRequestAdminToken(request));
}
