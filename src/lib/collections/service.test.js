import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostedCollectionLink, recordManualCollectionPayment } from './service.js';

const scope = { organizationId: 'org-1', businessUnitId: 'bu-usa' };

function requestRow(metadata = {}) {
  return {
    id: 'request-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-usa',
    student_contact_id: 'student-1',
    payer_contact_id: 'student-1',
    status: 'created',
    requested_amount: '95.00',
    currency: 'USD',
    merchant_reference: 'REGISTRATION_0001',
    source_type: 'registration',
    metadata_json: metadata,
    student_name: 'Student One',
    student_email: 'student@example.com',
    student_phone: '+19085550100',
  };
}

function hostedClient(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('select pr.*, student.name')) return { rows: [row] };
      return { rows: [] };
    },
  };
}

test('hosted checkout stores only a safe checkout summary and returns the URL once', async () => {
  const client = hostedClient(requestRow());
  let adapterCalls = 0;
  const adapter = {
    async createHostedPaymentPage(input) {
      adapterCalls += 1;
      assert.equal(input.amountCents, 9500);
      assert.equal(input.merchantReference, 'REGISTRATION_0001');
      assert.match(input.postUrl, /\/api\/payments\/dejavoo\/callback$/);
      return {
        ok: true,
        correlationId: input.correlationId,
        checkoutUrl: 'https://pay.ipospays.tech/secret-token',
        checkout: { origin: 'https://pay.ipospays.tech', path: '/secret-token' },
      };
    },
  };
  const result = await createHostedCollectionLink(client, {
    ...scope,
    paymentRequestId: 'request-1',
    idempotencyKey: 'collections:hpp:fixture-1',
    environment: 'uat',
    baseUrl: 'https://staging.example.com',
    adapter,
  });
  assert.equal(adapterCalls, 1);
  assert.equal(result.checkoutUrl, 'https://pay.ipospays.tech/secret-token');
  const persisted = client.calls.filter((call) => call.sql.includes('update payment_requests'));
  assert.equal(persisted.length, 2);
  assert.doesNotMatch(JSON.stringify(persisted), /secret-token/);
  assert.match(JSON.stringify(persisted), /pay\.ipospays\.tech/);
});

test('existing hosted attempt blocks a second provider call', async () => {
  const client = hostedClient(requestRow({ hostedPaymentAttempt: { state: 'created', correlationId: 'first' } }));
  let adapterCalls = 0;
  await assert.rejects(
    () => createHostedCollectionLink(client, {
      ...scope,
      paymentRequestId: 'request-1',
      idempotencyKey: 'collections:hpp:fixture-2',
      environment: 'uat',
      baseUrl: 'https://staging.example.com',
      adapter: { async createHostedPaymentPage() { adapterCalls += 1; } },
    }),
    (error) => error.code === 'hosted_link_already_attempted' && error.status === 409,
  );
  assert.equal(adapterCalls, 0);
});

test('public hosted checkout pins the registration source and customer return URLs', async () => {
  const client = hostedClient(requestRow());
  let adapterInput;
  const result = await createHostedCollectionLink(client, {
    ...scope,
    paymentRequestId: 'request-1',
    idempotencyKey: 'registration:hpp:fixture-1',
    environment: 'uat',
    baseUrl: 'https://crm-staging.example.com',
    requiredSourceType: 'registration',
    customerUrls: {
      returnUrl: 'https://learn.example.com/inscribete/?payment=return&state=opaque-state',
      failureUrl: 'https://learn.example.com/inscribete/?payment=failed&state=opaque-state',
      cancelUrl: 'https://learn.example.com/inscribete/?payment=cancelled&state=opaque-state',
    },
    adapter: { async createHostedPaymentPage(input) {
      adapterInput = input;
      return {
        ok: true,
        correlationId: input.correlationId,
        checkoutUrl: 'https://pay.ipospays.tech/secret-token',
        checkout: { origin: 'https://pay.ipospays.tech' },
      };
    } },
  });
  assert.equal(result.paymentRequestId, 'request-1');
  assert.equal(adapterInput.returnUrl, 'https://learn.example.com/inscribete/?payment=return&state=opaque-state');
  assert.equal(adapterInput.failureUrl, 'https://learn.example.com/inscribete/?payment=failed&state=opaque-state');
  assert.equal(adapterInput.cancelUrl, 'https://learn.example.com/inscribete/?payment=cancelled&state=opaque-state');
});

