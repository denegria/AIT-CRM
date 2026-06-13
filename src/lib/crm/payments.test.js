import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentMessage,
  calculateBalanceAfter,
  normalizePaymentDate,
  normalizePaymentMethod,
  parsePaymentAmount,
  toPaymentReceiptPayload,
} from './payments.js';

test('payment helpers normalize partial-payment values for persistence', () => {
  assert.equal(parsePaymentAmount('$1,250.40'), 1250.4);
  assert.equal(parsePaymentAmount('0'), null);
  assert.equal(normalizePaymentMethod('credit card'), 'Card');
  assert.equal(normalizePaymentMethod('ACH transfer'), 'Bank Transfer');
  assert.equal(normalizePaymentDate('2026-06-13T18:00:00.000Z'), '2026-06-13');
});

test('payment helpers calculate running balance after prior payments', () => {
  assert.equal(calculateBalanceAfter({
    targetTotal: '4200.00',
    priorPayments: [{ amount: '500.00' }, { amount: '200.00' }],
    amount: 1000,
  }), 2500);
  assert.equal(calculateBalanceAfter({ targetTotal: null, amount: 100 }), null);
});

test('payment helpers create receipt payload and readable activity message', () => {
  const message = buildPaymentMessage({
    amount: 300,
    paymentMethod: 'cash',
    balanceAfter: 1200,
    targetLabel: 'Work Order WO-44',
    note: 'Deposit',
  });
  assert.equal(message, 'Payment received $300.00 · Cash · Work Order WO-44 · Balance $1,200.00 · Deposit');

  const receipt = toPaymentReceiptPayload({
    id: 'payment-blue-mountain',
    businessUnitId: 'bu-signs',
    workOrderId: 'wo-1',
    paymentNumber: 2,
    paymentMethod: 'Cash',
    amount: '300.00',
    paidAt: '2026-06-13',
    balanceAfter: '1200.00',
  }, {
    contact: { id: 'contact-1', name: 'Blue Mountain' },
    workOrder: { id: 'wo-1', title: 'Yard sign package' },
  });

  assert.equal(receipt.number, 'REC-002');
  assert.equal(receipt.type, 'Receipt');
  assert.equal(receipt.client, 'Blue Mountain');
  assert.equal(receipt.workOrderId, 'wo-1');
  assert.equal(receipt.balanceDue, 1200);
  assert.equal(receipt.items[0].desc, 'Payment for Yard sign package');
});
