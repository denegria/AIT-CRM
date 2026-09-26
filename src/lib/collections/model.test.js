import assert from 'node:assert/strict';
import test from 'node:test';

import {
  centsToMoney,
  moneyToCents,
  normalizeHostedLinkInput,
  normalizeManualPayment,
  normalizeQueuePage,
  normalizeQueueState,
  normalizeStaffPaymentRequest,
} from './model.js';

test('collection queue accepts only operational balance states', () => {
  assert.equal(normalizeQueueState('partialLY_paid'), 'partially_paid');
  assert.throws(() => normalizeQueueState('paid'), /due, partially paid, or overdue/);
  assert.deepEqual(normalizeQueuePage({ page: '-2', pageSize: '500' }), { page: 1, pageSize: 50 });
});

test('money remains exact in integer cents', () => {
  assert.equal(moneyToCents('95'), 9500);
  assert.equal(moneyToCents('145.50'), 14550);
  assert.equal(centsToMoney(14550), '145.50');
  assert.throws(() => moneyToCents('10.001'), /at most two decimals/);
});

test('manual payment rejects card entry and requires references for traceable methods', () => {
  assert.throws(() => normalizeManualPayment({
    chargeId: 'charge-1', amount: '10', method: 'card', idempotencyKey: 'collections:manual:123',
  }), /non-card/);
  assert.throws(() => normalizeManualPayment({
    chargeId: 'charge-1', amount: '10', method: 'check', idempotencyKey: 'collections:manual:123',
  }), /reference is required/i);
  assert.deepEqual(normalizeManualPayment({
    chargeId: 'charge-1', amount: '10.25', method: 'check', reference: '1042',
    idempotencyKey: 'collections:manual:123', note: 'front desk',
  }), {
    chargeId: 'charge-1', amountCents: 1025, method: 'check', reference: '1042',
    idempotencyKey: 'collections:manual:123', note: 'front desk',
  });
});

test('hosted links require safe idempotency keys', () => {
  assert.deepEqual(normalizeHostedLinkInput({
    paymentRequestId: 'request-1', idempotencyKey: 'collections:hpp:123',
  }), { paymentRequestId: 'request-1', idempotencyKey: 'collections:hpp:123' });
  assert.throws(() => normalizeHostedLinkInput({ paymentRequestId: 'request-1', idempotencyKey: 'short' }), /safe idempotency/);
});

test('staff payment requests keep payment intent separate from method', () => {
  assert.deepEqual(normalizeStaffPaymentRequest({
    intent: 'charge',
    studentContactId: 'student-1',
    payerContactId: 'payer-1',
    chargeId: 'charge-1',
    amount: '50.25',
    note: 'Front desk partial payment',
    idempotencyKey: 'payments:request:fixture-1',
  }), {
    intent: 'charge',
    studentContactId: 'student-1',
    payerContactId: 'payer-1',
    chargeId: 'charge-1',
    amountCents: 5025,
    note: 'Front desk partial payment',
    idempotencyKey: 'payments:request:fixture-1',
  });
  assert.deepEqual(normalizeStaffPaymentRequest({
    intent: 'account_credit',
    studentContactId: 'student-1',
    amount: '200',
    idempotencyKey: 'payments:request:fixture-2',
  }), {
    intent: 'account_credit',
    studentContactId: 'student-1',
    payerContactId: 'student-1',
    chargeId: null,
    amountCents: 20000,
    note: null,
    idempotencyKey: 'payments:request:fixture-2',
  });
  assert.throws(() => normalizeStaffPaymentRequest({
    intent: 'charge', studentContactId: 'student-1', amount: '10', idempotencyKey: 'payments:request:fixture-3',
  }), /Choose the balance/);
  assert.throws(() => normalizeStaffPaymentRequest({
    intent: 'account_credit', studentContactId: 'student-1', chargeId: 'charge-1', amount: '10',
    idempotencyKey: 'payments:request:fixture-4',
  }), /cannot name a charge/);
});
