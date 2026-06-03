import assert from 'node:assert/strict';
import test from 'node:test';

import { attachPaymentSnapshotContactLinks } from './financial-linkage.js';

test('links payment snapshots to contacts through matching import activity source keys', () => {
  const paymentRows = [
    {
      id: 'payment-blue',
      businessUnitId: 'signs',
      amount: '282.56',
      sourceSheet: 'PAGADOS',
      sourceRow: 144,
    },
  ];
  const eventRows = [
    {
      id: 'event-blue-payment',
      contactId: 'contact-blue-mountain',
      eventType: 'import_promoted_payment_snapshot',
      sourceSheet: 'PAGADOS',
      sourceRow: 144,
    },
  ];

  const linked = attachPaymentSnapshotContactLinks(paymentRows, eventRows);

  assert.equal(linked[0].contactId, 'contact-blue-mountain');
  assert.equal(linked[0].amount, '282.56');
});

test('does not infer a payment contact when source keys map to multiple contacts', () => {
  const linked = attachPaymentSnapshotContactLinks(
    [{ id: 'payment-ambiguous', sourceSheet: 'PAGADOS', sourceRow: 144 }],
    [
      { id: 'event-a', contactId: 'contact-a', sourceSheet: 'PAGADOS', sourceRow: 144 },
      { id: 'event-b', contactId: 'contact-b', sourceSheet: 'PAGADOS', sourceRow: 144 },
    ],
  );

  assert.equal(linked[0].contactId, undefined);
});

test('links payment snapshots through estimate or work-order contact ids when source data is absent', () => {
  const linked = attachPaymentSnapshotContactLinks(
    [
      { id: 'payment-estimate', estimateId: 'estimate-blue' },
      { id: 'payment-work', workOrderId: 'work-blue' },
    ],
    [],
    {
      estimateRows: [{ id: 'estimate-blue', contactId: 'contact-blue-mountain' }],
      workOrderRows: [{ id: 'work-blue', contactId: 'contact-blue-mountain' }],
    },
  );

  assert.deepEqual(linked.map((row) => row.contactId), ['contact-blue-mountain', 'contact-blue-mountain']);
});

test('does not infer a payment contact when available links disagree', () => {
  const linked = attachPaymentSnapshotContactLinks(
    [{ id: 'payment-conflict', sourceSheet: 'PAGADOS', sourceRow: 144, estimateId: 'estimate-other' }],
    [{ id: 'event-blue-payment', contactId: 'contact-blue-mountain', sourceSheet: 'PAGADOS', sourceRow: 144 }],
    { estimateRows: [{ id: 'estimate-other', contactId: 'contact-other' }] },
  );

  assert.equal(linked[0].contactId, undefined);
});
