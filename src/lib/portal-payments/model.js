const SAFE_KEY = /^[A-Za-z0-9._:-]{12,160}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PORTAL_PAYMENT_MINIMUM_CENTS = 100;

export class PortalPaymentsError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'PortalPaymentsError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function cleanPortalIdentity(input = {}) {
  const accountId = String(input.accountId || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  if (!UUID.test(accountId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PortalPaymentsError('portal_identity_invalid', 'Portal identity is invalid.', 401);
  }
  return Object.freeze({ accountId, email });
}

export function moneyToCents(value, label = 'Amount') {
  const normalized = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new PortalPaymentsError('amount_invalid', `${label} must be a dollar amount with at most two decimals.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const cents = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PortalPaymentsError('amount_invalid', `${label} is too large.`);
  }
  return Number(cents);
}

export function centsToMoney(cents) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function normalizePortalPaymentIntent(input = {}) {
  const chargeId = String(input.chargeId || '').trim();
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!UUID.test(chargeId)) {
    throw new PortalPaymentsError('charge_invalid', 'Charge is invalid.');
  }
  if (!SAFE_KEY.test(idempotencyKey)) {
    throw new PortalPaymentsError('idempotency_key_invalid', 'A safe idempotency key is required.');
  }
  const amountCents = moneyToCents(input.amount);
  if (amountCents < PORTAL_PAYMENT_MINIMUM_CENTS) {
    throw new PortalPaymentsError('amount_below_minimum', 'Payment must be at least $1.00.');
  }
  return Object.freeze({ chargeId, idempotencyKey, amountCents });
}

export function portalPaymentState(row = {}) {
  const request = String(row.request_status || row.requestStatus || '').toLowerCase();
  const transaction = String(row.transaction_status || row.transactionStatus || '').toLowerCase();
  if (request === 'completed' && transaction === 'verified') return 'confirmed';
  if (['failed', 'declined', 'voided'].includes(transaction) || request === 'failed') return 'declined';
  if (['cancelled', 'canceled'].includes(request)) return 'cancelled';
  if (request === 'expired' || (row.expires_at && new Date(row.expires_at).getTime() < Date.now())) return 'expired';
  return 'verifying';
}
