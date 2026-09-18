import { randomUUID } from 'node:crypto';

import { externalIoDisabled } from '../../runtime-safety.js';

export const DEJAVOO_SPIN_ENVIRONMENTS = Object.freeze({
  UAT: 'uat',
  PRODUCTION: 'production',
});

export const DEJAVOO_SPIN_PRODUCTION_IO_ENABLED_ENV = 'DEJAVOO_SPIN_PRODUCTION_IO_ENABLED';

export const DEJAVOO_SPIN_ERROR_CATEGORIES = Object.freeze({
  CONFIGURATION: 'configuration_error',
  VALIDATION: 'validation_error',
  PROVIDER_REJECTED: 'provider_rejected',
  TIMEOUT: 'timeout',
  NETWORK: 'network_error',
  INVALID_RESPONSE: 'invalid_response',
  UNAVAILABLE: 'provider_unavailable',
});

const DEFAULT_TIMEOUT_MS = 90_000;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const TPN_PATTERN = /^\d{10,12}$/;
const REGISTER_PATTERN = /^[A-Za-z0-9._-]{2,50}$/;
const AUTH_KEY_PATTERN = /^[A-Za-z0-9]{10}$/;

const CONTRACTS = Object.freeze({
  [DEJAVOO_SPIN_ENVIRONMENTS.UAT]: Object.freeze({
    baseUrl: 'https://test.spinpos.net',
    env: Object.freeze({
      tpn: 'DEJAVOO_UAT_SPIN_TPN',
      registerId: 'DEJAVOO_UAT_SPIN_REGISTER_ID',
      authKey: 'DEJAVOO_UAT_SPIN_AUTH_KEY',
    }),
  }),
  [DEJAVOO_SPIN_ENVIRONMENTS.PRODUCTION]: Object.freeze({
    baseUrl: 'https://spinpos.net',
    env: Object.freeze({
      tpn: 'DEJAVOO_PROD_SPIN_TPN',
      registerId: 'DEJAVOO_PROD_SPIN_REGISTER_ID',
      authKey: 'DEJAVOO_PROD_SPIN_AUTH_KEY',
    }),
  }),
});

function clean(value) {
  return String(value ?? '').trim();
}

function enabled(value) {
  return TRUE_VALUES.has(clean(value).toLowerCase());
}

function resultError({ category, code, message, correlationId, retryable = false, uncertain = false, provider = null }) {
  return {
    ok: false,
    status: uncertain ? 'unknown' : 'failed',
    correlationId,
    uncertain,
    error: { category, code, message, retryable },
    ...(provider ? { provider } : {}),
  };
}

function environmentContract(environment) {
  return CONTRACTS[clean(environment).toLowerCase()] || null;
}

export function resolveDejavooSpinConfig({ environment, env = process.env } = {}) {
  const normalizedEnvironment = clean(environment).toLowerCase();
  const contract = environmentContract(normalizedEnvironment);
  if (!contract) {
    return {
      environment: normalizedEnvironment || null,
      valid: false,
      missing: ['environment'],
      externalIoDisabled: externalIoDisabled(env),
      productionIoEnabled: false,
    };
  }
  const values = Object.fromEntries(
    Object.entries(contract.env).map(([key, variable]) => [key, clean(env?.[variable])]),
  );
  const missing = Object.entries(contract.env)
    .filter(([key]) => !values[key])
    .map(([, variable]) => variable);
  const productionIoEnabled = normalizedEnvironment !== DEJAVOO_SPIN_ENVIRONMENTS.PRODUCTION
    || enabled(env?.[DEJAVOO_SPIN_PRODUCTION_IO_ENABLED_ENV]);
  if (!productionIoEnabled) missing.push(DEJAVOO_SPIN_PRODUCTION_IO_ENABLED_ENV);
  return {
    environment: normalizedEnvironment,
    valid: missing.length === 0,
    missing,
    externalIoDisabled: externalIoDisabled(env),
    productionIoEnabled,
    ...contract,
    ...values,
  };
}

export function dejavooSpinConfigHealth({ environment, env = process.env } = {}) {
  const config = resolveDejavooSpinConfig({ environment, env });
  return {
    provider: 'dejavoo_spin',
    environment: config.environment,
    ready: Boolean(config.valid && !config.externalIoDisabled),
    externalIoDisabled: config.externalIoDisabled,
    productionIoEnabled: config.productionIoEnabled,
    missing: [...config.missing],
    endpointHost: config.baseUrl ? new URL(config.baseUrl).host : null,
  };
}

function correlationId(value) {
  const supplied = clean(value);
  if (!supplied) return `dejavoo-spin:${randomUUID()}`;
  return CORRELATION_PATTERN.test(supplied) ? supplied : null;
}

