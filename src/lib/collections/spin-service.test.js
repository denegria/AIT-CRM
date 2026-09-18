import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initiateSpinCollectionPayment,
  recoverSpinCollectionPayment,
} from './spin-service.js';

function requestRow(metadata = {}) {
  return {
    id: 'request-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-usa',
    student_contact_id: 'student-1',
    payer_contact_id: 'student-1',
    charge_id: 'charge-1',
    requested_amount: '10.00',
    currency: 'USD',
    status: 'created',
    provider: null,
    provider_environment: null,
    merchant_reference: 'AITUSA_SPIN_001',
    source_reference: 'collection-1',
    metadata_json: metadata,
  };
}

function fakeClient(metadata = {}) {
  const state = {
    request: requestRow(metadata),
    events: [],
    calls: [],
    next: 1,
  };
  return {
    state,
    async query(sql, parameters = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: statement, parameters });
      if (['begin', 'commit', 'rollback'].includes(statement) || statement.startsWith('select pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (statement.startsWith('select * from payment_requests') && statement.includes('where id = $1')) {
        return { rows: state.request.id === parameters[0] ? [state.request] : [] };
      }
      if (statement.startsWith('select * from payment_requests') && statement.includes('merchant_reference = $1')) {
        return { rows: state.request.merchant_reference === parameters[0] ? [state.request] : [] };
      }
      if (statement.startsWith('update payment_requests') && statement.includes("provider = 'dejavoo'")) {
        state.request.provider = 'dejavoo';
        state.request.provider_environment = parameters[0];
        state.request.provider_request_id = parameters[1];
        state.request.status = 'pending';
        state.request.metadata_json = { ...state.request.metadata_json, ...JSON.parse(parameters[2]) };
        return { rows: [] };
      }
      if (statement.startsWith('select id from contacts')) return { rows: [{ id: parameters[0] }] };
      if (statement.startsWith('insert into payment_provider_events')) {
        const existing = state.events.find((event) => event.idempotency_key === parameters[14]);
        if (existing) return { rows: [] };
        const event = {
          id: `event-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          payment_request_id: parameters[2],
          provider: parameters[8],
          provider_environment: parameters[9],
          event_type: parameters[11],
          processing_status: 'received',
          payload_sha256: parameters[12],
          safe_payload_json: JSON.parse(parameters[13]),
          idempotency_key: parameters[14],
        };
        state.events.push(event);
        return { rows: [event] };
      }
      if (statement.startsWith('select * from payment_provider_events')) {
        const event = state.events.find((row) => row.idempotency_key === parameters[2]);
        return { rows: event ? [event] : [] };
      }
      if (statement.startsWith('update payment_provider_events')) {
        const event = state.events.find((row) => row.id === parameters[5]);
        event.processing_status = parameters[0];
        event.error_code = parameters[1];
        event.safe_payload_json = JSON.parse(parameters[3]);
        return { rows: [] };
      }
      if (statement.startsWith('update payment_requests set status')) {
        if (parameters[2].includes(state.request.status)) state.request.status = parameters[0];
        return { rows: [] };
      }
      if (statement.startsWith('update payment_requests') && statement.includes('metadata_json =')) {
        state.request.metadata_json = { ...state.request.metadata_json, ...JSON.parse(parameters[0]) };
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
}

function pendingStatus(overrides = {}) {
  return {
    ok: true,
    status: 'unknown',
    providerStatus: 'Processing',
    providerTransactionId: null,
    environment: 'uat',
    merchantId: '123456789012',
    merchantReference: 'AITUSA_SPIN_001',
    amount: { currency: 'USD', minorUnits: null, totalMinorUnits: null },
    correlationId: 'collections:spin:fixture',
    ...overrides,
  };
}

function baseInput(adapter) {
  return {
    organizationId: 'org-1',
    businessUnitId: 'bu-usa',
    paymentRequestId: 'request-1',
    idempotencyKey: 'collections:spin:fixture-1',
    environment: 'uat',
    actorUserId: 'user-1',
    now: new Date('2026-09-18T18:00:00.000Z'),
    adapter,
  };
}

test('terminal initiation uses the authoritative request amount and leaves unknown outcome pending', async () => {
  const client = fakeClient();
  let saleInput;
  let statusCalls = 0;
  const result = await initiateSpinCollectionPayment(client, baseInput({
    async createTerminalSale(input) {
      saleInput = input;
      return { ok: false, status: 'unknown', uncertain: true, correlationId: input.correlationId, error: { code: 'DEJAVOO_SPIN_TIMEOUT' } };
    },
    async queryTerminalStatus() {
      statusCalls += 1;
      return pendingStatus();
    },
  }));
  assert.equal(saleInput.amountCents, 1000);
  assert.equal(saleInput.currency, 'USD');
  assert.equal(statusCalls, 1);
  assert.equal(result.outcome, 'pending');
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryGuidance, /Do not start another terminal payment/);
  assert.equal(client.state.request.status, 'pending');
  assert.equal(client.state.events.length, 1);
  assert.equal(client.state.events[0].processing_status, 'received');
  assert.equal(client.state.events[0].safe_payload_json.callback.providerSurface, 'spin');
  assert.equal(client.state.request.metadata_json.terminalPaymentAttempt.state, 'pending');
});

test('an existing terminal attempt blocks duplicate initiation before provider I/O', async () => {
  const client = fakeClient({ terminalPaymentAttempt: { state: 'pending', correlationId: 'existing' } });
  let called = false;
  await assert.rejects(
    () => initiateSpinCollectionPayment(client, baseInput({
      async createTerminalSale() { called = true; },
      async queryTerminalStatus() { called = true; },
    })),
    (error) => error.code === 'terminal_attempt_exists' && error.status === 409,
  );
  assert.equal(called, false);
});

test('a hosted attempt blocks terminal initiation before provider I/O', async () => {
  const client = fakeClient({ hostedPaymentAttempt: { state: 'created', correlationId: 'hpp-existing' } });
  await assert.rejects(
    () => initiateSpinCollectionPayment(client, baseInput({})),
    (error) => error.code === 'payment_request_provider_conflict' && error.status === 409,
  );
});

test('explicit terminal decline becomes a final failed request without a status query', async () => {
  const client = fakeClient();
  let statusCalls = 0;
  const result = await initiateSpinCollectionPayment(client, baseInput({
    async createTerminalSale(input) {
      return pendingStatus({
        status: 'failed',
        providerStatus: 'DECLINED',
        correlationId: input.correlationId,
      });
    },
    async queryTerminalStatus() { statusCalls += 1; },
  }));
  assert.equal(statusCalls, 0);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.recoveryRequired, false);
  assert.equal(client.state.request.status, 'failed');
  assert.equal(client.state.events[0].processing_status, 'processed');
});

test('recovery performs status only and keeps the same correlation id', async () => {
  const client = fakeClient({ terminalPaymentAttempt: { state: 'pending', correlationId: 'collections:spin:original' } });
  client.state.request.provider = 'dejavoo';
  client.state.request.provider_environment = 'uat';
  client.state.request.status = 'pending';
  let saleCalls = 0;
  let statusInput;
  const result = await recoverSpinCollectionPayment(client, baseInput({
    async createTerminalSale() { saleCalls += 1; },
    async queryTerminalStatus(input) {
      statusInput = input;
      return pendingStatus({ correlationId: input.correlationId });
    },
  }));
  assert.equal(saleCalls, 0);
  assert.equal(statusInput.correlationId, 'collections:spin:original');
  assert.equal(result.outcome, 'pending');
});
