import test from 'node:test';
import assert from 'node:assert/strict';
import { getFinancialDocumentFieldMap } from './financial-document-fields.js';

test('financial document field map distinguishes AIT USA receipt from AIT Signs receipt', () => {
  const aitUsaReceipt = getFinancialDocumentFieldMap('Receipt', { businessUnitName: 'AIT USA Institute' });
  const signsReceipt = getFinancialDocumentFieldMap('Receipt', { businessUnitName: 'AIT Signs' });
  const workOrder = getFinancialDocumentFieldMap('Work Order');

  assert.equal(aitUsaReceipt.type, 'aitUsaReceipt');
  assert.ok(aitUsaReceipt.required.includes('studentName'));
  assert.equal(signsReceipt.type, 'receipt');
  assert.ok(signsReceipt.optional.includes('workOrderNumber'));
  assert.equal(workOrder.type, 'workOrder');
  assert.ok(workOrder.required.includes('productionTerms'));
});