test('public hosted checkout rejects another payment-request source before provider I/O', async () => {
  const client = hostedClient(requestRow());
  client.calls.length = 0;
  const row = requestRow();
  row.source_type = 'collections';
  const wrongSourceClient = hostedClient(row);
  let called = false;
  await assert.rejects(() => createHostedCollectionLink(wrongSourceClient, {
    ...scope,
    paymentRequestId: 'request-1',
    idempotencyKey: 'registration:hpp:fixture-2',
    environment: 'uat',
    baseUrl: 'https://crm-staging.example.com',
    requiredSourceType: 'registration',
    adapter: { async createHostedPaymentPage() { called = true; } },
  }), (error) => error.code === 'payment_request_source_invalid' && error.status === 403);
  assert.equal(called, false);
});

function manualClient({ duplicate = false } = {}) {
  const charge = {
    id: 'charge-1', organization_id: 'org-1', business_unit_id: 'bu-usa',
    student_contact_id: 'student-1', payer_contact_id: null, amount: '95.00', currency: 'USD',
    status: 'due', description: 'Registration and book bundle', original_due_date: '2026-09-18',
    payment_request_id: null,
  };
  const transaction = {
    id: 'transaction-1', organization_id: 'org-1', business_unit_id: 'bu-usa',
    provider_transaction_id: 'manual_fixture', transaction_kind: 'payment', status: 'verified',
    amount: '50.00', currency: 'USD', receipt_document_id: duplicate ? 'receipt-1' : null,
  };
  const calls = [];
  return {
    calls,
    async query(sql) {
      const statement = String(sql);
      calls.push(statement);
      if (statement.includes('from student_charges sc') && statement.includes('for update of sc')) return { rows: [charge] };
      if (statement.includes('select id from contacts')) return { rows: [{ id: 'student-1' }] };
      if (statement.includes('insert into provider_transactions')) return { rows: duplicate ? [] : [transaction] };
      if (statement.includes('select * from provider_transactions') && statement.includes('idempotency_key')) return { rows: [transaction] };
      if (statement.includes('select * from payment_allocations') && statement.includes('idempotency_key')) {
        return { rows: duplicate ? [{ id: 'allocation-1', amount: '50.00' }] : [] };
      }
      if (statement.includes('select * from student_charges') && statement.includes('for update')) return { rows: [charge] };
      if (statement.includes('select * from provider_transactions') && statement.includes('for update')) return { rows: [transaction] };
      if (statement.includes('from payment_allocations a')) return { rows: [{ allocated: '0.00' }] };
      if (statement.includes('where transaction_id')) return { rows: [{ allocated: '0.00' }] };
      if (statement.includes('insert into payment_allocations')) return { rows: [{ id: 'allocation-1', amount: '50.00' }] };
      if (statement.includes('insert into financial_documents')) return { rows: [{ id: 'receipt-1', document_number: 'REC-MAN-FIXTURE' }] };
      return { rows: [] };
    },
  };
}

test('manual non-card payment uses verified transaction and allocation invariants', async () => {
  const client = manualClient();
  const result = await recordManualCollectionPayment(client, {
    ...scope,
    chargeId: 'charge-1',
    amount: '50.00',
    method: 'check',
    reference: '1042',
    note: 'received at front desk',
    idempotencyKey: 'collections:manual:fixture-1',
    actorUserId: 'user-1',
    now: new Date('2026-09-18T12:00:00Z'),
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.receiptDocumentId, 'receipt-1');
  assert.ok(client.calls.some((sql) => sql.includes("provider_environment") && sql.includes('insert into provider_transactions')));
  assert.ok(client.calls.some((sql) => sql.includes('insert into payment_allocations')));
  assert.ok(client.calls.some((sql) => sql.includes("financial.manual_payment_recorded")));
});
