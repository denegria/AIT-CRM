import { randomUUID } from 'node:crypto';

import { externalIoDisabled } from '../../runtime-safety.js';

export const DEJAVOO_ENVIRONMENTS = Object.freeze({
  UAT: 'uat',
  PRODUCTION: 'production',
});

export const DEJAVOO_ERROR_CATEGORIES = Object.freeze({
  CONFIGURATION: 'configuration_error',
  VALIDATION: 'validation_error',
  AUTHENTICATION: 'authentication_error',
  PROVIDER_REJECTED: 'provider_rejected',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  NETWORK: 'network_error',
  INVALID_RESPONSE: 'invalid_response',
  UNAVAILABLE: 'provider_unavailable',
});

export const DEJAVOO_PRODUCTION_IO_ENABLED_ENV = 'DEJAVOO_PRODUCTION_IO_ENABLED';

const TOKEN_EXPIRY_MINUTES = 30;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRYABLE_HTTP_STATUSES = new Set([500, 502, 503, 504]);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;

const CONTRACTS = Object.freeze({
  [DEJAVOO_ENVIRONMENTS.UAT]: Object.freeze({
    authUrl: 'https://auth.ipospays.tech/v1/authenticate-token',
    hppUrl: 'https://payment.ipospays.tech/api/v3/external-payment-transaction',
    statusUrl: 'https://api.ipospays.tech/v1/queryPaymentStatus',
    checkoutOrigins: Object.freeze([
      'https://pay.ipospays.tech',
      'https://payment.ipospays.tech',
    ]),
    env: Object.freeze({
      apiKey: 'DEJAVOO_UAT_API_KEY',
      secretKey: 'DEJAVOO_UAT_SECRET_KEY',
      cloudPosTpn: 'DEJAVOO_UAT_CLOUDPOS_TPN',
      ecomToken: 'DEJAVOO_UAT_ECOM_TOKEN',
    }),
  }),
  [DEJAVOO_ENVIRONMENTS.PRODUCTION]: Object.freeze({
    authUrl: 'https://auth.ipospays.com/v1/authenticate-token',
    hppUrl: 'https://payment.ipospays.com/api/v3/external-payment-transaction',
    statusUrl: 'https://api.ipospays.com/v1/queryPaymentStatus',
    checkoutOrigins: Object.freeze([
      'https://pay.ipospays.com',
      'https://payment.ipospays.com',
    ]),
    env: Object.freeze({
      apiKey: 'DEJAVOO_PROD_API_KEY',
      secretKey: 'DEJAVOO_PROD_SECRET_KEY',
      cloudPosTpn: 'DEJAVOO_PROD_CLOUDPOS_TPN',
      ecomToken: 'DEJAVOO_PROD_ECOM_TOKEN',
    }),
  }),
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function enabled(value) {
  return TRUE_VALUES.has(cleanText(value).toLowerCase());
}

function boundedText(value, maxLength) {
  const text = cleanText(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function safeProviderText(value, secrets = []) {
  let text = boundedText(value, 500)
    .replace(/https?:\/\/\S+/gi, '[url-redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '[token-redacted]');
  for (const secret of secrets.map(cleanText).filter(Boolean)) {
    text = text.split(secret).join('[secret-redacted]');
  }
  return text;
}

function providerSummary(body = {}, httpStatus = null, secrets = []) {
  const errors = Array.isArray(body?.errors)
    ? body.errors.slice(0, 10).map((error) => ({
      code: cleanNullableText(error?.code),
      field: cleanNullableText(error?.field || error?.param),
      message: cleanNullableText(safeProviderText(error?.message, secrets)),
    }))
    : [];
  return {
    httpStatus,
    responseCode: cleanNullableText(
      body?.responseCode
      ?? body?.errorCode
      ?? body?.statusCode,
    ),
    responseMessage: cleanNullableText(safeProviderText(
      body?.responseMessage
      ?? body?.errorMessage
      ?? body?.message,
      secrets,
    )),
    errors,
  };
}

function resultError({
  category,
  code,
  message,
  correlationId,
  retryable = false,
  httpStatus = null,
  provider = null,
}) {
  return {
    ok: false,
    correlationId,
    error: {
      category,
      code,
      message,
      retryable,
      httpStatus,
    },
    ...(provider ? { provider } : {}),
  };
}

function environmentContract(environment) {
  return CONTRACTS[cleanText(environment).toLowerCase()] || null;
}

export function resolveDejavooConfig({ environment, env = process.env } = {}) {
  const normalizedEnvironment = cleanText(environment).toLowerCase();
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
    Object.entries(contract.env).map(([key, name]) => [key, cleanText(env?.[name])]),
  );
  const missing = Object.entries(contract.env)
    .filter(([key]) => !values[key])
    .map(([, name]) => name);
  const productionIoEnabled = normalizedEnvironment !== DEJAVOO_ENVIRONMENTS.PRODUCTION
    || enabled(env?.[DEJAVOO_PRODUCTION_IO_ENABLED_ENV]);
  if (!productionIoEnabled) missing.push(DEJAVOO_PRODUCTION_IO_ENABLED_ENV);

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

export function dejavooConfigHealth({ environment, env = process.env } = {}) {
  const config = resolveDejavooConfig({ environment, env });
  return {
    provider: 'dejavoo',
    environment: config.environment,
    ready: Boolean(config.valid && !config.externalIoDisabled),
    externalIoDisabled: config.externalIoDisabled,
    productionIoEnabled: config.productionIoEnabled,
    missing: [...config.missing],
    endpoints: config.authUrl ? {
      authHost: new URL(config.authUrl).host,
      hppHost: new URL(config.hppUrl).host,
      statusHost: new URL(config.statusUrl).host,
    } : null,
  };
}

function correlationId(value) {
  const supplied = cleanText(value);
  if (!supplied) return `dejavoo:${randomUUID()}`;
  return CORRELATION_PATTERN.test(supplied) ? supplied : null;
}

function validateHttpsUrl(value, fieldName, { required = true } = {}) {
  const text = cleanText(value);
  if (!text && !required) return { ok: true, value: '' };
  if (!text) return { ok: false, message: `${fieldName} is required.` };
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || text.length > 2048) {
      return { ok: false, message: `${fieldName} must be a safe HTTPS URL.` };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, message: `${fieldName} must be a valid HTTPS URL.` };
  }
}

function validateCommonInput(input, config, operationCorrelationId) {
  if (!operationCorrelationId) {
    return resultError({
      category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
      code: 'DEJAVOO_CORRELATION_ID_INVALID',
      message: 'correlationId contains unsupported characters.',
      correlationId: null,
    });
  }
  if (!config.valid) {
    return resultError({
      category: DEJAVOO_ERROR_CATEGORIES.CONFIGURATION,
      code: 'DEJAVOO_CONFIG_MISSING',
      message: `Dejavoo ${config.environment || 'environment'} configuration is incomplete.`,
      correlationId: operationCorrelationId,
    });
  }
  if (config.externalIoDisabled) {
    return resultError({
      category: DEJAVOO_ERROR_CATEGORIES.CONFIGURATION,
      code: 'EXTERNAL_IO_DISABLED',
      message: 'External provider I/O is disabled for this environment.',
      correlationId: operationCorrelationId,
    });
  }
  const merchantId = cleanText(input?.merchantId);
  if (!merchantId || merchantId !== config.cloudPosTpn) {
    return resultError({
      category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
      code: 'DEJAVOO_MERCHANT_MISMATCH',
      message: 'merchantId does not match the configured Dejavoo environment.',
      correlationId: operationCorrelationId,
    });
  }
  const merchantReference = cleanText(input?.merchantReference);
  if (!REFERENCE_PATTERN.test(merchantReference)) {
    return resultError({
      category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
      code: 'DEJAVOO_REFERENCE_INVALID',
      message: 'merchantReference must be 6-80 characters using letters, numbers, underscores, or hyphens.',
      correlationId: operationCorrelationId,
    });
  }
  return { ok: true, merchantId, merchantReference };
}

function parseJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(Number(payload?.exp)) ? Number(payload.exp) * 1000 : null;
  } catch {
    return null;
  }
}

function classifyHttpError(status) {
  if (status === 401 || status === 403) {
    return {
      category: DEJAVOO_ERROR_CATEGORIES.AUTHENTICATION,
      code: 'DEJAVOO_AUTHENTICATION_FAILED',
      message: 'Dejavoo rejected the configured credentials or access token.',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      category: DEJAVOO_ERROR_CATEGORIES.RATE_LIMITED,
      code: 'DEJAVOO_RATE_LIMITED',
      message: 'Dejavoo rate-limited the request.',
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      category: DEJAVOO_ERROR_CATEGORIES.UNAVAILABLE,
      code: 'DEJAVOO_PROVIDER_UNAVAILABLE',
      message: 'Dejavoo is temporarily unavailable.',
      retryable: true,
    };
  }
  return {
    category: DEJAVOO_ERROR_CATEGORIES.PROVIDER_REJECTED,
    code: 'DEJAVOO_PROVIDER_REJECTED',
    message: 'Dejavoo rejected the request.',
    retryable: false,
  };
}

async function requestJson({ url, options, fetchImpl, timeoutMs, safeRetry }) {
  const attempts = safeRetry ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      let body;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (safeRetry && attempt < attempts && RETRYABLE_HTTP_STATUSES.has(response.status)) continue;
      return { ok: true, response, body };
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

function requestFailure(request, operationCorrelationId) {
  return resultError({
    category: request.timedOut
      ? DEJAVOO_ERROR_CATEGORIES.TIMEOUT
      : DEJAVOO_ERROR_CATEGORIES.NETWORK,
    code: request.timedOut ? 'DEJAVOO_TIMEOUT' : 'DEJAVOO_NETWORK_ERROR',
    message: request.timedOut
      ? 'The Dejavoo request timed out.'
      : 'The Dejavoo network request failed.',
    correlationId: operationCorrelationId,
    retryable: true,
  });
}

function responseFailure(response, body, config, operationCorrelationId, extraSecrets = []) {
  const classification = classifyHttpError(response.status);
  const provider = providerSummary(body || {}, response.status, [
    config.apiKey,
    config.secretKey,
    config.cloudPosTpn,
    config.ecomToken,
    ...extraSecrets,
  ]);
  return resultError({
    ...classification,
    correlationId: operationCorrelationId,
    httpStatus: response.status,
    provider,
  });
}

function normalizeStatus(value) {
  const status = cleanText(value).toLowerCase();
  if (!status) return 'unknown';
  if (status.includes('pending')) return 'pending';
  if (status.includes('successful') || status === 'success' || status === 'approved' || status === 'completed') {
    return 'succeeded';
  }
  if (status.includes('cancel')) return 'canceled';
  if (status.includes('expire')) return 'expired';
  if (status.includes('declin') || status.includes('reject') || status.includes('fail')) return 'failed';
  return 'unknown';
}

function minorUnits(value) {
  if (value == null || value === '') return null;
  const text = cleanText(value);
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

function checkoutUrlFromBody(body, config) {
  const value = [body?.information, body?.url, body?.paymentUrl, body?.hppUrl]
    .find((candidate) => typeof candidate === 'string' && candidate.startsWith('https://'));
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!config.checkoutOrigins.includes(url.origin) || !url.searchParams.get('t')) return null;
    return url;
  } catch {
    return null;
  }
}

export function createDejavooAdapter({
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = resolveDejavooConfig({ environment, env });
  let tokenCache = null;

  async function accessToken(operationCorrelationId) {
    if (tokenCache && tokenCache.expiresAt > now()) {
      return { ok: true, token: tokenCache.token, cached: true };
    }
    const request = await requestJson({
      url: config.authUrl,
      options: {
        method: 'POST',
        headers: {
          apiKey: config.apiKey,
          secretKey: config.secretKey,
          TokenExpiryMinutes: String(TOKEN_EXPIRY_MINUTES),
        },
      },
      fetchImpl,
      timeoutMs,
      safeRetry: true,
    });
    if (!request.ok) return requestFailure(request, operationCorrelationId);
    if (!request.response.ok) {
      return responseFailure(request.response, request.body, config, operationCorrelationId);
    }
    const token = cleanText(request.body?.token);
    if (!token) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.INVALID_RESPONSE,
        code: 'DEJAVOO_AUTH_TOKEN_MISSING',
        message: 'Dejavoo authentication succeeded without an access token.',
        correlationId: operationCorrelationId,
        httpStatus: request.response.status,
      });
    }
    const providerExpiry = parseJwtExpiry(token);
    const fallbackExpiry = now() + (TOKEN_EXPIRY_MINUTES * 60_000);
    tokenCache = {
      token,
      expiresAt: Math.max(now(), Math.min(providerExpiry || fallbackExpiry, fallbackExpiry) - TOKEN_REFRESH_SKEW_MS),
    };
    return { ok: true, token, cached: false };
  }

  async function createHostedPaymentPage(input = {}) {
    const operationCorrelationId = correlationId(input.correlationId);
    const common = validateCommonInput(input, config, operationCorrelationId);
    if (!common.ok) return common;
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_AMOUNT_INVALID',
        message: 'amountCents must be a positive safe integer.',
        correlationId: operationCorrelationId,
      });
    }
    if (cleanText(input.currency).toUpperCase() !== 'USD') {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_CURRENCY_UNSUPPORTED',
        message: 'Dejavoo HPP currently supports USD payment requests only.',
        correlationId: operationCorrelationId,
      });
    }
    const returnUrl = validateHttpsUrl(input.returnUrl, 'returnUrl');
    const failureUrl = validateHttpsUrl(input.failureUrl, 'failureUrl');
    const cancelUrl = validateHttpsUrl(input.cancelUrl, 'cancelUrl', { required: false });
    const postUrl = validateHttpsUrl(input.postUrl, 'postUrl', { required: false });
    const invalidUrl = [returnUrl, failureUrl, cancelUrl, postUrl].find((item) => !item.ok);
    if (invalidUrl) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_CALLBACK_URL_INVALID',
        message: invalidUrl.message,
        correlationId: operationCorrelationId,
      });
    }
    const postAuthHeader = cleanText(input.postAuthHeader);
    if ((postUrl.value && !postAuthHeader) || (!postUrl.value && postAuthHeader) || postAuthHeader.length > 500 || /[\r\n]/.test(postAuthHeader)) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_POST_AUTH_INVALID',
        message: 'postUrl and a safe postAuthHeader must be supplied together.',
        correlationId: operationCorrelationId,
      });
    }
    const expiryDays = input.expiryDays == null ? 1 : Number(input.expiryDays);
    if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 30) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_EXPIRY_INVALID',
        message: 'expiryDays must be an integer between 1 and 30.',
        correlationId: operationCorrelationId,
      });
    }

    const auth = await accessToken(operationCorrelationId);
    if (!auth.ok) return auth;
    const customer = input.customer || {};
    const personalization = input.personalization || {};
    const payload = {
      personalization: {
        merchantName: boundedText(personalization.merchantName, 100),
        logoUrl: boundedText(personalization.logoUrl, 500),
        themeColor: boundedText(personalization.themeColor, 32),
        description: boundedText(personalization.description, 300),
        payNowButtonText: boundedText(personalization.payNowButtonText, 60),
        buttonColor: boundedText(personalization.buttonColor, 32),
        cancelButtonText: boundedText(personalization.cancelButtonText, 60),
        disclaimer: boundedText(personalization.disclaimer, 500),
      },
      merchantAuthentication: {
        merchantId: common.merchantId,
        transactionReferenceId: common.merchantReference,
      },
      transactionRequest: {
        transactionType: 1,
        amount: String(input.amountCents),
        calculateFee: false,
        tipsInputPrompt: false,
        calculateTax: false,
        expiry: expiryDays,
      },
      notificationOption: {
        notifyByRedirect: true,
        returnUrl: returnUrl.value,
        failureUrl: failureUrl.value,
        cancelUrl: cancelUrl.value,
        notifyBySMS: false,
        mobileNumber: '',
        notifyByPOST: Boolean(postUrl.value),
        postAPI: postUrl.value,
        authHeader: postAuthHeader,
      },
      preferences: {
        integrationType: 1,
        avsVerification: false,
        eReceipt: false,
        eReceiptInputPrompt: false,
        customerName: boundedText(customer.name, 150),
        customerEmail: boundedText(customer.email, 254),
        customerMobile: boundedText(customer.mobile, 32),
        requestCardToken: false,
        shortenURL: false,
        sendPaymentLink: false,
        integrationVersion: 'v2',
        level3CEDP: false,
      },
    };
    const request = await requestJson({
      url: config.hppUrl,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token: auth.token,
        },
        body: JSON.stringify(payload),
      },
      fetchImpl,
      timeoutMs,
      safeRetry: false,
    });
    if (!request.ok) return requestFailure(request, operationCorrelationId);
    if (!request.response.ok) {
      return responseFailure(
        request.response,
        request.body,
        config,
        operationCorrelationId,
        [postAuthHeader, auth.token],
      );
    }
    const checkoutUrl = checkoutUrlFromBody(request.body, config);
    if (!checkoutUrl) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.INVALID_RESPONSE,
        code: 'DEJAVOO_HPP_URL_INVALID',
        message: 'Dejavoo did not return an approved hosted checkout URL.',
        correlationId: operationCorrelationId,
        httpStatus: request.response.status,
      });
    }
    return {
      ok: true,
      correlationId: operationCorrelationId,
      environment: config.environment,
      merchantReference: common.merchantReference,
      amount: { currency: 'USD', minorUnits: input.amountCents },
      checkoutUrl: checkoutUrl.toString(),
      checkout: { origin: checkoutUrl.origin, path: checkoutUrl.pathname },
      provider: providerSummary(
        request.body || {},
        request.response.status,
        [postAuthHeader, auth.token],
      ),
    };
  }

  async function queryPaymentStatus(input = {}) {
    const operationCorrelationId = correlationId(input.correlationId);
    const common = validateCommonInput(input, config, operationCorrelationId);
    if (!common.ok) return common;
    const url = new URL(config.statusUrl);
    url.searchParams.set('tpn', common.merchantId);
    url.searchParams.set('transactionReferenceId', common.merchantReference);
    const request = await requestJson({
      url,
      options: {
        method: 'GET',
        headers: { Authorization: config.ecomToken },
      },
      fetchImpl,
      timeoutMs,
      safeRetry: true,
    });
    if (!request.ok) return requestFailure(request, operationCorrelationId);
    if (!request.response.ok) {
      return responseFailure(request.response, request.body, config, operationCorrelationId);
    }
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.INVALID_RESPONSE,
        code: 'DEJAVOO_STATUS_RESPONSE_INVALID',
        message: 'Dejavoo returned an invalid status response.',
        correlationId: operationCorrelationId,
        httpStatus: request.response.status,
      });
    }
    const statusRecord = request.body.iposHPResponse
      || request.body.data?.iposHPResponse
      || request.body.data
      || {};
    const returnedReference = cleanText(
      statusRecord.transactionReferenceId ?? request.body.transactionReferenceId,
    );
    if (returnedReference && returnedReference !== common.merchantReference) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.INVALID_RESPONSE,
        code: 'DEJAVOO_REFERENCE_MISMATCH',
        message: 'Dejavoo returned a different merchant transaction reference.',
        correlationId: operationCorrelationId,
        httpStatus: request.response.status,
      });
    }
    const providerStatus = cleanText(
      request.body.status
      ?? statusRecord.status
      ?? statusRecord.responseMessage
      ?? request.body.responseMessage,
    );
    return {
      ok: true,
      correlationId: operationCorrelationId,
      environment: config.environment,
      merchantId: common.merchantId,
      merchantReference: common.merchantReference,
      status: normalizeStatus(providerStatus),
      providerStatus: providerStatus || null,
      providerTransactionId: cleanNullableText(statusRecord.transactionId),
      amount: {
        currency: 'USD',
        minorUnits: minorUnits(statusRecord.amount),
        totalMinorUnits: minorUnits(statusRecord.totalAmount),
      },
      provider: {
        ...providerSummary(statusRecord, request.response.status, [config.ecomToken]),
        errResponseCode: cleanNullableText(statusRecord.errResponseCode),
        errResponseMessage: cleanNullableText(safeProviderText(statusRecord.errResponseMessage)),
      },
    };
  }

  async function checkHealth({ correlationId: suppliedCorrelationId, authenticate = false } = {}) {
    const health = dejavooConfigHealth({ environment, env });
    if (!authenticate || !health.ready) return health;
    const operationCorrelationId = correlationId(suppliedCorrelationId);
    if (!operationCorrelationId) {
      return resultError({
        category: DEJAVOO_ERROR_CATEGORIES.VALIDATION,
        code: 'DEJAVOO_CORRELATION_ID_INVALID',
        message: 'correlationId contains unsupported characters.',
        correlationId: null,
      });
    }
    const auth = await accessToken(operationCorrelationId);
    if (!auth.ok) return auth;
    return {
      ...health,
      correlationId: operationCorrelationId,
      authenticated: true,
      tokenCached: auth.cached,
    };
  }

  return Object.freeze({
    createHostedPaymentPage,
    queryPaymentStatus,
    checkHealth,
  });
}
