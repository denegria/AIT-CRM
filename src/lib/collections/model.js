const QUEUE_STATES = new Set(['due', 'partially_paid', 'overdue']);
const MANUAL_METHODS = new Set(['cash', 'check', 'bank_transfer', 'money_order', 'zelle', 'other']);
const PAYMENT_INTENTS = new Set(['charge', 'account_credit']);
const SAFE_KEY = /^[A-Za-z0-9._:-]{12,160}$/;

export class CollectionsError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'CollectionsError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeQueueState(value) {
  const state = text(value, 40).toLowerCase() || 'due';
  if (!QUEUE_STATES.has(state)) {
    throw new CollectionsError('queue_state_invalid', 'Queue must be due, partially paid, or overdue.');
  }
  return state;
}

export function normalizeQueuePage({ page, pageSize } = {}) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedSize = Number.parseInt(pageSize, 10);
  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize: Number.isInteger(parsedSize) && parsedSize > 0 ? Math.min(parsedSize, 50) : 25,
  };
}

export function moneyToCents(value, label = 'Amount') {
  const normalized = text(value, 30);
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new CollectionsError('amount_invalid', `${label} must be a positive dollar amount with at most two decimals.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const cents = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CollectionsError('amount_invalid', `${label} must be greater than zero.`);
  }
  return Number(cents);
}

export function centsToMoney(cents) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function normalizeManualPayment(input = {}) {
  const method = text(input.method, 40).toLowerCase();
  if (!MANUAL_METHODS.has(method)) {
    throw new CollectionsError('manual_method_invalid', 'Manual payments must use a supported non-card method.');
  }
  const idempotencyKey = text(input.idempotencyKey, 160);
  if (!SAFE_KEY.test(idempotencyKey)) {
    throw new CollectionsError('idempotency_key_invalid', 'A safe idempotency key is required.');
  }
  const reference = text(input.reference, 120);
  if (['check', 'bank_transfer', 'money_order', 'zelle'].includes(method) && !reference) {
    throw new CollectionsError('manual_reference_required', 'A reference is required for this payment method.');
  }
  return Object.freeze({
    chargeId: text(input.chargeId, 80),
    amountCents: moneyToCents(input.amount),
    method,
    reference: reference || null,
    note: text(input.note, 1000) || null,
    idempotencyKey,
  });
}

export function normalizeStaffPaymentRequest(input = {}) {
  const intent = text(input.intent, 40).toLowerCase();
  if (!PAYMENT_INTENTS.has(intent)) {
    throw new CollectionsError('payment_intent_invalid', 'Payment must cover an existing charge or account credit.');
  }
  const studentContactId = text(input.studentContactId, 80);
  if (!studentContactId) throw new CollectionsError('student_required', 'Student is required.');
  const payerContactId = text(input.payerContactId, 80) || studentContactId;
  const chargeId = text(input.chargeId, 80) || null;
  if (intent === 'charge' && !chargeId) {
    throw new CollectionsError('charge_required', 'Choose the balance or future installment this payment covers.');
  }
  if (intent === 'account_credit' && chargeId) {
    throw new CollectionsError('credit_charge_conflict', 'Account credit cannot name a charge.');
  }
  const idempotencyKey = text(input.idempotencyKey, 160);
  if (!SAFE_KEY.test(idempotencyKey)) {
    throw new CollectionsError('idempotency_key_invalid', 'A safe idempotency key is required.');
  }
  return Object.freeze({
    intent,
    studentContactId,
    payerContactId,
    chargeId,
    amountCents: moneyToCents(input.amount),
    note: text(input.note, 1000) || null,
    idempotencyKey,
  });
}

export function normalizeHostedLinkInput(input = {}) {
  const paymentRequestId = text(input.paymentRequestId, 80);
  const idempotencyKey = text(input.idempotencyKey, 160);
  if (!paymentRequestId) throw new CollectionsError('payment_request_required', 'Payment request is required.');
  if (!SAFE_KEY.test(idempotencyKey)) {
    throw new CollectionsError('idempotency_key_invalid', 'A safe idempotency key is required.');
  }
  return Object.freeze({ paymentRequestId, idempotencyKey });
}

export const COLLECTION_QUEUE_STATES = Object.freeze([...QUEUE_STATES]);
export const COLLECTION_MANUAL_METHODS = Object.freeze([...MANUAL_METHODS]);
export const COLLECTION_PAYMENT_INTENTS = Object.freeze([...PAYMENT_INTENTS]);
