import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDejavooSpinAdapter,
  dejavooSpinConfigHealth,
  DEJAVOO_SPIN_PRODUCTION_IO_ENABLED_ENV,
  resolveDejavooSpinConfig,
} from './dejavoo-spin.js';

const UAT_ENV = Object.freeze({
  DEJAVOO_UAT_SPIN_TPN: '123456789012',
  DEJAVOO_UAT_SPIN_REGISTER_ID: 'REGISTER_01',
  DEJAVOO_UAT_SPIN_AUTH_KEY: 'A1B2C3D4E5',
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function approved(overrides = {}) {
  return {
    GeneralResponse: {
      ResultCode: '0',
      StatusCode: '0000',
      HostResponseCode: '00',
      HostResponseMessage: 'APPROVED',
      Message: 'OK',
    },
    ReferenceId: 'AITUSA_SPIN_001',
    PNReferenceId: 'provider-transaction-001',
    Amounts: { Amount: 10, TotalAmount: 10, TipAmount: 0, FeeAmount: 0 },
    CardData: { CardBrand: 'VISA', Last4: '4242' },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    correlationId: 'mis-422:terminal:001',
    merchantReference: 'AITUSA_SPIN_001',
    amountCents: 1000,
    currency: 'USD',
    ...overrides,
  };
}

test('resolves only environment-qualified SPIn configuration', () => {
  const config = resolveDejavooSpinConfig({
    environment: 'uat',
    env: { ...UAT_ENV, DEJAVOO_SPIN_AUTH_KEY: 'must-not-be-used' },
  });
  assert.equal(config.valid, true);
  assert.equal(config.baseUrl, 'https://test.spinpos.net');
  assert.equal(config.authKey, UAT_ENV.DEJAVOO_UAT_SPIN_AUTH_KEY);
});

test('fails production closed without its explicit I/O gate', () => {
  const health = dejavooSpinConfigHealth({
    environment: 'production',
    env: {
      DEJAVOO_PROD_SPIN_TPN: '987654321098',
      DEJAVOO_PROD_SPIN_REGISTER_ID: 'REGISTER_02',
      DEJAVOO_PROD_SPIN_AUTH_KEY: 'Z9Y8X7W6V5',
    },
  });
  assert.equal(health.ready, false);
  assert.equal(health.endpointHost, 'spinpos.net');
  assert.deepEqual(health.missing, [DEJAVOO_SPIN_PRODUCTION_IO_ENABLED_ENV]);
});

test('reports missing values by variable name without exposing supplied values', () => {
  const health = dejavooSpinConfigHealth({
    environment: 'uat',
    env: { DEJAVOO_UAT_SPIN_TPN: '123456789012' },
  });
  assert.equal(health.ready, false);
  assert.deepEqual(health.missing, [
    'DEJAVOO_UAT_SPIN_REGISTER_ID',
    'DEJAVOO_UAT_SPIN_AUTH_KEY',
  ]);
  assert.doesNotMatch(JSON.stringify(health), /123456789012/);
});

test('creates one fixed-amount sale without retrying a mutating request', async () => {
  const calls = [];
  const adapter = createDejavooSpinAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(200, approved());
    },
  });
  const result = await adapter.createTerminalSale(input());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.providerTransactionId, 'provider-transaction-001');
  assert.equal(result.amount.minorUnits, 1000);
  assert.equal(result.amount.totalMinorUnits, 1000);
  assert.equal(result.card.last4, '4242');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://test.spinpos.net/v2/Payment/Sale');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.Amount, 10);
  assert.equal(payload.TipAmount, 0);
  assert.equal(payload.CustomFee, 0);
  assert.equal(payload.ReferenceId, 'AITUSA_SPIN_001');
  assert.equal(payload.Tpn, UAT_ENV.DEJAVOO_UAT_SPIN_TPN);
  assert.equal(payload.RegisterId, UAT_ENV.DEJAVOO_UAT_SPIN_REGISTER_ID);
  assert.equal(payload.Authkey, UAT_ENV.DEJAVOO_UAT_SPIN_AUTH_KEY);
  assert.doesNotMatch(JSON.stringify(result), /A1B2C3D4E5|REGISTER_01/);
});

test('marks a timed-out sale uncertain and never retries it', async () => {
  let calls = 0;
  const adapter = createDejavooSpinAdapter({
    environment: 'uat',
    env: UAT_ENV,
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      calls += 1;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });
  const result = await adapter.createTerminalSale(input());
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.equal(result.status, 'unknown');
  assert.equal(result.error.code, 'DEJAVOO_SPIN_TIMEOUT');
});

test('status lookup safely retries a provider outage and returns the authoritative result', async () => {
  let calls = 0;
  const adapter = createDejavooSpinAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(503, { GeneralResponse: { Message: 'Unavailable' } }) : response(200, approved());
    },
  });
  const result = await adapter.queryTerminalStatus(input({ amountCents: undefined, currency: undefined }));
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.merchantReference, 'AITUSA_SPIN_001');
});

test('normalizes explicit decline without inventing a successful transaction', async () => {
  const adapter = createDejavooSpinAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => response(200, approved({
      GeneralResponse: {
        ResultCode: '1',
        StatusCode: '1001',
        HostResponseCode: '05',
        HostResponseMessage: 'DECLINED',
        Message: 'Transaction declined',
      },
      PNReferenceId: '',
    })),
  });
  const result = await adapter.createTerminalSale(input());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.providerTransactionId, null);
});

test('blocks invalid amount and global external-I/O kill switch before network access', async () => {
  let calls = 0;
  const invalid = createDejavooSpinAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => { calls += 1; },
  });
  const amountResult = await invalid.createTerminalSale(input({ amountCents: 0 }));
  assert.equal(amountResult.error.code, 'DEJAVOO_SPIN_AMOUNT_INVALID');

  const disabled = createDejavooSpinAdapter({
    environment: 'uat',
    env: { ...UAT_ENV, AIT_CRM_EXTERNAL_IO_DISABLED: 'true' },
    fetchImpl: async () => { calls += 1; },
  });
  const disabledResult = await disabled.queryTerminalStatus(input());
  assert.equal(disabledResult.error.code, 'EXTERNAL_IO_DISABLED');
  assert.equal(calls, 0);
});
