import { createDejavooAdapter, resolveDejavooConfig } from './providers/dejavoo.js';
import { reconcileDejavooPayment } from './reconciliation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function recoveryError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function callbackFromEvent(event, merchantReference) {
  const safePayload = safeJson(event.safe_payload_json).callback;
  const hash = String(event.payload_sha256 || '');
  if (!HASH.test(hash)
    || event.idempotency_key !== `dejavoo:callback:${hash}`
    || safePayload?.transactionReferenceId !== merchantReference
    || String(safePayload?.responseCode) !== '200'
    || !['success', 'successful'].includes(String(safePayload?.responseMessage || '').toLowerCase())
    || !safePayload?.transactionId) {
    return null;
  }
  return {
    merchantReference,
    providerTransactionId: safePayload.transactionId,
    payloadSha256: hash,
    idempotencyKey: event.idempotency_key,
    eventType: 'payment.status_callback',
    safePayload,
  };
}

function callbackMatchesStatus(callback, status) {
  if (String(status.provider?.responseCode) !== '200') return false;
  if (status.providerTransactionId !== callback.providerTransactionId) return false;
  const amount = Number(callback.safePayload.amount);
  const total = Number(callback.safePayload.totalAmount);
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total) || amount <= 0 || total <= 0) return false;
  return status.amount?.minorUnits === amount && status.amount?.totalMinorUnits === total;
}

export async function recoverHppPayment(client, {
  paymentRequestId,
  organizationId,
  businessUnitId,
  environment,
  env = process.env,
  adapter,
  reconcile = reconcileDejavooPayment,
}) {
  if (!UUID.test(String(paymentRequestId || ''))) throw recoveryError('Valid payment request ID is required.', 400);
  const config = resolveDejavooConfig({ environment, env, capability: 'status' });
  if (!config.valid || config.externalIoDisabled) {
    throw recoveryError('Dejavoo status recheck is not enabled.', 503);
  }
  const requestResult = await client.query(
    `select id, status, merchant_reference from payment_requests
      where id = $1 and organization_id = $2 and business_unit_id = $3
        and provider = 'dejavoo' and provider_environment = $4`,
    [paymentRequestId, organizationId, businessUnitId, environment],
  );
  const paymentRequest = requestResult.rows[0];
  if (!paymentRequest) throw recoveryError('Payment request not found.', 404);
  if (paymentRequest.status === 'completed') return { outcome: 'already_completed', paymentRequestId };
  if (paymentRequest.status !== 'pending') {
    throw recoveryError('Only pending Dejavoo requests can be rechecked.', 409);
  }

  const events = await client.query(
    `select payload_sha256, idempotency_key, safe_payload_json
       from payment_provider_events
      where payment_request_id = $1 and organization_id = $2 and business_unit_id = $3
        and provider = 'dejavoo' and provider_environment = $4
        and event_type = 'payment.status_callback'
      order by occurred_at desc limit 5`,
    [paymentRequestId, organizationId, businessUnitId, environment],
  );
  const callback = events.rows.map((event) => callbackFromEvent(event, paymentRequest.merchant_reference)).find(Boolean);
  if (!callback) return { outcome: 'review_required', reason: 'successful_callback_missing', paymentRequestId };

  const statusAdapter = adapter || createDejavooAdapter({ environment, env, capability: 'status' });
  const statusResult = await statusAdapter.queryPaymentStatus({
    correlationId: `dejavoo:recheck:${paymentRequestId}`,
    merchantId: config.cloudPosTpn,
    merchantReference: paymentRequest.merchant_reference,
  });
  if (statusResult.ok && statusResult.status === 'succeeded' && !callbackMatchesStatus(callback, statusResult)) {
    return { outcome: 'review_required', reason: 'callback_status_mismatch', paymentRequestId };
  }
  if (statusResult.ok && !['succeeded', 'pending', 'unknown'].includes(statusResult.status)) {
    return { outcome: 'review_required', reason: 'callback_status_conflict', paymentRequestId };
  }
  const result = await reconcile(client, {
    merchantReference: paymentRequest.merchant_reference,
    environment,
    expectedMerchantId: config.cloudPosTpn,
    callback,
    statusResult,
  });
  return { ...result, providerStatus: statusResult.ok ? statusResult.providerStatus : null };
}
