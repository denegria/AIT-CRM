import { timingSafeEqual } from 'node:crypto';

export const OAUTH_STATE_COOKIE = 'ait_crm_oauth_state';
export const OAUTH_INVITATION_COOKIE = 'ait_crm_invitation_token';
export const OAUTH_RETURN_TO_COOKIE = 'ait_crm_oauth_return_to';

export function equalOAuthState(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length >= 32
    && leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function safeOAuthReturnTo(value) {
  const path = String(value || '');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}
