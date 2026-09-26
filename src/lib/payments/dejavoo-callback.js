import { createHash, timingSafeEqual } from 'node:crypto';

import { DEJAVOO_ENVIRONMENTS } from './providers/dejavoo.js';

export const DEJAVOO_CALLBACK_AUTH_ENV = Object.freeze({
  [DEJAVOO_ENVIRONMENTS.UAT]: 'DEJAVOO_UAT_CALLBACK_AUTH_HEADER',
  [DEJAVOO_ENVIRONMENTS.PRODUCTION]: 'DEJAVOO_PROD_CALLBACK_AUTH_HEADER',
});

export const DEJAVOO_CALLBACK_MAX_BYTES = 64 * 1024;

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export class DejavooCallbackError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DejavooCallbackError';
    this.code = code;
    this.status = status;
  }
}

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function enabled(value) {
  return TRUE_VALUES.has(clean(value).toLowerCase());
}

function secretMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  if (!actualBuffer.length || actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function resolveDejavooCallbackEnvironment({ authorization, env = process.env } = {}) {
  const configured = Object.entries(DEJAVOO_CALLBACK_AUTH_ENV)
    .map(([environment, name]) => ({ environment, name, value: clean(env?.[name], 1000) }))
    .filter(({ value }) => value);
  if (!configured.length) {
    throw new DejavooCallbackError(
      'callback_auth_not_configured',
      'Dejavoo callback authentication is not configured.',
      503,
    );
  }
  const uniqueValues = new Set(configured.map(({ value }) => value));
  if (uniqueValues.size !== configured.length) {
    throw new DejavooCallbackError(
      'callback_auth_ambiguous',
      'Dejavoo callback credentials must be unique per environment.',
      503,
    );
  }
  const matched = configured.filter(({ value }) => secretMatches(authorization, value));
  if (matched.length !== 1) {
    throw new DejavooCallbackError('callback_unauthorized', 'Invalid Dejavoo callback authorization.', 401);
  }
  const environment = matched[0].environment;
  if (
    environment === DEJAVOO_ENVIRONMENTS.PRODUCTION
    && !enabled(env?.DEJAVOO_PRODUCTION_IO_ENABLED)
  ) {
    throw new DejavooCallbackError(
      'production_io_disabled',
      'Dejavoo production callback processing is disabled.',
      503,
    );
  }
  return environment;
}

function callbackRecord(payload) {
  return payload?.iposHPResponse
    || payload?.data?.iposHPResponse
    || payload?.data
    || payload;
}

function safeCallbackPayload(record) {
  return {
    responseCode: clean(record?.responseCode, 80) || null,
    responseMessage: clean(record?.responseMessage ?? record?.status, 160) || null,
    errResponseCode: clean(record?.errResponseCode, 80) || null,
    errResponseMessage: clean(record?.errResponseMessage, 240) || null,
    transactionReferenceId: clean(record?.transactionReferenceId, 80) || null,
    transactionId: clean(record?.transactionId, 160) || null,
    amount: clean(record?.amount, 40) || null,
    totalAmount: clean(record?.totalAmount, 40) || null,
  };
}

export function parseDejavooCallback({ rawBody, contentType = '' } = {}) {
  const bodyText = String(rawBody ?? '');
  if (!String(contentType).toLowerCase().includes('application/json')) {
    throw new DejavooCallbackError('callback_content_type_invalid', 'Dejavoo callback must use JSON.', 415);
  }
  if (!bodyText || Buffer.byteLength(bodyText, 'utf8') > DEJAVOO_CALLBACK_MAX_BYTES) {
    throw new DejavooCallbackError('callback_body_invalid', 'Dejavoo callback body is empty or too large.', 413);
  }
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new DejavooCallbackError('callback_json_invalid', 'Dejavoo callback body is not valid JSON.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DejavooCallbackError('callback_shape_invalid', 'Dejavoo callback body must be a JSON object.');
  }
  const record = callbackRecord(payload);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new DejavooCallbackError('callback_shape_invalid', 'Dejavoo callback payload is missing its status record.');
  }
  const safePayload = safeCallbackPayload(record);
  if (!REFERENCE_PATTERN.test(safePayload.transactionReferenceId || '')) {
    throw new DejavooCallbackError(
      'callback_reference_invalid',
      'Dejavoo callback is missing a valid transaction reference.',
    );
  }
  const payloadSha256 = createHash('sha256').update(bodyText, 'utf8').digest('hex');
  return Object.freeze({
    merchantReference: safePayload.transactionReferenceId,
    providerTransactionId: safePayload.transactionId,
    payloadSha256,
    idempotencyKey: `dejavoo:callback:${payloadSha256}`,
    eventType: 'payment.status_callback',
    safePayload: Object.freeze(safePayload),
  });
}
