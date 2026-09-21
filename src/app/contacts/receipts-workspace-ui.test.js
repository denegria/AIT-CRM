import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');

test('AIT USA Receipts is conditional on actual receipt history', () => {
  assert.match(source, /const showFinancialsTab = isAitUsaContact\s*\? visibleFinancials\.length > 0\s*:\s*detailView\.tabs\.showFinancials/);
  assert.match(source, /!showFinancialsTab && activeTab === 'financials'/);
  assert.match(source, /visibleFinancials\.length/);
});

test('AIT USA Contact Detail is a read-only receipt archive', () => {
  assert.match(source, /Receipt history/);
  assert.match(source, /Payments and checkouts are managed in Collections/);
  assert.match(source, /href="\/collections"/);
  assert.match(source, /Open Collections/);
  assert.match(source, /Download PDF/);
  assert.match(styles, /\.receiptArchiveHeader/);
  assert.doesNotMatch(source, /Generate Student Receipt/);
});

test('AIT USA does not expose the legacy payment modal or mutation entry point', () => {
  assert.match(source, /\{!isAitUsaContact && paymentModalOpen && \(/);
  assert.doesNotMatch(source, /if \(isAitUsaContact\) \{\s*openPaymentModal\(\)/);
  assert.doesNotMatch(source, /Student must be Enrolled before generating a receipt/);
  assert.doesNotMatch(source, /Save & Download Receipt/);
});

test('AIT Signs keeps its existing financial workflow', () => {
  assert.match(source, /isAitUsaContact \? \(/);
  assert.match(source, /Financial workflow/);
  assert.match(source, /Record Invoice Payment/);
  assert.match(source, /title="Record Payment"/);
});
