import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./route.js', import.meta.url), 'utf8');

test('collections routes enforce separate read and write permissions', () => {
  assert.match(source, /requirePermission\(request, PERMISSIONS\.FINANCIALS_READ\)/);
  assert.match(source, /requirePermission\(request, PERMISSIONS\.FINANCIALS_WRITE\)/);
});

test('all collections operations resolve an AIT USA business-unit scope', () => {
  assert.match(source, /resolveBusinessUnitId/);
  assert.match(source, /isAitUsaBusinessUnit/);
  assert.match(source, /Payments is limited to AIT USA/);
});

test('route exposes take-payment, registration, hosted-link, SPIn terminal, recovery, and non-card actions', () => {
  assert.match(source, /body\.action === 'create_payment_request'/);
  assert.match(source, /createStaffPaymentRequest/);
  assert.match(source, /body\.action === 'create_checkout'/);
  assert.match(source, /body\.action === 'create_hosted_link'/);
  assert.match(source, /body\.action === 'initiate_terminal_payment'/);
  assert.match(source, /body\.action === 'recover_terminal_payment'/);
  assert.match(source, /actorUserId: session\.user\.id/);
  assert.match(source, /body\.action === 'record_manual_payment'/);
  assert.match(source, /body\.action === 'record_manual_payment_request'/);
  assert.match(source, /recordManualPaymentRequest/);
  assert.match(source, /channel: 'staff'/);
});

test('setup reads accept contact search and a preselected payment contact', () => {
  assert.match(source, /contactSearch: searchParams\.get\('contactSearch'\)/);
  assert.match(source, /paymentContactId: searchParams\.get\('paymentContactId'\)/);
});

test('take-payment audit sources are allowlisted instead of accepting arbitrary client text', () => {
  assert.match(source, /body\.sourceReference === 'contact-detail'/);
  assert.match(source, /: 'payments-workspace'/);
  assert.doesNotMatch(source, /sourceReference: body\.sourceReference \|\|/);
});

test('server-resolved financial scope overrides every client payment payload', () => {
  const createRequest = source.slice(
    source.indexOf("body.action === 'create_payment_request'"),
    source.indexOf("body.action === 'create_hosted_link'"),
  );
  const manualCharge = source.slice(
    source.indexOf("body.action === 'record_manual_payment'"),
    source.indexOf("body.action === 'record_manual_payment_request'"),
  );
  const manualRequest = source.slice(source.indexOf("body.action === 'record_manual_payment_request'"));
  for (const operation of [createRequest, manualCharge, manualRequest]) {
    assert.ok(operation.indexOf('...body.payment') < operation.indexOf('...scope'));
  }
});

test('queue and setup reads do not overlap on one pooled PostgreSQL client', () => {
  assert.doesNotMatch(source, /Promise\.all\(\[\s*loadCollectionsQueue/);
  assert.match(source, /const queue = await loadCollectionsQueue/);
  assert.match(source, /const setup = await loadCollectionsSetup/);
});

test('terminal readiness is derived server-side without exposing secret metadata', () => {
  assert.match(source, /dejavooSpinConfigHealth/);
  assert.match(source, /terminalCheckout/);
  assert.match(source, /ready: terminalHealth\.ready/);
  assert.match(source, /environment: terminalHealth\.environment/);
  assert.doesNotMatch(source, /terminalHealth\.missing/);
});