function validateCommon(input, config, operationCorrelationId) {
  if (!operationCorrelationId) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.VALIDATION,
      code: 'DEJAVOO_SPIN_CORRELATION_ID_INVALID',
      message: 'correlationId contains unsupported characters.',
      correlationId: null,
    });
  }
  if (!config.valid) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.CONFIGURATION,
      code: 'DEJAVOO_SPIN_CONFIG_MISSING',
      message: `Dejavoo SPIn ${config.environment || 'environment'} configuration is incomplete.`,
      correlationId: operationCorrelationId,
    });
  }
  if (config.externalIoDisabled) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.CONFIGURATION,
      code: 'EXTERNAL_IO_DISABLED',
      message: 'External provider I/O is disabled for this environment.',
      correlationId: operationCorrelationId,
    });
  }
  if (!TPN_PATTERN.test(config.tpn) || !REGISTER_PATTERN.test(config.registerId) || !AUTH_KEY_PATTERN.test(config.authKey)) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.CONFIGURATION,
      code: 'DEJAVOO_SPIN_CONFIG_INVALID',
      message: 'Dejavoo SPIn terminal identifiers are not valid for the selected environment.',
      correlationId: operationCorrelationId,
    });
  }
  const merchantReference = clean(input?.merchantReference);
  if (!REFERENCE_PATTERN.test(merchantReference)) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.VALIDATION,
      code: 'DEJAVOO_SPIN_REFERENCE_INVALID',
      message: 'merchantReference must be 1-50 characters using letters, numbers, underscores, or hyphens.',
      correlationId: operationCorrelationId,
    });
  }
  return { ok: true, merchantReference };
}

function moneyFromCents(amountCents) {
  return Number((amountCents / 100).toFixed(2));
}

function minorUnits(value) {
  if (value == null || value === '') return null;
  const text = clean(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fractional = ''] = text.split('.');
  const cents = (BigInt(whole) * 100n) + BigInt(fractional.padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function safeProviderSummary(body = {}, httpStatus = null) {
  const general = body?.GeneralResponse || {};
  return {
    httpStatus,
    resultCode: clean(general.ResultCode) || null,
    statusCode: clean(general.StatusCode) || null,
    hostResponseCode: clean(general.HostResponseCode) || null,
    message: clean(general.Message).slice(0, 160) || null,
    detailedMessage: clean(general.DetailedMessage).slice(0, 240) || null,
  };
}

function providerTransactionId(body = {}) {
  const direct = clean(body.PNReferenceId || body.PnReferenceId || body.RRN);
  if (direct) return direct.slice(0, 120);
  const terminalParts = [body.SerialNumber, body.BatchNumber, body.TransactionNumber]
    .map(clean)
    .filter(Boolean);
  return terminalParts.length >= 2 ? terminalParts.join(':').slice(0, 120) : null;
}

function normalizedStatus(body = {}) {
  const general = body.GeneralResponse || {};
  const combined = [
    general.Message,
    general.DetailedMessage,
    general.HostResponseMessage,
  ].map(clean).join(' ').toLowerCase();
  if (/cancel|abort/.test(combined)) return 'canceled';
  if (/declin|reject|denied/.test(combined)) return 'failed';
  if (/pending|process|busy|timeout|unknown|not found/.test(combined)) return 'unknown';
  const resultCode = clean(general.ResultCode);
  const statusCode = clean(general.StatusCode);
  const hostCode = clean(general.HostResponseCode);
  if (resultCode === '0' && statusCode === '0000' && (!hostCode || hostCode === '00')) {
    return providerTransactionId(body) ? 'succeeded' : 'unknown';
  }
  return 'failed';
}

function normalizeResponse(body, config, operationCorrelationId, httpStatus) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.GeneralResponse) {
    return resultError({
      category: DEJAVOO_SPIN_ERROR_CATEGORIES.INVALID_RESPONSE,
      code: 'DEJAVOO_SPIN_RESPONSE_INVALID',
      message: 'Dejavoo SPIn returned an invalid response.',
      correlationId: operationCorrelationId,
      uncertain: true,
    });
  }
  const status = normalizedStatus(body);
  const transactionId = providerTransactionId(body);
  return {
    ok: true,
    status,
    providerStatus: clean(body.GeneralResponse?.HostResponseMessage || body.GeneralResponse?.Message) || status,
    providerTransactionId: transactionId,
    merchantId: config.tpn,
    merchantReference: clean(body.ReferenceId),
    environment: config.environment,
    amount: {
      currency: 'USD',
      minorUnits: minorUnits(body.Amounts?.Amount),
      totalMinorUnits: minorUnits(body.Amounts?.TotalAmount),
    },
    card: {
      brand: clean(body.CardData?.CardBrand || body.CardData?.CardType).slice(0, 40) || null,
      last4: /^\d{4}$/.test(clean(body.CardData?.Last4)) ? clean(body.CardData.Last4) : null,
    },
    correlationId: operationCorrelationId,
    provider: safeProviderSummary(body, httpStatus),
  };
}

