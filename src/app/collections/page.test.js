import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');

test('collections presents due, partial, and overdue work queues', () => {
  assert.match(source, /key: 'due'/);
  assert.match(source, /key: 'partially_paid'/);
  assert.match(source, /key: 'overdue'/);
});

test('collections distinguishes every commerce identity and record type', () => {
  for (const label of ['Student', 'Payer', 'Enrollment', 'Charge', 'Payment request', 'Fulfillment']) {
    assert.match(source, new RegExp(label));
  }
});

test('card entry is excluded while secure hosted links and non-card payments remain available', () => {
  assert.match(source, /Card details never enter CRM/);
  assert.match(source, /Create secure link/);
  assert.match(source, /Non-card payment/);
  assert.doesNotMatch(source, /name=["']card/i);
});

test('terminal checkout requires explicit confirmation and exposes unknown-result recovery', () => {
  assert.match(source, /Use terminal/);
  assert.match(source, /terminalCheckout\?\.ready/);
  assert.match(source, /Start terminal payment/);
  assert.match(source, /The payer must be present/);
  assert.match(source, /A timeout is treated as unknown—not paid/);
  assert.match(source, /Check terminal status/);
  assert.match(source, /recover_terminal_payment/);
  assert.match(source, /No money was recorded/);
  assert.match(source, /Payment entry locked during terminal recovery/);
  assert.match(source, /Resolve the terminal status before recording cash/);
});

test('US fulfillment policy copy preserves pickup for in-person and shipment for online', () => {
  assert.match(source, /In person · pickup/);
  assert.match(source, /Online · ship in US/);
});
