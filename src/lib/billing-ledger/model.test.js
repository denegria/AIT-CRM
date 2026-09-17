import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPaymentAllocation,
  centsToMoney,
  moneyToCents,
  summarizeChargeLedger,
} from './model.js';

test('money helpers preserve exact cents without floating-point arithmetic', () => {
  assert.equal(moneyToCents('195.00'), 19500n);
  assert.equal(moneyToCents('0.01'), 1n);
  assert.equal(centsToMoney(14505n), '145.05');
  assert.throws(() => moneyToCents('1.001'), /at most two/);
  assert.throws(() => moneyToCents('0.00'), /greater than zero/);
});

test('multiple partial payments reduce balance without changing the original due date', () => {
  const charge = { amount: '195.00', currency: 'USD', status: 'due', originalDueDate: '2026-10-10' };
  const first = summarizeChargeLedger({
    charge,
    allocations: [{ amount: '50.00', transactionKind: 'payment', transactionStatus: 'verified' }],
    asOf: new Date('2026-09-17T00:00:00Z'),
  });
  assert.deepEqual(first, {
    amount: '195.00', verifiedPayments: '50.00', verifiedRefunds: '0.00', netPaid: '50.00',
    remaining: '145.00', status: 'partially_paid', originalDueDate: '2026-10-10',
  });
  const second = summarizeChargeLedger({
    charge,
    allocations: [
      { amount: '50.00', transactionKind: 'payment', transactionStatus: 'verified' },
      { amount: '145.00', transactionKind: 'payment', transactionStatus: 'verified' },
    ],
    asOf: new Date('2026-09-18T00:00:00Z'),
  });
  assert.equal(second.remaining, '0.00');
  assert.equal(second.status, 'paid');
  assert.equal(second.originalDueDate, '2026-10-10');
});

test('an overdue charge is derived from its immutable original due date and remaining balance', () => {
  const snapshot = summarizeChargeLedger({
    charge: { amount: '195.00', status: 'partially_paid', originalDueDate: '2026-09-01' },
    allocations: [{ amount: '20.00', transactionKind: 'payment', transactionStatus: 'verified' }],
    asOf: new Date('2026-09-17T00:00:00Z'),
  });
  assert.equal(snapshot.status, 'overdue');
  assert.equal(snapshot.remaining, '175.00');
});

test('verified prepayment can remain unallocated and later fund the first charge', () => {
  const capacity = assertPaymentAllocation({
    charge: { amount: '195.00', currency: 'USD', status: 'due' },
    transaction: { amount: '195.00', currency: 'USD', status: 'verified', transactionKind: 'payment' },
    chargeAllocated: '0.00',
    transactionAllocated: '0.00',
    amount: '195.00',
  });
  assert.deepEqual(capacity, {
    amount: '195.00',
    chargeRemainingAfter: '0.00',
    transactionRemainingAfter: '0.00',
  });
});

test('allocation cannot exceed the verified transaction or charge balance', () => {
  const base = {
    charge: { amount: '195.00', currency: 'USD', status: 'partially_paid' },
    transaction: { amount: '145.00', currency: 'USD', status: 'verified', transactionKind: 'payment' },
    chargeAllocated: '100.00',
    transactionAllocated: '100.00',
  };
  assert.throws(() => assertPaymentAllocation({ ...base, amount: '95.01' }), /charge remaining balance/);
  assert.throws(() => assertPaymentAllocation({ ...base, amount: '45.01' }), /verified transaction balance/);
  assert.throws(() => assertPaymentAllocation({
    ...base,
    transaction: { ...base.transaction, status: 'pending' },
    amount: '10.00',
  }), /Only verified/);
  assert.throws(() => assertPaymentAllocation({
    ...base,
    charge: { ...base.charge, status: 'waived' },
    amount: '10.00',
  }), /cannot accept payment allocations/);
});

test('refund-capable schema does not silently implement refund policy', () => {
  assert.throws(() => assertPaymentAllocation({
    charge: { amount: '195.00', currency: 'USD', status: 'due' },
    transaction: { amount: '10.00', currency: 'USD', status: 'verified', transactionKind: 'refund' },
    amount: '10.00',
  }), /Refund allocation policy is not implemented/);
});
