import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverHppPayment } from './hpp-recovery.js';

const paymentRequestId = '5f575c29-7018-4797-b7b1-d1869cebfda1';
const merchantReference = 'S67EF8FDAA29645C782C';
const hash = 'a'.repeat(64);
const env = {
  DEJAVOO_PROD_API_KEY: 'private-api-key',
  DEJAVOO_PROD_SECRET_KEY: 'private-secret-key',
  DEJAVOO_PROD_CLOUDPOS_TPN: '987654321098',
  DEJAVOO_PROD_ECOM_TOKEN: 'private-ecom-token',
  DEJAVOO_PRODUCTION_STATUS_RECHECK_ENABLED: 'true',
};
const request = { id: paymentRequestId, status: 'pending', merchant_reference: merchantReference };
const event = {
  payload_sha256: hash,
  idempotency_key: `dejavoo:callback:${hash}`,
  safe_payload_json: {
    callback: {
      responseCode: '200', responseMessage: 'Success', transactionReferenceId: merchantReference,
      transactionId: 'provider-txn-1', amount: '100', totalAmount: '100',
    },
  },
};
const scope = { paymentRequestId, organizationId: 'org-1', businessUnitId: 'bu-1', environment: 'production', env };

function fakeClient({ requestRow = request, events = [event] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('from payment_requests')) return { rows: requestRow ? [requestRow] : [] };
      if (sql.includes('from payment_provider_events')) return { rows: events };
      throw new Error('Unexpected SQL');
    },
  };
}

function status(overrides = {}) {
  return {
    ok: true, status: 'succeeded', providerStatus: 'Successful', providerTransactionId: 'provider-txn-1',
    provider: { responseCode: '200' },
    amount: { currency: 'USD', minorUnits: 100, totalMinorUnits: 100 },
    ...overrides,
  };
}

test('rechecks a scoped request and reuses its authenticated callback for idempotent reconciliation', async () => {
  const client = fakeClient();
  let reconciled = 0;
  const result = await recoverHppPayment(client, {
    ...scope,
    adapter: { queryPaymentStatus: async (input) => {
      assert.equal(input.merchantReference, merchantReference);
      assert.equal(input.merchantId, env.DEJAVOO_PROD_CLOUDPOS_TPN);
      return status();
    } },
    reconcile: async (_client, input) => {
      reconciled += 1;
      assert.equal(input.callback.idempotencyKey, event.idempotency_key);
      assert.equal(input.statusResult.providerTransactionId, event.safe_payload_json.callback.transactionId);
      return { outcome: 'completed', duplicate: true, paymentRequestId };
    },
  });
  assert.equal(reconciled, 1);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(client.calls[0].params, [paymentRequestId, 'org-1', 'bu-1', 'production']);
});

test('does not book a mismatched transaction, amount, or terminal conflict', async () => {
  for (const providerStatus of [
    status({ providerTransactionId: 'another-transaction' }),
    status({ amount: { currency: 'USD', minorUnits: 200, totalMinorUnits: 200 } }),
    status({ provider: { responseCode: '400' } }),
    status({ status: 'failed', providerStatus: 'Declined' }),
  ]) {
    const result = await recoverHppPayment(fakeClient(), {
      ...scope,
      adapter: { queryPaymentStatus: async () => providerStatus },
      reconcile: async () => { throw new Error('Must not reconcile a conflict'); },
    });
    assert.equal(result.outcome, 'review_required');
  }
});

test('keeps a pending provider query pending and supports later recheck', async () => {
  const result = await recoverHppPayment(fakeClient(), {
    ...scope,
    adapter: { queryPaymentStatus: async () => status({ status: 'pending', providerStatus: 'Pending', providerTransactionId: null }) },
    reconcile: async (_client, input) => {
      assert.equal(input.statusResult.status, 'pending');
      return { outcome: 'pending' };
    },
  });
  assert.equal(result.outcome, 'pending');
});

test('refuses provider I/O without its status-only flag or an authenticated successful callback', async () => {
  let called = false;
  const adapter = { queryPaymentStatus: async () => { called = true; return status(); } };
  await assert.rejects(() => recoverHppPayment(fakeClient(), {
    ...scope, env: { ...env, DEJAVOO_PRODUCTION_STATUS_RECHECK_ENABLED: '' }, adapter,
  }), /not enabled/);
  const result = await recoverHppPayment(fakeClient({ events: [] }), { ...scope, adapter });
  assert.equal(result.reason, 'successful_callback_missing');
  assert.equal(called, false);
});

test('returns completed without another provider call and rejects out-of-scope requests', async () => {
  const adapter = { queryPaymentStatus: async () => { throw new Error('Must not query provider'); } };
  const completed = await recoverHppPayment(fakeClient({ requestRow: { ...request, status: 'completed' } }), { ...scope, adapter });
  assert.equal(completed.outcome, 'already_completed');
  await assert.rejects(() => recoverHppPayment(fakeClient({ requestRow: null }), { ...scope, adapter }), /not found/);
});
