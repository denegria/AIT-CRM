import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDejavooAdapter,
  dejavooConfigHealth,
  DEJAVOO_ENVIRONMENTS,
  DEJAVOO_PRODUCTION_IO_ENABLED_ENV,
  resolveDejavooConfig,
} from './dejavoo.js';

const UAT_ENV = Object.freeze({
  DEJAVOO_UAT_API_KEY: 'uat-api-key-private',
  DEJAVOO_UAT_SECRET_KEY: 'uat-secret-key-private',
  DEJAVOO_UAT_CLOUDPOS_TPN: '123456789012',
  DEJAVOO_UAT_ECOM_TOKEN: 'uat-ecom-token-private',
});

const PROD_ENV = Object.freeze({
  DEJAVOO_PROD_API_KEY: 'prod-api-key-private',
  DEJAVOO_PROD_SECRET_KEY: 'prod-secret-key-private',
  DEJAVOO_PROD_CLOUDPOS_TPN: '987654321098',
  DEJAVOO_PROD_ECOM_TOKEN: 'prod-ecom-token-private',
  [DEJAVOO_PRODUCTION_IO_ENABLED_ENV]: 'true',
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function jwt(expSeconds = 4_102_444_800) {
  return `header.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.signature`;
}

function createInput(overrides = {}) {
  return {
    correlationId: 'mis-415:create:001',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
    amountCents: 9500,
    currency: 'USD',
    returnUrl: 'https://staging.example.com/payments/return',
    failureUrl: 'https://staging.example.com/payments/failure',
    cancelUrl: 'https://staging.example.com/payments/cancel',
    postUrl: 'https://staging.example.com/api/payments/dejavoo/callback',
    postAuthHeader: 'Bearer callback-secret-private',
    customer: {
      name: 'Ada Student',
      email: 'ada@example.com',
      mobile: '+15551234567',
    },
    personalization: {
      merchantName: 'AIT USA',
      description: 'Registration and book',
      payNowButtonText: 'Pay securely',
    },
    ...overrides,
  };
}

test('resolves only environment-qualified UAT configuration', () => {
  const config = resolveDejavooConfig({
    environment: DEJAVOO_ENVIRONMENTS.UAT,
    env: {
      ...UAT_ENV,
      DEJAVOO_API_KEY: 'must-not-be-used',
      DEJAVOO_SECRET_KEY: 'must-not-be-used',
    },
  });

  assert.equal(config.valid, true);
  assert.equal(config.apiKey, UAT_ENV.DEJAVOO_UAT_API_KEY);
  assert.equal(config.secretKey, UAT_ENV.DEJAVOO_UAT_SECRET_KEY);
  assert.equal(config.authUrl, 'https://auth.ipospays.tech/v1/authenticate-token');
  assert.equal(config.hppUrl, 'https://payment.ipospays.tech/api/v3/external-payment-transaction');
  assert.equal(config.statusUrl, 'https://api.ipospays.tech/v1/queryPaymentStatus');
});

test('fails production configuration closed without the explicit production I/O gate', () => {
  const env = { ...PROD_ENV };
  delete env[DEJAVOO_PRODUCTION_IO_ENABLED_ENV];
  const health = dejavooConfigHealth({ environment: 'production', env });

  assert.equal(health.ready, false);
  assert.equal(health.productionIoEnabled, false);
  assert.deepEqual(health.missing, [DEJAVOO_PRODUCTION_IO_ENABLED_ENV]);
  assert.deepEqual(health.endpoints, {
    authHost: 'auth.ipospays.com',
    hppHost: 'payment.ipospays.com',
    statusHost: 'api.ipospays.com',
  });
});

test('reports missing configuration by variable name without exposing values', () => {
  const health = dejavooConfigHealth({
    environment: 'uat',
    env: { DEJAVOO_UAT_API_KEY: 'present-but-private' },
  });

  assert.equal(health.ready, false);
  assert.deepEqual(health.missing, [
    'DEJAVOO_UAT_SECRET_KEY',
    'DEJAVOO_UAT_CLOUDPOS_TPN',
    'DEJAVOO_UAT_ECOM_TOKEN',
  ]);
  assert.equal(JSON.stringify(health).includes('present-but-private'), false);
});

test('blocks incomplete configuration before any provider request', async () => {
  let called = false;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: { DEJAVOO_UAT_API_KEY: 'present-but-private' },
    fetchImpl: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });

  const result = await adapter.createHostedPaymentPage(createInput());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEJAVOO_CONFIG_MISSING');
  assert.equal(called, false);
});

