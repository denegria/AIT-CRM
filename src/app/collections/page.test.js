import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('./PaymentsWorkspace.js', import.meta.url),
  'utf8',
);
const styles = fs.readFileSync(
  new URL('./PaymentsWorkspace.module.css', import.meta.url),
  'utf8',
);

test('payments presents balances, overdue, recent, and reconciliation workspaces', () => {
  assert.match(source, /key: 'due'/);
  assert.match(source, /key: 'partially_paid'/);
  assert.match(source, /key: 'overdue'/);
  assert.match(source, /key: 'recent'/);
  assert.match(source, /key: 'reconciliation'/);
});

test('an empty balance lane renders one page-level state instead of a split empty workspace', () => {
  assert.match(source, /!payload\?\.queue\?\.total/);
  assert.match(
    source,
    /Use Take\s+payment for a student payment or New registration/,
  );
});

test('payments distinguishes every commerce identity and record type', () => {
  for (const label of [
    'Student',
    'Payer',
    'Enrollment',
    'Charge',
    'Receipt',
    'Fulfillment',
  ]) {
    assert.match(source, new RegExp(label));
  }
});

test('card entry is excluded while secure hosted links and non-card payments remain available', () => {
  assert.match(source, /Card data stays with the provider/);
  assert.match(source, /Secure payment link/);
  assert.match(source, /Non-card payment/);
  assert.doesNotMatch(source, /name=["']card/i);
});

test('terminal checkout requires explicit confirmation and exposes unknown-result recovery', () => {
  assert.match(source, /Physical terminal/);
  assert.match(source, /terminalCheckout\?\.ready/);
  assert.match(source, /Start terminal payment/);
  assert.match(source, /Payer is present at the front desk/);
  assert.match(source, /A timeout is unknown—not paid/);
  assert.match(source, /Check status/);
  assert.match(source, /recover_terminal_payment/);
  assert.match(source, /No money was recorded/);
  assert.match(
    source,
    /Reconciliation must resolve\s+it before another attempt/,
  );
});

test('US fulfillment policy copy preserves pickup for in-person and shipment for online', () => {
  assert.match(source, /In person · pickup/);
  assert.match(source, /Online · digital \+ ship in US/);
});

test('registration review uses the canonical catalog quote before payment confirmation', () => {
  assert.match(source, /calculateRegistrationQuote/);
  assert.match(source, /registrationQuote\.status === 'quoted'/);
  assert.match(
    source,
    /This registration needs advisor review before payment can continue/,
  );
});

test('take payment and registration share one four-step payment method flow', () => {
  assert.match(source, /Take payment/);
  assert.match(source, /New registration/);
  assert.match(source, /Student & payer/);
  assert.match(source, /What this covers/);
  assert.match(source, /Payment method/);
  assert.match(source, /Review & confirm/);
  assert.match(source, /create_payment_request/);
  assert.match(source, /create_checkout/);
  assert.match(source, /record_manual_payment_request/);
});

test('future installments require real charges and account credit stays explicit', () => {
  assert.match(source, /Future installment/);
  assert.match(source, /No open or future-dated charge exists/);
  assert.match(source, /Account credit/);
  assert.match(source, /intent: 'account_credit'/);
});

test('payments polish preserves CRM hierarchy and focuses the active transaction', () => {
  assert.match(
    source,
    /!flow\.mode\s*&&\s*\(\s*<section className=\{s\.primaryActions\}/,
  );
  assert.match(source, /primaryActionCard/);
  assert.match(source, /workspaceToolbar/);
  assert.match(source, /aria-label="Refresh payments"/);
  assert.doesNotMatch(source, /money operations/i);
  assert.match(
    styles,
    /\.views \.activeView\s*\{[^}]*background: var\(--accent\)/s,
  );
  assert.match(styles, /\.primaryActionCard/);
  assert.match(source, /scrollCue/);
  assert.match(styles, /\.scrollCue/);
  assert.doesNotMatch(styles, /#17212b/i);
});
