import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DejavooCallbackError,
  parseDejavooCallback,
  resolveDejavooCallbackEnvironment,
} from './dejavoo-callback.js';

const env = {
  DEJAVOO_UAT_CALLBACK_AUTH_HEADER: 'Bearer uat-callback-private',
  DEJAVOO_PROD_CALLBACK_AUTH_HEADER: 'Bearer prod-callback-private',
  DEJAVOO_PRODUCTION_IO_ENABLED: 'true',
};

test('callback authorization selects one explicit environment and production fails closed', () => {
  assert.equal(resolveDejavooCallbackEnvironment({
    authorization: env.DEJAVOO_UAT_CALLBACK_AUTH_HEADER,
    env,
  }), 'uat');
  assert.equal(resolveDejavooCallbackEnvironment({
    authorization: env.DEJAVOO_PROD_CALLBACK_AUTH_HEADER,
    env,
  }), 'production');
  assert.throws(
    () => resolveDejavooCallbackEnvironment({
      authorization: env.DEJAVOO_PROD_CALLBACK_AUTH_HEADER,
      env: { ...env, DEJAVOO_PRODUCTION_IO_ENABLED: 'false' },
    }),
    (error) => error instanceof DejavooCallbackError
      && error.code === 'production_io_disabled'
      && error.status === 503,
  );
});

test('callback authorization rejects missing, invalid, and shared credentials', () => {
  assert.throws(
    () => resolveDejavooCallbackEnvironment({ authorization: 'Bearer wrong', env }),
    (error) => error.code === 'callback_unauthorized' && error.status === 401,
  );
  assert.throws(
    () => resolveDejavooCallbackEnvironment({ authorization: 'Bearer anything', env: {} }),
    (error) => error.code === 'callback_auth_not_configured' && error.status === 503,
  );
  assert.throws(
    () => resolveDejavooCallbackEnvironment({
      authorization: 'Bearer shared',
      env: {
        DEJAVOO_UAT_CALLBACK_AUTH_HEADER: 'Bearer shared',
        DEJAVOO_PROD_CALLBACK_AUTH_HEADER: 'Bearer shared',
      },
    }),
    (error) => error.code === 'callback_auth_ambiguous' && error.status === 503,
  );
});

test('callback parser hashes the raw body and retains only reconciliation-safe fields', () => {
  const rawBody = JSON.stringify({
    iposHPResponse: {
      responseCode: 200,
      responseMessage: 'Successful',
      transactionReferenceId: 'AITUSA-REG-ABC123',
      transactionId: 'HPP-TXN-100',
      amount: '9500',
      totalAmount: '9500',
      cardType: 'VISA',
      cardLast4Digit: '4242',
      cardToken: 'must-not-persist',
      consumerId: 'must-not-persist',
    },
  });
  const parsed = parseDejavooCallback({ rawBody, contentType: 'application/json; charset=utf-8' });
  assert.equal(parsed.merchantReference, 'AITUSA-REG-ABC123');
  assert.equal(parsed.providerTransactionId, 'HPP-TXN-100');
  assert.match(parsed.payloadSha256, /^[a-f0-9]{64}$/);
  assert.equal(parsed.idempotencyKey, `dejavoo:callback:${parsed.payloadSha256}`);
  assert.deepEqual(parsed.safePayload, {
    responseCode: '200',
    responseMessage: 'Successful',
    errResponseCode: null,
    errResponseMessage: null,
    transactionReferenceId: 'AITUSA-REG-ABC123',
    transactionId: 'HPP-TXN-100',
    amount: '9500',
    totalAmount: '9500',
  });
  assert.equal(JSON.stringify(parsed).includes('4242'), false);
  assert.equal(JSON.stringify(parsed).includes('must-not-persist'), false);
});

test('callback parser rejects non-JSON, oversized, malformed, and reference-free bodies', () => {
  assert.throws(
    () => parseDejavooCallback({ rawBody: '{}', contentType: 'text/plain' }),
    (error) => error.code === 'callback_content_type_invalid' && error.status === 415,
  );
  assert.throws(
    () => parseDejavooCallback({ rawBody: '{', contentType: 'application/json' }),
    (error) => error.code === 'callback_json_invalid',
  );
  assert.throws(
    () => parseDejavooCallback({ rawBody: JSON.stringify({ status: 'Successful' }), contentType: 'application/json' }),
    (error) => error.code === 'callback_reference_invalid',
  );
  assert.throws(
    () => parseDejavooCallback({ rawBody: `{"transactionReferenceId":"AITUSA-REG-ABC123","padding":"${'x'.repeat(70_000)}"}`, contentType: 'application/json' }),
    (error) => error.code === 'callback_body_invalid' && error.status === 413,
  );
});
