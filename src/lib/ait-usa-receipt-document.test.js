import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAitUsaReceiptDocument, formatAitUsaReceiptMoney } from './ait-usa-receipt-document.js';

test('AIT USA receipt document separates bilingual receipt fields from signs invoice layout', () => {
  const document = buildAitUsaReceiptDocument({
    id: 'receipt-123456789',
    number: 'REC-004',
    client: 'Maria Student',
    amount: '850.00',
    balanceDue: '150.00',
    paymentMethod: 'Zelle',
    date: '2026-06-13',
    program: 'Tax preparation course',
  }, {
    businessUnit: { name: 'AIT USA Institute' },
  });

  assert.equal(document.title, 'Receipt / Recibo');
  assert.equal(document.company.name, 'AIT USA Institute');
  assert.equal(document.studentName, 'Maria Student');
  assert.equal(document.amountDisplay, '$850.00');
  assert.equal(document.balanceDueDisplay, '$150.00');
  assert.equal(document.method, 'Zelle');
  assert.equal(document.receivedBy, undefined);
  assert.match(document.bilingualNote.join(' '), /Este recibo/);
});

test('AIT USA receipt money formatter handles missing values', () => {
  assert.equal(formatAitUsaReceiptMoney('1250'), '$1,250.00');
  assert.equal(formatAitUsaReceiptMoney(''), 'Not captured');
});

test('discounted receipt preserves original, discount and final without staff audit identity', () => {
  const document = buildAitUsaReceiptDocument({ amount: '175.00', items: [{ desc: 'Four-week tuition', standardAmount: '195.00', discount: '20.00', finalAmount: '175.00', amount: 175 }] });
  assert.deepEqual(document.pricingLines, [{ label: 'Four-week tuition', standard: '$195.00', discount: '$20.00', final: '$175.00' }]);
  assert.doesNotMatch(JSON.stringify(document), /actorUserId|reason/);
});
