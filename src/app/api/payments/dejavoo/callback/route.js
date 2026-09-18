import { NextResponse } from 'next/server';

import { getPool } from '@/db/index.js';
import {
  DEJAVOO_CALLBACK_MAX_BYTES,
  DejavooCallbackError,
  parseDejavooCallback,
  resolveDejavooCallbackEnvironment,
} from '@/lib/payments/dejavoo-callback.js';
import { createDejavooAdapter, resolveDejavooConfig } from '@/lib/payments/providers/dejavoo.js';
import {
  PaymentReconciliationError,
  loadDejavooPaymentRequest,
  reconcileDejavooPayment,
} from '@/lib/payments/reconciliation.js';
import { externalIoDisabled, externalIoDisabledResponse } from '@/lib/runtime-safety.js';

export const runtime = 'nodejs';

function responseError(code, message, status) {
  return NextResponse.json({ accepted: false, error: code, message }, { status });
}

export async function POST(request) {
  if (externalIoDisabled(process.env)) {
    return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
  }
  if (!process.env.DATABASE_URL) {
    return responseError('database_not_configured', 'Payment reconciliation is not configured.', 503);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > DEJAVOO_CALLBACK_MAX_BYTES) {
    return responseError('callback_body_invalid', 'Dejavoo callback body is too large.', 413);
  }

  try {
    const environment = resolveDejavooCallbackEnvironment({
      authorization: request.headers.get('authorization'),
      env: process.env,
    });
    const rawBody = await request.text();
    const callback = parseDejavooCallback({
      rawBody,
      contentType: request.headers.get('content-type'),
    });
    const config = resolveDejavooConfig({ environment, env: process.env });
    if (!config.valid || config.externalIoDisabled) {
      return responseError('provider_not_configured', 'Payment verification is not configured.', 503);
    }
    const client = await getPool().connect();
    try {
      const paymentRequest = await loadDejavooPaymentRequest(client, {
        merchantReference: callback.merchantReference,
        environment,
      });
      if (!paymentRequest) {
        return responseError('payment_request_not_found', 'Expected payment request was not found.', 404);
      }
      const correlationId = `dejavoo:callback:${callback.payloadSha256.slice(0, 24)}`;
      const adapter = createDejavooAdapter({ environment, env: process.env });
      const statusResult = await adapter.queryPaymentStatus({
        correlationId,
        merchantId: config.cloudPosTpn,
        merchantReference: callback.merchantReference,
      });
      const result = await reconcileDejavooPayment(client, {
        merchantReference: callback.merchantReference,
        environment,
        expectedMerchantId: config.cloudPosTpn,
        callback,
        statusResult,
      });
      const pending = ['pending', 'verification_unavailable'].includes(result.outcome);
      return NextResponse.json({
        accepted: true,
        outcome: result.outcome,
        duplicate: result.duplicate,
        retryable: Boolean(result.retryable),
        requiresReview: result.outcome === 'review_required',
        correlationId,
      }, { status: pending ? 202 : 200 });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof DejavooCallbackError || error instanceof PaymentReconciliationError) {
      return responseError(error.code, error.message, error.status);
    }
    return responseError('payment_reconciliation_failed', 'Payment reconciliation failed.', 500);
  }
}
