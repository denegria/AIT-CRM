import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanPortalIdentity,
  normalizePortalPaymentIntent,
  portalPaymentState,
} from './model.js';

test('portal identity requires an opaque account id and verified email shape', () => {
  assert.deepEqual(cleanPortalIdentity({
    accountId: '11000000-0000-4000-8000-000000000001',
    email: ' Student@Example.com ',
  }), {
    accountId: '11000000-0000-4000-8000-000000000001',
    email: 'student@example.com',
  });
  assert.throws(() => cleanPortalIdentity({ accountId: 'student', email: 'student@example.com' }), /invalid/);
});

test('payment intent enforces provider minimum and safe idempotency', () => {
  assert.equal(normalizePortalPaymentIntent({
    chargeId: '22000000-0000-4000-8000-000000000002',
    amount: '1.00',
    idempotencyKey: 'portal-payment:fixture-1',
  }).amountCents, 100);
  assert.throws(() => normalizePortalPaymentIntent({
    chargeId: '22000000-0000-4000-8000-000000000002',
    amount: '0.99',
    idempotencyKey: 'portal-payment:fixture-2',
  }), /at least \$1\.00/);
});

test('pending never becomes paid without a verified transaction', () => {
  assert.equal(portalPaymentState({ request_status: 'pending' }), 'verifying');
  assert.equal(portalPaymentState({ request_status: 'completed', transaction_status: 'pending' }), 'verifying');
  assert.equal(portalPaymentState({ request_status: 'completed', transaction_status: 'verified' }), 'confirmed');
  assert.equal(portalPaymentState({ request_status: 'pending', transaction_status: 'failed' }), 'declined');
});