async function requestJson({ url, body, fetchImpl, timeoutMs, safeRetry }) {
  const attempts = safeRetry ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let responseBody = null;
      try { responseBody = await response.json(); } catch { responseBody = null; }
      if (safeRetry && attempt < attempts && response.status >= 500) continue;
      return { ok: true, response, body: responseBody };
    } catch (error) {
      const timedOut = controller.signal.aborted || error?.name === 'AbortError';
      if (safeRetry && attempt < attempts) continue;
      return { ok: false, timedOut };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, timedOut: false };
}

function providerRequestBody(config, merchantReference, extra = {}) {
  return {
    PaymentType: 'Credit',
    ReferenceId: merchantReference,
    PrintReceipt: 'No',
    GetReceipt: 'No',
    CaptureSignature: false,
    GetExtendedData: true,
    IsReadyForIS: false,
    Tpn: config.tpn,
    RegisterId: config.registerId,
    Authkey: config.authKey,
    SPInProxyTimeout: Math.min(120, Math.max(10, Number(extra.proxyTimeoutSeconds) || 90)),
    CustomFields: {},
    ...extra,
  };
}

function requestFailure(request, operationCorrelationId, operation) {
  const timedOut = Boolean(request.timedOut);
  return resultError({
    category: timedOut ? DEJAVOO_SPIN_ERROR_CATEGORIES.TIMEOUT : DEJAVOO_SPIN_ERROR_CATEGORIES.NETWORK,
    code: timedOut ? 'DEJAVOO_SPIN_TIMEOUT' : 'DEJAVOO_SPIN_NETWORK_ERROR',
    message: timedOut ? 'The Dejavoo terminal request timed out.' : 'The Dejavoo terminal request failed.',
    correlationId: operationCorrelationId,
    retryable: operation === 'status',
    uncertain: operation === 'sale',
  });
}

function httpFailure(request, operationCorrelationId, operation) {
  const unavailable = request.response.status >= 500;
  return resultError({
    category: unavailable ? DEJAVOO_SPIN_ERROR_CATEGORIES.UNAVAILABLE : DEJAVOO_SPIN_ERROR_CATEGORIES.PROVIDER_REJECTED,
    code: unavailable ? 'DEJAVOO_SPIN_UNAVAILABLE' : 'DEJAVOO_SPIN_REJECTED',
    message: unavailable ? 'Dejavoo SPIn is temporarily unavailable.' : 'Dejavoo SPIn rejected the request.',
    correlationId: operationCorrelationId,
    retryable: operation === 'status' && unavailable,
    uncertain: operation === 'sale' && unavailable,
    provider: safeProviderSummary(request.body || {}, request.response.status),
  });
}

export function createDejavooSpinAdapter({
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = resolveDejavooSpinConfig({ environment, env });

  async function perform(operation, input = {}) {
    const operationCorrelationId = correlationId(input.correlationId);
    const common = validateCommon(input, config, operationCorrelationId);
    if (!common.ok) return common;
    if (operation === 'sale') {
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        return resultError({
          category: DEJAVOO_SPIN_ERROR_CATEGORIES.VALIDATION,
          code: 'DEJAVOO_SPIN_AMOUNT_INVALID',
          message: 'amountCents must be a positive safe integer.',
          correlationId: operationCorrelationId,
        });
      }
      if (clean(input.currency).toUpperCase() !== 'USD') {
        return resultError({
          category: DEJAVOO_SPIN_ERROR_CATEGORIES.VALIDATION,
          code: 'DEJAVOO_SPIN_CURRENCY_UNSUPPORTED',
          message: 'Dejavoo SPIn currently supports USD collection requests only.',
          correlationId: operationCorrelationId,
        });
      }
    }
    const requestBody = providerRequestBody(config, common.merchantReference, operation === 'sale' ? {
      Amount: moneyFromCents(input.amountCents),
      TipAmount: 0,
      CustomFee: 0,
      InvoiceNumber: common.merchantReference.slice(0, 50),
      proxyTimeoutSeconds: input.proxyTimeoutSeconds,
    } : {
      TransactionNumber: input.transactionNumber || null,
      proxyTimeoutSeconds: input.proxyTimeoutSeconds,
    });
    delete requestBody.proxyTimeoutSeconds;
    const request = await requestJson({
      url: `${config.baseUrl}/v2/Payment/${operation === 'sale' ? 'Sale' : 'Status'}`,
      body: requestBody,
      fetchImpl,
      timeoutMs,
      safeRetry: operation === 'status',
    });
    if (!request.ok) return requestFailure(request, operationCorrelationId, operation);
    if (!request.response.ok) return httpFailure(request, operationCorrelationId, operation);
    return normalizeResponse(request.body, config, operationCorrelationId, request.response.status);
  }

  return Object.freeze({
    environment: config.environment,
    health: () => dejavooSpinConfigHealth({ environment, env }),
    createTerminalSale: (input) => perform('sale', input),
    queryTerminalStatus: (input) => perform('status', input),
  });
}
