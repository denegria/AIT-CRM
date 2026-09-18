import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDejavooPaymentRequest, reconcileDejavooPayment } from './reconciliation.js';

const callback = Object.freeze({
  merchantReference: 'AITUSA-REG-ABC123',
  payloadSha256: 'a'.repeat(64),
  idempotencyKey: `dejavoo:callback:${'a'.repeat(64)}`,
  eventType: 'payment.status_callback',
  safePayload: {
    responseCode: '200',
    responseMessage: 'Successful',
    transactionReferenceId: 'AITUSA-REG-ABC123',
    transactionId: 'HPP-TXN-100',
    amount: '24000',
    totalAmount: '24000',
  },
});

function verifiedStatus(overrides = {}) {
  return {
    ok: true,
    correlationId: 'dejavoo:callback:test-001',
    environment: 'uat',
    merchantId: '123456789012',
    merchantReference: 'AITUSA-REG-ABC123',
    status: 'succeeded',
    providerStatus: 'Successful',
    providerTransactionId: 'HPP-TXN-100',
    amount: { currency: 'USD', minorUnits: 24000, totalMinorUnits: 24000 },
    ...overrides,
  };
}

function fakeReconciliationClient({ failFulfillment = false } = {}) {
  const request = {
    id: 'request-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-usa',
    student_contact_id: 'student-1',
    payer_contact_id: 'payer-1',
    enrollment_id: 'enrollment-1',
    class_section_id: null,
    charge_id: null,
    requested_amount: '240.00',
    currency: 'USD',
    status: 'created',
    provider: 'dejavoo',
    provider_environment: 'uat',
    merchant_reference: 'AITUSA-REG-ABC123',
    source_reference: 'registration-1',
    metadata_json: {
      registrationResult: {
        allocationPlan: [
          { treatment: 'charge', chargeId: 'charge-1', itemCode: 'registration', amount: '95.00' },
          { treatment: 'unapplied_credit', chargeId: null, itemCode: 'tuition-credit', amount: '145.00' },
        ],
        quote: {
          lines: [
            { code: 'registration_book_bundle', label: 'Registration and book bundle', amount: '95.00', ledgerTreatment: 'charge' },
            { code: 'tuition-credit', label: 'Tuition prepayment', amount: '145.00', ledgerTreatment: 'unapplied_credit' },
          ],
        },
      },
    },
  };
  const state = {
    request,
    events: [],
    transactions: [],
    allocations: [],
    charges: [{ id: 'charge-1', organization_id: 'org-1', business_unit_id: 'bu-usa', amount: '95.00', currency: 'USD', status: 'due', original_due_date: null }],
    documents: [],
    activities: [],
    enrollment: { id: 'enrollment-1', metadata_json: { registrationState: 'payment_pending' } },
    fulfillment: {
      id: 'fulfillment-1',
      organization_id: 'org-1',
      business_unit_id: 'bu-usa',
      student_contact_id: 'student-1',
      enrollment_id: 'enrollment-1',
      payment_request_id: 'request-1',
      provider_transaction_id: null,
      delivery_mode: 'digital',
      status: 'payment_pending',
      digital_status: 'pending',
      physical_status: 'not_required',
      shipping_address_snapshot_json: {},
    },
    calls: [],
    next: 1,
  };
  return {
    state,
    async query(sql, parameters = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: statement, parameters });
      if (['begin', 'commit', 'rollback'].includes(statement)
        || statement.startsWith('savepoint ')
        || statement.startsWith('release savepoint ')
        || statement.startsWith('rollback to savepoint ')) return { rows: [] };
      if (statement.startsWith('select pg_advisory_xact_lock')) return { rows: [{}] };
      if (statement.startsWith('select * from payment_requests')) {
        const row = state.request.merchant_reference === parameters[0]
          && state.request.provider === parameters[1]
          && state.request.provider_environment === parameters[2]
          ? state.request
          : null;
        return { rows: row ? [row] : [] };
      }
      if (statement.startsWith('select id from contacts')) {
        return { rows: ['student-1', 'payer-1'].includes(parameters[0]) ? [{ id: parameters[0] }] : [] };
      }
      if (statement.startsWith('insert into payment_provider_events')) {
        const existing = state.events.find((row) => row.idempotency_key === parameters[14]);
        if (existing) return { rows: [] };
        const row = {
          id: `event-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          payment_request_id: parameters[2],
          transaction_id: parameters[3],
          student_contact_id: parameters[4],
          provider: parameters[8],
          provider_environment: parameters[9],
          event_type: parameters[11],
          processing_status: 'received',
          payload_sha256: parameters[12],
          safe_payload_json: JSON.parse(parameters[13]),
          idempotency_key: parameters[14],
        };
        state.events.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('select * from payment_provider_events')) {
        const row = state.events.find((event) => (
          event.organization_id === parameters[0]
          && event.business_unit_id === parameters[1]
          && event.idempotency_key === parameters[2]
        ));
        return { rows: row ? [row] : [] };
      }
      if (statement.startsWith('update payment_provider_events')) {
        const event = state.events.find((row) => row.id === parameters[5]);
        Object.assign(event, {
          processing_status: parameters[0],
          error_code: parameters[1],
          transaction_id: parameters[2] || event.transaction_id,
          safe_payload_json: JSON.parse(parameters[3]),
          processed_at: parameters[4] ? new Date().toISOString() : null,
        });
        return { rows: [] };
      }
      if (statement.startsWith('update payment_requests set status')) {
        if (parameters[2].includes(state.request.status)) state.request.status = parameters[0];
        return { rows: [] };
      }
      if (statement.startsWith('select * from provider_transactions') && statement.includes('provider_transaction_id = $4')) {
        return { rows: state.transactions.filter((row) => (
          row.organization_id === parameters[0]
          && row.provider === parameters[1]
          && row.provider_environment === parameters[2]
          && row.provider_transaction_id === parameters[3]
        )) };
      }
      if (statement.startsWith('insert into provider_transactions')) {
        const row = {
          id: `transaction-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          payment_request_id: parameters[2],
          student_contact_id: parameters[3],
          payer_contact_id: parameters[4],
          enrollment_id: parameters[5],
          provider: parameters[7],
          provider_environment: parameters[8],
          provider_transaction_id: parameters[9],
          merchant_reference: parameters[10],
          transaction_kind: 'payment',
          status: 'verified',
          amount: parameters[11],
          currency: parameters[12],
          verified_at: parameters[13],
          receipt_document_id: null,
          metadata_json: JSON.parse(parameters[16]),
        };
        state.transactions.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith("update provider_transactions set status = 'verified'")) {
        const transaction = state.transactions.find((row) => row.id === parameters[1]);
        transaction.status = 'verified';
        transaction.verified_at = parameters[0];
        return { rows: [transaction] };
      }
      if (statement.startsWith('select * from payment_allocations')) {
        const row = state.allocations.find((allocation) => (
          allocation.organization_id === parameters[0]
          && allocation.business_unit_id === parameters[1]
          && allocation.idempotency_key === parameters[2]
        ));
        return { rows: row ? [row] : [] };
      }
      if (statement.startsWith('select * from student_charges')) {
        return { rows: state.charges.filter((row) => row.id === parameters[0]) };
      }
      if (statement.startsWith('select * from provider_transactions') && statement.includes('where id = $1')) {
        return { rows: state.transactions.filter((row) => row.id === parameters[0]) };
      }
      if (statement.startsWith('select coalesce(sum(case when t.transaction_kind')) {
        const allocated = state.allocations
          .filter((row) => row.charge_id === parameters[0])
          .reduce((sum, row) => sum + Number(row.amount), 0);
        return { rows: [{ allocated: allocated.toFixed(2) }] };
      }
      if (statement.startsWith('select coalesce(sum(amount)')) {
        const allocated = state.allocations
          .filter((row) => row.transaction_id === parameters[0])
          .reduce((sum, row) => sum + Number(row.amount), 0);
        return { rows: [{ allocated: allocated.toFixed(2) }] };
      }
      if (statement.startsWith('insert into payment_allocations')) {
        const row = {
          id: `allocation-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          charge_id: parameters[2],
          transaction_id: parameters[3],
          amount: parameters[4],
          idempotency_key: parameters[5],
        };
        state.allocations.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('update student_charges set status')) {
        state.charges.find((row) => row.id === parameters[1]).status = parameters[0];
        return { rows: [] };
      }
      if (statement.startsWith('insert into financial_documents')) {
        const row = {
          id: `receipt-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          contact_id: parameters[2],
          document_number: parameters[3],
          total: parameters[4],
          issue_date: parameters[5],
          items_json: JSON.parse(parameters[6]),
          notes: parameters[7],
        };
        state.documents.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('update provider_transactions set receipt_document_id')) {
        state.transactions.find((row) => row.id === parameters[1]).receipt_document_id = parameters[0];
        return { rows: [] };
      }
      if (statement.startsWith('update contact_course_records')) {
        state.enrollment.metadata_json = { ...state.enrollment.metadata_json, ...JSON.parse(parameters[0]) };
        return { rows: [] };
      }
      if (statement.startsWith('update book_fulfillments')) {
        if (failFulfillment) throw Object.assign(new Error('synthetic fulfillment failure'), { code: 'synthetic_failure' });
        if (state.fulfillment.provider_transaction_id && state.fulfillment.provider_transaction_id !== parameters[0]) {
          return { rows: [] };
        }
        state.fulfillment.provider_transaction_id ||= parameters[0];
        if (state.fulfillment.status === 'payment_pending') state.fulfillment.status = 'pending';
        return { rows: [state.fulfillment] };
      }
      if (statement.startsWith('select * from book_fulfillments')) {
        return { rows: state.fulfillment && state.fulfillment.payment_request_id === parameters[2] ? [state.fulfillment] : [] };
      }
      if (statement.startsWith('insert into activity_events')) {
        const metadata = JSON.parse(parameters[4]);
        const eventType = statement.includes('financial.payment_verified')
          ? 'financial.payment_verified'
          : statement.includes('fulfillment.enqueue_attention')
            ? 'fulfillment.enqueue_attention'
            : 'financial.payment_reconciliation_attention';
        const uniqueValue = eventType === 'financial.payment_verified'
          ? metadata.providerTransactionId
          : eventType === 'fulfillment.enqueue_attention'
            ? metadata.providerTransactionId
            : metadata.paymentProviderEventId;
        const exists = state.activities.some((row) => row.event_type === eventType && row.uniqueValue === uniqueValue);
        if (!exists) state.activities.push({ event_type: eventType, uniqueValue, metadata_json: metadata });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
}

const baseInput = {
  merchantReference: 'AITUSA-REG-ABC123',
  environment: 'uat',
  expectedMerchantId: '123456789012',
  callback,
  now: new Date('2026-09-18T01:00:00.000Z'),
};

test('payment request lookup fails closed when a provider reference is ambiguous', async () => {
  await assert.rejects(
    () => loadDejavooPaymentRequest({
      query: async () => ({ rows: [{ id: 'request-1' }, { id: 'request-2' }] }),
    }, {
      merchantReference: 'AITUSA-REG-ABC123',
      environment: 'uat',
    }),
    (error) => error.code === 'payment_request_ambiguous' && error.status === 409,
  );
});

test('verified payment reconciles transaction, charge, receipt, activity, and unapplied credit exactly once', async () => {
  const client = fakeReconciliationClient();
  const first = await reconcileDejavooPayment(client, { ...baseInput, statusResult: verifiedStatus() });
  const second = await reconcileDejavooPayment(client, { ...baseInput, statusResult: verifiedStatus() });
  assert.equal(first.outcome, 'completed');
  assert.equal(first.unappliedCreditAmount, '145.00');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(client.state.request.status, 'completed');
  assert.equal(client.state.transactions.length, 1);
  assert.equal(client.state.allocations.length, 1);
  assert.equal(client.state.allocations[0].amount, '95.00');
  assert.equal(client.state.charges[0].status, 'paid');
  assert.equal(client.state.documents.length, 1);
  assert.equal(client.state.activities.filter((row) => row.event_type === 'financial.payment_verified').length, 1);
  assert.equal(client.state.events.length, 1);
  assert.equal(client.state.events[0].processing_status, 'processed');
  assert.equal(client.state.enrollment.metadata_json.registrationState, 'payment_verified');
  assert.equal(first.fulfillmentQueued, true);
  assert.equal(first.fulfillmentId, 'fulfillment-1');
  assert.equal(client.state.fulfillment.status, 'pending');
  assert.equal(client.state.fulfillment.provider_transaction_id, first.transactionId);
});

test('SPIn verification records the provider surface while reusing the same ledger invariants', async () => {
  const client = fakeReconciliationClient();
  const result = await reconcileDejavooPayment(client, {
    ...baseInput,
    providerSurface: 'spin',
    statusResult: verifiedStatus({
      correlationId: 'collections:spin:test-001',
      providerTransactionId: 'SPIN-TXN-100',
    }),
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(client.state.transactions.length, 1);
  assert.equal(client.state.transactions[0].metadata_json.providerSurface, 'spin');
  assert.equal(client.state.documents[0].notes, 'Verified Dejavoo terminal payment.');
  assert.equal(client.state.activities[0].metadata_json.providerSurface, 'spin');
});

test('fulfillment enqueue failure records attention without rolling back verified payment', async () => {
  const client = fakeReconciliationClient({ failFulfillment: true });
  const result = await reconcileDejavooPayment(client, { ...baseInput, statusResult: verifiedStatus() });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.fulfillmentQueued, false);
  assert.equal(client.state.request.status, 'completed');
  assert.equal(client.state.transactions.length, 1);
  assert.equal(client.state.allocations.length, 1);
  assert.equal(client.state.activities.filter((row) => row.event_type === 'fulfillment.enqueue_attention').length, 1);
  assert.ok(client.state.calls.some((call) => call.sql === 'rollback to savepoint fulfillment_enqueue'));
  assert.equal(client.state.calls.at(-1).sql, 'commit');
});

test('a reordered failed callback cannot regress a completed payment', async () => {
  const client = fakeReconciliationClient();
  await reconcileDejavooPayment(client, { ...baseInput, statusResult: verifiedStatus() });
  const failedCallback = {
    ...callback,
    payloadSha256: 'b'.repeat(64),
    idempotencyKey: `dejavoo:callback:${'b'.repeat(64)}`,
    safePayload: { ...callback.safePayload, responseMessage: 'Declined' },
  };
  const result = await reconcileDejavooPayment(client, {
    ...baseInput,
    callback: failedCallback,
    statusResult: verifiedStatus({ status: 'failed', providerStatus: 'Declined', providerTransactionId: null }),
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(client.state.request.status, 'completed');
  assert.equal(client.state.transactions.length, 1);
  assert.equal(client.state.documents.length, 1);
});

test('amount mismatch fails closed and creates one operator attention event', async () => {
  const client = fakeReconciliationClient();
  const result = await reconcileDejavooPayment(client, {
    ...baseInput,
    statusResult: verifiedStatus({ amount: { currency: 'USD', minorUnits: 23900, totalMinorUnits: 23900 } }),
  });
  assert.equal(result.outcome, 'review_required');
  assert.equal(result.code, 'amount_mismatch');
  assert.equal(client.state.request.status, 'created');
  assert.equal(client.state.transactions.length, 0);
  assert.equal(client.state.allocations.length, 0);
  assert.equal(client.state.documents.length, 0);
  assert.equal(client.state.events[0].processing_status, 'failed');
  assert.equal(client.state.events[0].error_code, 'amount_mismatch');
  assert.equal(client.state.activities.filter((row) => row.event_type === 'financial.payment_reconciliation_attention').length, 1);
});

test('provider outage stays retryable and the same callback can reconcile later', async () => {
  const client = fakeReconciliationClient();
  const unavailable = await reconcileDejavooPayment(client, {
    ...baseInput,
    statusResult: {
      ok: false,
      correlationId: 'dejavoo:callback:test-002',
      error: { code: 'DEJAVOO_PROVIDER_UNAVAILABLE', retryable: true },
    },
  });
  assert.equal(unavailable.outcome, 'verification_unavailable');
  assert.equal(unavailable.retryable, true);
  assert.equal(client.state.request.status, 'pending');
  assert.equal(client.state.events[0].processing_status, 'failed');
  const recovered = await reconcileDejavooPayment(client, { ...baseInput, statusResult: verifiedStatus() });
  assert.equal(recovered.outcome, 'completed');
  assert.equal(recovered.duplicate, true);
  assert.equal(client.state.request.status, 'completed');
  assert.equal(client.state.transactions.length, 1);
  assert.equal(client.state.documents.length, 1);
});

test('pending verification remains replayable without creating financial state', async () => {
  const client = fakeReconciliationClient();
  const result = await reconcileDejavooPayment(client, {
    ...baseInput,
    statusResult: verifiedStatus({
      status: 'pending',
      providerStatus: 'Pending',
      providerTransactionId: null,
      amount: { currency: 'USD', minorUnits: null, totalMinorUnits: null },
    }),
  });
  assert.equal(result.outcome, 'pending');
  assert.equal(result.retryable, true);
  assert.equal(client.state.request.status, 'pending');
  assert.equal(client.state.events[0].processing_status, 'received');
  assert.equal(client.state.transactions.length, 0);
});