test('creates a fixed-amount HPP, omits auth scope, and caches the access token', async () => {
  const calls = [];
  const accessToken = jwt();
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('authenticate-token')) {
      return response(200, {
        responseCode: '00',
        responseMessage: 'Success',
        token: accessToken,
      });
    }
    return response(200, {
      message: 'URL generated successfully',
      information: `https://pay.ipospays.tech/externalPay?t=hpp-${calls.length}`,
    });
  };
  const adapter = createDejavooAdapter({ environment: 'uat', env: UAT_ENV, fetchImpl });

  const first = await adapter.createHostedPaymentPage(createInput());
  const second = await adapter.createHostedPaymentPage(createInput({
    correlationId: 'mis-415:create:002',
    merchantReference: 'AITUSA-REG-ABC124',
  }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.checkout.origin, 'https://pay.ipospays.tech');
  assert.equal(first.amount.minorUnits, 9500);
  assert.equal(calls.filter((call) => call.url.includes('authenticate-token')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('external-payment-transaction')).length, 2);

  const authCall = calls[0];
  assert.equal(authCall.options.method, 'POST');
  assert.equal(authCall.options.headers.apiKey, UAT_ENV.DEJAVOO_UAT_API_KEY);
  assert.equal(authCall.options.headers.secretKey, UAT_ENV.DEJAVOO_UAT_SECRET_KEY);
  assert.equal(authCall.options.headers.TokenExpiryMinutes, '30');
  assert.equal(Object.hasOwn(authCall.options.headers, 'scope'), false);

  const hppCall = calls[1];
  const payload = JSON.parse(hppCall.options.body);
  assert.equal(hppCall.options.headers.token, accessToken);
  assert.deepEqual(payload.merchantAuthentication, {
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    transactionReferenceId: 'AITUSA-REG-ABC123',
  });
  assert.deepEqual(payload.transactionRequest, {
    transactionType: 1,
    amount: '9500',
    calculateFee: false,
    tipsInputPrompt: false,
    calculateTax: false,
    expiry: 1,
  });
  assert.deepEqual(payload.notificationOption, {
    notifyByRedirect: true,
    returnUrl: 'https://staging.example.com/payments/return',
    failureUrl: 'https://staging.example.com/payments/failure',
    cancelUrl: 'https://staging.example.com/payments/cancel',
    notifyBySMS: false,
    mobileNumber: '',
    notifyByPOST: true,
    postAPI: 'https://staging.example.com/api/payments/dejavoo/callback',
    authHeader: 'Bearer callback-secret-private',
  });
  assert.equal(payload.preferences.requestCardToken, false);
  assert.equal(payload.preferences.sendPaymentLink, false);
  assert.equal(payload.preferences.customerName, 'Ada Student');
  assert.equal(JSON.stringify(first).includes(accessToken), false);
  assert.equal(JSON.stringify(first).includes(UAT_ENV.DEJAVOO_UAT_SECRET_KEY), false);
  assert.equal(JSON.stringify(first).includes('callback-secret-private'), false);
});

test('never automatically retries HPP creation after the request starts', async () => {
  let authCalls = 0;
  let hppCalls = 0;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async (url) => {
      if (String(url).includes('authenticate-token')) {
        authCalls += 1;
        return response(200, { token: jwt(), responseCode: '00' });
      }
      hppCalls += 1;
      throw new Error('connection reset after write');
    },
  });

  const result = await adapter.createHostedPaymentPage(createInput());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEJAVOO_NETWORK_ERROR');
  assert.equal(result.error.retryable, true);
  assert.equal(authCalls, 1);
  assert.equal(hppCalls, 1);
});

test('retries authentication once on a transient provider error', async () => {
  let authCalls = 0;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async (url) => {
      if (String(url).includes('authenticate-token')) {
        authCalls += 1;
        return authCalls === 1
          ? response(503, { message: 'temporary outage' })
          : response(200, { token: jwt(), responseCode: '00' });
      }
      return response(200, {
        message: 'URL generated successfully',
        information: 'https://payment.ipospays.tech/api/v1/externalPay?t=retry-success',
      });
    },
  });

  const result = await adapter.createHostedPaymentPage(createInput());

  assert.equal(result.ok, true);
  assert.equal(authCalls, 2);
});

test('normalizes status responses and retries the safe GET once', async () => {
  const calls = [];
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return response(503, { message: 'temporary outage' });
      return response(200, {
        iposHPResponse: {
          responseCode: '200',
          responseMessage: 'Successful',
          transactionReferenceId: 'AITUSA-REG-ABC123',
          transactionId: 'HPP-TXN-100',
          amount: '9500',
          totalAmount: '9500',
        },
      });
    },
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:001',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, true);
  assert.equal(result.merchantId, UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.providerStatus, 'Successful');
  assert.equal(result.providerTransactionId, 'HPP-TXN-100');
  assert.deepEqual(result.amount, { currency: 'USD', minorUnits: 9500, totalMinorUnits: 9500 });
  assert.equal(calls.length, 2);
  const url = new URL(calls[1].url);
  assert.equal(url.origin, 'https://api.ipospays.tech');
  assert.equal(url.searchParams.get('tpn'), UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN);
  assert.equal(url.searchParams.get('transactionReferenceId'), 'AITUSA-REG-ABC123');
  assert.equal(calls[1].options.headers.Authorization, UAT_ENV.DEJAVOO_UAT_ECOM_TOKEN);
});

