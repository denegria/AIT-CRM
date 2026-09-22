import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createHostedCollectionLink,
  createStaffPaymentRequest,
  loadCollectionsSetup,
  recordManualCollectionPayment,
  recordManualPaymentRequest,
} from './service.js';

const scope = { organizationId: 'org-1', businessUnitId: 'bu-usa' };
const serviceSource = fs.readFileSync(new URL('./service.js', import.meta.url), 'utf8');

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

test('existing terminal attempt blocks hosted provider I/O', async () => {
  const client = hostedClient(requestRow({ terminalPaymentAttempt: { state: 'pending', correlationId: 'spin-first' } }));
  let adapterCalls = 0;
  await assert.rejects(
    () => createHostedCollectionLink(client, {
      ...scope,
      paymentRequestId: 'request-1',
      idempotencyKey: 'collections:hpp:fixture-terminal-conflict',
      environment: 'uat',
      baseUrl: 'https://staging.example.com',
      adapter: { async createHostedPaymentPage() { adapterCalls += 1; } },
    }),
    (error) => error.code === 'payment_request_provider_conflict' && error.status === 409,
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

test('a verified full manual payment can close a final non-payment provider request', () => {
  assert.match(serviceSource, /status in \('created', 'pending', 'failed', 'canceled', 'expired'\)/);
});

function paymentRequestClient({ allocated = '25.00', chargeStatus = 'partially_paid' } = {}) {
  const calls = [];
  const charge = {
    id: 'charge-1', organization_id: 'org-1', business_unit_id: 'bu-usa',
    student_contact_id: 'student-1', payer_contact_id: 'payer-1', enrollment_id: 'enrollment-1',
    class_section_id: null, amount: '100.00', allocated, currency: 'USD', status: chargeStatus,
    charge_type: 'tuition', description: 'October tuition', original_due_date: '2026-10-01',
  };
  return {
    calls,
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: statement, params });
      if (statement.includes('from student_charges sc') && statement.includes('for update')) return { rows: [charge] };
      if (statement.startsWith('select id from contacts')) {
        return { rows: ['student-1', 'payer-1'].includes(params[0]) ? [{ id: params[0] }] : [] };
      }
      if (statement.startsWith('insert into payment_requests')) return { rows: [{
        id: 'request-1', requested_amount: params[7], charge_id: params[6],
        student_contact_id: params[2], payer_contact_id: params[3], metadata_json: JSON.parse(params[18]),
      }] };
      return { rows: [] };
    },
  };
}

test('staff charge request accepts a partial amount without changing the original due date', async () => {
  const client = paymentRequestClient();
  const result = await createStaffPaymentRequest(client, {
    ...scope,
    intent: 'charge',
    studentContactId: 'student-1',
    payerContactId: 'payer-1',
    chargeId: 'charge-1',
    amount: '50.00',
    idempotencyKey: 'payments:request:fixture-1',
  });
  assert.equal(result.paymentRequest.requested_amount, '50.00');
  assert.equal(result.paymentRequest.charge_id, 'charge-1');
  assert.deepEqual(result.allocationPlan, [{
    treatment: 'charge', chargeId: 'charge-1', itemCode: 'tuition', amount: '50.00',
  }]);
  assert.equal(client.calls.some((call) => /update student_charges/i.test(call.sql)), false);
});

test('staff charge request rejects an amount above the verified remaining balance', async () => {
  const client = paymentRequestClient();
  await assert.rejects(() => createStaffPaymentRequest(client, {
    ...scope,
    intent: 'charge',
    studentContactId: 'student-1',
    chargeId: 'charge-1',
    amount: '75.01',
    idempotencyKey: 'payments:request:fixture-2',
  }), (error) => error.code === 'amount_exceeds_balance' && error.details.balance === '75.00');
  assert.equal(client.calls.some((call) => call.sql.startsWith('insert into payment_requests')), false);
});

test('staff account credit creates a request without a fake charge', async () => {
  const client = paymentRequestClient();
  const result = await createStaffPaymentRequest(client, {
    ...scope,
    intent: 'account_credit',
    studentContactId: 'student-1',
    amount: '200.00',
    idempotencyKey: 'payments:request:fixture-3',
  });
  assert.equal(result.paymentRequest.charge_id, null);
  assert.equal(result.paymentRequest.payer_contact_id, 'student-1');
  assert.equal(result.paymentRequest.metadata_json.paymentIntent.kind, 'account_credit');
  assert.deepEqual(result.allocationPlan, [{
    treatment: 'unapplied_credit', chargeId: null, itemCode: 'account-credit', amount: '200.00',
  }]);
});

test('available account credit subtracts verified refunds and their reversed allocations', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(statement);
      if (statement.startsWith('select id, name, email, phone from contacts') && statement.includes('id::text = $1')) {
        return { rows: [{ id: 'student-1', name: 'Student One' }] };
      }
      if (statement.includes('as balance') && statement.includes('from provider_transactions pt')) {
        return { rows: [{ balance: '75.00' }] };
      }
      return { rows: [] };
    },
  };
  const result = await loadCollectionsSetup(client, {
    ...scope,
    paymentContactId: 'student-1',
  });
  assert.equal(result.paymentStudent.accountCredit, '75.00');
  const creditQuery = calls.find((statement) => statement.includes('as balance') && statement.includes('from provider_transactions pt'));
  assert.match(creditQuery, /case when pt\.transaction_kind = 'refund' then -pt\.amount else pt\.amount end/);
  assert.match(creditQuery, /case when pt\.transaction_kind = 'refund' then -allocated\.amount else allocated\.amount end/);
  assert.match(creditQuery, /pt\.transaction_kind in \('payment', 'refund'\)/);
});

test('manual account credit completes the reviewed request without inventing an allocation', async () => {
  const request = {
    id: 'request-credit', organization_id: 'org-1', business_unit_id: 'bu-usa',
    student_contact_id: 'student-1', payer_contact_id: 'student-1', requested_amount: '200.00',
    currency: 'USD', status: 'created', merchant_reference: 'PAY_CREDIT',
    metadata_json: { paymentIntent: {
      kind: 'account_credit', label: 'Account credit', allocationPlan: [
        { treatment: 'unapplied_credit', chargeId: null, itemCode: 'account-credit', amount: '200.00' },
      ],
    } },
  };
  const transaction = {
    id: 'transaction-credit', provider_transaction_id: 'manual_credit', status: 'verified',
    transaction_kind: 'payment', amount: '200.00', currency: 'USD', receipt_document_id: null,
  };
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: statement, params });
      if (statement.startsWith('select * from payment_requests') && statement.includes('for update')) return { rows: [request] };
      if (statement.startsWith('select id from contacts')) return { rows: [{ id: params[0] }] };
      if (statement.startsWith('insert into provider_transactions')) return { rows: [transaction] };
      if (statement.startsWith('insert into financial_documents')) return { rows: [{ id: 'receipt-credit' }] };
      return { rows: [] };
    },
  };
  const result = await recordManualPaymentRequest(client, {
    ...scope,
    paymentRequestId: 'request-credit',
    amount: '200.00',
    method: 'cash',
    note: 'Prepaid next month at front desk',
    idempotencyKey: 'payments:manual:credit-fixture',
    actorUserId: 'user-1',
    now: new Date('2026-09-21T12:00:00Z'),
  });
  assert.equal(result.receiptDocumentId, 'receipt-credit');
  assert.equal(result.unappliedCreditAmount, '200.00');
  assert.deepEqual(result.allocationIds, []);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into payment_allocations')), false);
  assert.ok(calls.some((call) => call.sql.includes("update payment_requests set status = 'completed'")));
});

function manualPaymentReplayClient({ status = 'completed', replayKey = '', receiptDocumentId = null } = {}) {
  const request = {
    id: 'request-credit', organization_id: 'org-1', business_unit_id: 'bu-usa',
    student_contact_id: 'student-1', payer_contact_id: 'student-1', requested_amount: '200.00',
    currency: 'USD', status, merchant_reference: 'PAY_CREDIT',
    metadata_json: { paymentIntent: {
      kind: 'account_credit', label: 'Account credit', allocationPlan: [
        { treatment: 'unapplied_credit', chargeId: null, itemCode: 'account-credit', amount: '200.00' },
      ],
    } },
  };
  const transaction = {
    id: 'transaction-credit', payment_request_id: request.id,
    provider_transaction_id: 'manual_credit', status: 'verified',
    transaction_kind: 'payment', amount: '200.00', currency: 'USD',
    receipt_document_id: receiptDocumentId, idempotency_key: replayKey,
  };
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: statement, params });
      if (statement.startsWith('select * from payment_requests') && statement.includes('for update')) return { rows: [request] };
      if (statement.startsWith('select * from provider_transactions') && statement.includes('payment_request_id = $3')) {
        return { rows: replayKey === params[3] ? [transaction] : [] };
      }
      if (statement.startsWith('select * from provider_transactions') && statement.includes('idempotency_key = $3')) {
        return { rows: replayKey === params[2] ? [transaction] : [] };
      }
      if (statement.startsWith('select id from contacts')) return { rows: [{ id: params[0] }] };
      if (statement.startsWith('insert into provider_transactions')) return { rows: replayKey ? [] : [transaction] };
      return { rows: [] };
    },
  };
}

test('manual payment retry returns the completed transaction for the same idempotency key', async () => {
  const replayKey = 'manual:request-transaction:payments:manual:credit-fixture';
  const client = manualPaymentReplayClient({ replayKey, receiptDocumentId: 'receipt-credit' });
  const result = await recordManualPaymentRequest(client, {
    ...scope,
    paymentRequestId: 'request-credit',
    amount: '200.00',
    method: 'cash',
    idempotencyKey: 'payments:manual:credit-fixture',
    actorUserId: 'user-1',
    now: new Date('2026-09-21T12:00:00Z'),
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.transactionId, 'transaction-credit');
  assert.equal(result.receiptDocumentId, 'receipt-credit');
  assert.equal(client.calls.some((call) => call.sql.startsWith('insert into financial_documents')), false);
});

test('completed payment request rejects a manual retry with a different idempotency key', async () => {
  const client = manualPaymentReplayClient({
    replayKey: 'manual:request-transaction:payments:manual:first-attempt',
    receiptDocumentId: 'receipt-credit',
  });
  await assert.rejects(() => recordManualPaymentRequest(client, {
    ...scope,
    paymentRequestId: 'request-credit',
    amount: '200.00',
    method: 'cash',
    idempotencyKey: 'payments:manual:different-attempt',
  }), (error) => error.code === 'payment_request_completed' && error.status === 409);
  assert.equal(client.calls.some((call) => call.sql.startsWith('insert into provider_transactions')), false);
});

for (const status of ['pending', 'failed', 'canceled', 'expired']) {
  test(`manual payment rejects a ${status} request instead of reviving it`, async () => {
    const client = manualPaymentReplayClient({ status });
    await assert.rejects(() => recordManualPaymentRequest(client, {
      ...scope,
      paymentRequestId: 'request-credit',
      amount: '200.00',
      method: 'cash',
      idempotencyKey: `payments:manual:${status}`,
    }), (error) => error.code === 'payment_request_not_payable' && error.status === 409);
    assert.equal(client.calls.some((call) => call.sql.startsWith('insert into provider_transactions')), false);
  });
}