test('does not immediately retry a provider rate limit', async () => {
  let calls = 0;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => {
      calls += 1;
      return response(429, { errorCode: 'RATE_LIMIT', errorMessage: 'Try later.' });
    },
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:rate-limit',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'rate_limited');
  assert.equal(result.error.retryable, true);
  assert.equal(calls, 1);
});

test('normalizes untouched payment requests as pending', async () => {
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => response(200, { status: 'Pending' }),
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:002',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'pending');
  assert.equal(result.amount.minorUnits, null);
});

test('rejects a provider status response for a different reference', async () => {
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => response(200, {
      iposHPResponse: {
        responseMessage: 'Successful',
        transactionReferenceId: 'AITUSA-REG-DIFFERENT',
      },
    }),
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:003',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEJAVOO_REFERENCE_MISMATCH');
  assert.equal(result.error.category, 'invalid_response');
});

test('fails closed before network access for merchant, currency, and callback mismatches', async () => {
  let calls = 0;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  });

  const merchant = await adapter.createHostedPaymentPage(createInput({ merchantId: '000000000000' }));
  const currency = await adapter.createHostedPaymentPage(createInput({ currency: 'EUR' }));
  const callback = await adapter.createHostedPaymentPage(createInput({ returnUrl: 'http://unsafe.example.com' }));
  const postAuth = await adapter.createHostedPaymentPage(createInput({ postAuthHeader: '' }));

  assert.equal(merchant.error.code, 'DEJAVOO_MERCHANT_MISMATCH');
  assert.equal(currency.error.code, 'DEJAVOO_CURRENCY_UNSUPPORTED');
  assert.equal(callback.error.code, 'DEJAVOO_CALLBACK_URL_INVALID');
  assert.equal(postAuth.error.code, 'DEJAVOO_POST_AUTH_INVALID');
  assert.equal(calls, 0);
});

test('rejects an HPP URL outside the environment allowlist', async () => {
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async (url) => String(url).includes('authenticate-token')
      ? response(200, { token: jwt(), responseCode: '00' })
      : response(200, {
        message: 'URL generated successfully',
        information: 'https://attacker.example/externalPay?t=stolen',
      }),
  });

  const result = await adapter.createHostedPaymentPage(createInput());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEJAVOO_HPP_URL_INVALID');
});

test('maps provider errors without returning configured secrets or raw payloads', async () => {
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    fetchImpl: async () => response(401, {
      errorCode: 'AUTH_ERR_004',
      errorMessage: `Invalid ${UAT_ENV.DEJAVOO_UAT_SECRET_KEY} https://private.example/token`,
      raw: UAT_ENV.DEJAVOO_UAT_API_KEY,
    }),
  });

  const result = await adapter.createHostedPaymentPage(createInput());
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'authentication_error');
  assert.equal(result.provider.responseCode, 'AUTH_ERR_004');
  assert.equal(serialized.includes(UAT_ENV.DEJAVOO_UAT_API_KEY), false);
  assert.equal(serialized.includes(UAT_ENV.DEJAVOO_UAT_SECRET_KEY), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(Object.hasOwn(result.provider, 'raw'), false);
});

test('returns a stable timeout after one bounded retry for status lookup', async () => {
  let calls = 0;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: UAT_ENV,
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('timed out');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:004',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DEJAVOO_TIMEOUT');
  assert.equal(result.error.retryable, true);
  assert.equal(calls, 2);
});

test('global external-I/O kill switch blocks requests before fetch', async () => {
  let called = false;
  const adapter = createDejavooAdapter({
    environment: 'uat',
    env: { ...UAT_ENV, AIT_CRM_EXTERNAL_IO_DISABLED: 'true' },
    fetchImpl: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });

  const result = await adapter.queryPaymentStatus({
    correlationId: 'mis-415:status:005',
    merchantId: UAT_ENV.DEJAVOO_UAT_CLOUDPOS_TPN,
    merchantReference: 'AITUSA-REG-ABC123',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EXTERNAL_IO_DISABLED');
  assert.equal(called, false);
});

test('live health check authenticates without exposing the access token', async () => {
  const accessToken = jwt();
  const calls = [];
  const adapter = createDejavooAdapter({
    environment: 'production',
    env: PROD_ENV,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(200, { responseCode: '00', responseMessage: 'Success', token: accessToken });
    },
  });

  const health = await adapter.checkHealth({
    authenticate: true,
    correlationId: 'mis-415:health:001',
  });

  assert.equal(health.ready, true);
  assert.equal(health.authenticated, true);
  assert.equal(health.tokenCached, false);
  assert.equal(calls[0].url, 'https://auth.ipospays.com/v1/authenticate-token');
  assert.equal(Object.hasOwn(calls[0].options.headers, 'scope'), false);
  assert.equal(JSON.stringify(health).includes(accessToken), false);
});
