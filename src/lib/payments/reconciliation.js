import { createHash } from 'node:crypto';

import { allocateVerifiedPaymentInTransaction, recordProviderEvent } from '../billing-ledger/service.js';
import { centsToMoney, moneyToCents } from '../billing-ledger/model.js';
import { activateBookFulfillmentForVerifiedPayment } from '../fulfillment/service.js';

const PROVIDER = 'dejavoo';
const TERMINAL_EVENT_STATUSES = new Set(['processed', 'ignored']);

export class PaymentReconciliationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PaymentReconciliationError';
    this.code = code;
    this.status = status;
  }
}

function value(row, snake, camel = snake) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function json(valueToParse) {
  if (!valueToParse) return {};
  if (typeof valueToParse === 'object') return valueToParse;
  try {
    return JSON.parse(valueToParse);
  } catch {
    return {};
  }
}

function required(valueToCheck, name) {
  const text = String(valueToCheck || '').trim();
  if (!text) throw new PaymentReconciliationError('invalid_input', `${name} is required.`);
  return text;
}

function statusSummary(statusResult) {
  if (!statusResult?.ok) {
    return {
      ok: false,
      status: 'unavailable',
      providerStatus: null,
      providerTransactionId: null,
      retryable: Boolean(statusResult?.error?.retryable),
      errorCode: statusResult?.error?.code || 'DEJAVOO_STATUS_UNAVAILABLE',
      correlationId: statusResult?.correlationId || null,
    };
  }
  return {
    ok: true,
    status: statusResult.status || 'unknown',
    providerStatus: statusResult.providerStatus || null,
    providerTransactionId: statusResult.providerTransactionId || null,
    retryable: ['pending', 'unknown'].includes(statusResult.status),
    errorCode: null,
    correlationId: statusResult.correlationId || null,
  };
}

function safeEventPayload(callback, statusResult, outcome = {}) {
  return {
    callback: callback.safePayload,
    verification: {
      ...statusSummary(statusResult),
      amount: statusResult?.ok ? statusResult.amount : null,
      environment: statusResult?.environment || null,
      merchantReference: statusResult?.merchantReference || null,
    },
    outcome,
  };
}

export async function loadDejavooPaymentRequest(client, { merchantReference, environment }) {
  const result = await client.query(
    `select * from payment_requests
      where merchant_reference = $1 and provider = $2 and provider_environment = $3
      limit 2`,
    [required(merchantReference, 'merchantReference'), PROVIDER, required(environment, 'environment')],
  );
  if (result.rows.length > 1) {
    throw new PaymentReconciliationError(
      'payment_request_ambiguous',
      'Payment reference resolves to more than one request.',
      409,
    );
  }
  return result.rows[0] || null;
}

async function updateEvent(client, eventId, {
  processingStatus,
  errorCode = null,
  transactionId = null,
  safePayload,
  processed = false,
}) {
  await client.query(
    `update payment_provider_events
        set processing_status = $1,
            error_code = $2,
            transaction_id = coalesce($3, transaction_id),
            safe_payload_json = $4::jsonb,
            processed_at = case when $5 then now() else null end,
            updated_at = now()
      where id = $6`,
    [processingStatus, errorCode, transactionId, JSON.stringify(safePayload), processed, eventId],
  );
}

async function recordOperatorAttention(client, request, event, code, statusResult) {
  const organizationId = value(request, 'organization_id', 'organizationId');
  const businessUnitId = value(request, 'business_unit_id', 'businessUnitId');
  const studentContactId = value(request, 'student_contact_id', 'studentContactId');
  await client.query(
    `insert into activity_events
      (organization_id, business_unit_id, contact_id, event_type, message, metadata_json, occurred_at)
     select $1, $2, $3, 'financial.payment_reconciliation_attention', $4, $5::jsonb, now()
      where not exists (
        select 1 from activity_events
         where organization_id = $1
           and metadata_json->>'paymentProviderEventId' = $6
           and event_type = 'financial.payment_reconciliation_attention'
      )`,
    [
      organizationId,
      businessUnitId,
      studentContactId,
      `Payment verification needs review (${code}).`,
      JSON.stringify({
        paymentProviderEventId: event.id,
        paymentRequestId: request.id,
        provider: PROVIDER,
        providerEnvironment: value(request, 'provider_environment', 'providerEnvironment'),
        reconciliationCode: code,
        providerStatus: statusResult?.providerStatus || null,
        correlationId: statusResult?.correlationId || null,
      }),
      event.id,
    ],
  );
}

function succeededValidation(request, statusResult, expectedMerchantId) {
  if (statusResult.environment !== value(request, 'provider_environment', 'providerEnvironment')) {
    return { code: 'provider_environment_mismatch', message: 'Provider environment does not match the payment request.' };
  }
  if (statusResult.merchantId !== expectedMerchantId) {
    return { code: 'merchant_mismatch', message: 'Provider merchant does not match the configured payment environment.' };
  }
  if (statusResult.merchantReference !== value(request, 'merchant_reference', 'merchantReference')) {
    return { code: 'reference_mismatch', message: 'Provider reference does not match the payment request.' };
  }
  if (String(statusResult.amount?.currency || '').toUpperCase() !== String(value(request, 'currency')).toUpperCase()) {
    return { code: 'currency_mismatch', message: 'Provider currency does not match the payment request.' };
  }
  const requestedCents = moneyToCents(value(request, 'requested_amount', 'requestedAmount'), 'requested amount');
  const baseCents = statusResult.amount?.minorUnits;
  const totalCents = statusResult.amount?.totalMinorUnits;
  if (!Number.isSafeInteger(baseCents) && !Number.isSafeInteger(totalCents)) {
    return { code: 'amount_missing', message: 'Provider status did not contain a verifiable amount.' };
  }
  if (Number.isSafeInteger(baseCents) && BigInt(baseCents) !== requestedCents) {
    return { code: 'amount_mismatch', message: 'Provider amount does not match the payment request.' };
  }
  if (Number.isSafeInteger(totalCents) && BigInt(totalCents) !== requestedCents) {
    return { code: 'total_amount_mismatch', message: 'Provider total does not match the payment request.' };
  }
  if (!statusResult.providerTransactionId) {
    return { code: 'provider_transaction_missing', message: 'Provider status did not contain a transaction id.' };
  }
  return { code: null, requestedCents };
}

function allocationPlan(request) {
  const metadata = json(value(request, 'metadata_json', 'metadataJson'));
  const registration = metadata.registrationResult || {};
  const plan = Array.isArray(metadata.paymentIntent?.allocationPlan)
    ? metadata.paymentIntent.allocationPlan
    : Array.isArray(registration.allocationPlan)
      ? registration.allocationPlan
      : null;
  if (!plan) {
    const chargeId = value(request, 'charge_id', 'chargeId');
    if (!chargeId) {
      throw new PaymentReconciliationError(
        'allocation_plan_missing',
        'Payment request does not contain a safe allocation plan.',
        409,
      );
    }
    return [{ treatment: 'charge', chargeId, amount: value(request, 'requested_amount', 'requestedAmount') }];
  }
  let totalCents = 0n;
  const seenCharges = new Set();
  for (const entry of plan) {
    if (!['charge', 'unapplied_credit'].includes(entry?.treatment)) {
      throw new PaymentReconciliationError('allocation_plan_invalid', 'Payment allocation plan has an unsupported treatment.', 409);
    }
    const cents = moneyToCents(entry.amount, 'allocation plan amount');
    totalCents += cents;
    if (entry.treatment === 'charge') {
      const chargeId = required(entry.chargeId, 'allocation chargeId');
      if (seenCharges.has(chargeId)) {
        throw new PaymentReconciliationError('allocation_plan_invalid', 'Payment allocation plan repeats a charge.', 409);
      }
      seenCharges.add(chargeId);
    } else if (entry.chargeId) {
      throw new PaymentReconciliationError('allocation_plan_invalid', 'Unapplied credit cannot name a charge.', 409);
    }
  }
  const requestedCents = moneyToCents(value(request, 'requested_amount', 'requestedAmount'), 'requested amount');
  if (totalCents !== requestedCents) {
    throw new PaymentReconciliationError('allocation_plan_mismatch', 'Payment allocation plan does not equal the requested amount.', 409);
  }
  return plan;
}

function transactionInvariant(existing, request, statusResult) {
  const expected = {
    businessUnitId: value(request, 'business_unit_id', 'businessUnitId'),
    paymentRequestId: request.id,
    merchantReference: value(request, 'merchant_reference', 'merchantReference'),
    amount: value(request, 'requested_amount', 'requestedAmount'),
    currency: value(request, 'currency'),
  };
  const mismatched = (
    value(existing, 'business_unit_id', 'businessUnitId') !== expected.businessUnitId
    || value(existing, 'payment_request_id', 'paymentRequestId') !== expected.paymentRequestId
    || value(existing, 'merchant_reference', 'merchantReference') !== expected.merchantReference
    || moneyToCents(value(existing, 'amount'), 'transaction amount') !== moneyToCents(expected.amount, 'requested amount')
    || String(value(existing, 'currency')).toUpperCase() !== String(expected.currency).toUpperCase()
  );
  if (mismatched || value(existing, 'status') === 'voided') {
    throw new PaymentReconciliationError(
      'provider_transaction_conflict',
      'Provider transaction conflicts with the expected payment request.',
      409,
    );
  }
  if (value(existing, 'provider_transaction_id', 'providerTransactionId') !== statusResult.providerTransactionId) {
    throw new PaymentReconciliationError('provider_transaction_conflict', 'Provider transaction id conflict.', 409);
  }
}

async function ensureVerifiedTransaction(client, request, statusResult, now, providerSurface = 'hpp') {
  const organizationId = value(request, 'organization_id', 'organizationId');
  const businessUnitId = value(request, 'business_unit_id', 'businessUnitId');
  const environment = value(request, 'provider_environment', 'providerEnvironment');
  const existingResult = await client.query(
    `select * from provider_transactions
      where organization_id = $1 and provider = $2 and provider_environment = $3 and provider_transaction_id = $4
      for update`,
    [organizationId, PROVIDER, environment, statusResult.providerTransactionId],
  );
  let transaction = existingResult.rows[0] || null;
  if (transaction) {
    transactionInvariant(transaction, request, statusResult);
    if (value(transaction, 'status') !== 'verified') {
      const updated = await client.query(
        `update provider_transactions
            set status = 'verified', verified_at = $1, occurred_at = coalesce(occurred_at, $1), updated_at = now()
          where id = $2 returning *`,
        [now, transaction.id],
      );
      transaction = updated.rows[0];
    }
    return transaction;
  }
  const inserted = await client.query(
    `insert into provider_transactions
      (organization_id, business_unit_id, payment_request_id, student_contact_id, payer_contact_id,
       enrollment_id, class_section_id, provider, provider_environment, provider_transaction_id,
       merchant_reference, transaction_kind, status, amount, currency, occurred_at, verified_at,
       source_type, source_reference, idempotency_key, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'payment', 'verified', $12, $13,
             $14, $14, 'dejavoo_status_verification', $15, $16, $17::jsonb)
     returning *`,
    [
      organizationId,
      businessUnitId,
      request.id,
      value(request, 'student_contact_id', 'studentContactId'),
      value(request, 'payer_contact_id', 'payerContactId'),
      value(request, 'enrollment_id', 'enrollmentId'),
      value(request, 'class_section_id', 'classSectionId'),
      PROVIDER,
      environment,
      statusResult.providerTransactionId,
      value(request, 'merchant_reference', 'merchantReference'),
      value(request, 'requested_amount', 'requestedAmount'),
      value(request, 'currency'),
      now,
      value(request, 'source_reference', 'sourceReference'),
      `dejavoo:transaction:${environment}:${statusResult.providerTransactionId}`,
      JSON.stringify({ correlationId: statusResult.correlationId || null, providerSurface }),
    ],
  );
  return inserted.rows[0];
}

function receiptNumber(providerTransactionId) {
  const digest = createHash('sha256').update(providerTransactionId).digest('hex').slice(0, 12).toUpperCase();
  return `REC-DJV-${digest}`;
}

function receiptItems(request) {
  const metadata = json(value(request, 'metadata_json', 'metadataJson'));
  const quoteLines = metadata.registrationResult?.quote?.lines;
  const paymentIntent = metadata.paymentIntent;
  if (paymentIntent?.label && Array.isArray(paymentIntent.allocationPlan)) {
    return paymentIntent.allocationPlan.map((entry) => ({
      code: String(entry.itemCode || entry.treatment || 'payment').slice(0, 80),
      desc: String(paymentIntent.label).slice(0, 160),
      qty: 1,
      rate: Number(entry.amount),
      amount: Number(entry.amount),
      ledgerTreatment: entry.treatment,
    }));
  }
  if (!Array.isArray(quoteLines) || !quoteLines.length) {
    return [{ desc: 'Verified payment', qty: 1, rate: Number(value(request, 'requested_amount', 'requestedAmount')), amount: Number(value(request, 'requested_amount', 'requestedAmount')) }];
  }
  return quoteLines.map((line) => ({
    code: String(line.code || '').slice(0, 80),
    desc: String(line.label || line.code || 'Payment').slice(0, 160),
    qty: 1,
    rate: Number(line.amount),
    amount: Number(line.amount),
    ledgerTreatment: line.ledgerTreatment,
  }));
}

async function ensureReceipt(client, request, transaction, now, providerSurface = 'hpp') {
  const existingReceiptId = value(transaction, 'receipt_document_id', 'receiptDocumentId');
  if (existingReceiptId) return { id: existingReceiptId, created: false };
  const total = value(request, 'requested_amount', 'requestedAmount');
  const inserted = await client.query(
    `insert into financial_documents
      (organization_id, business_unit_id, contact_id, document_number, document_type, status,
       subtotal, tax, total, paid_amount, balance_due, issue_date, due_date, items_json, notes)
     values ($1, $2, $3, $4, 'Receipt', 'Paid', $5, 0, $5, $5, 0, $6, $6, $7::jsonb, $8)
     returning *`,
    [
      value(request, 'organization_id', 'organizationId'),
      value(request, 'business_unit_id', 'businessUnitId'),
      value(request, 'student_contact_id', 'studentContactId'),
      receiptNumber(value(transaction, 'provider_transaction_id', 'providerTransactionId')),
      total,
      now.toISOString().slice(0, 10),
      JSON.stringify(receiptItems(request)),
      providerSurface === 'spin'
        ? 'Verified Dejavoo terminal payment.'
        : 'Verified Dejavoo hosted payment.',
    ],
  );
  await client.query(
    'update provider_transactions set receipt_document_id = $1, updated_at = now() where id = $2',
    [inserted.rows[0].id, transaction.id],
  );
  return { ...inserted.rows[0], created: true };
}

async function recordVerifiedActivity(
  client,
  request,
  transaction,
  receipt,
  unappliedAmount,
  now,
  correlationId,
  providerSurface = 'hpp',
) {
  await client.query(
    `insert into activity_events
      (organization_id, business_unit_id, contact_id, event_type, message, metadata_json, occurred_at)
     select $1, $2, $3, 'financial.payment_verified', $4, $5::jsonb, $6
      where not exists (
        select 1 from activity_events
         where organization_id = $1
           and event_type = 'financial.payment_verified'
           and metadata_json->>'providerTransactionId' = $7
      )`,
    [
      value(request, 'organization_id', 'organizationId'),
      value(request, 'business_unit_id', 'businessUnitId'),
      value(request, 'student_contact_id', 'studentContactId'),
      `Verified card payment ${centsToMoney(moneyToCents(value(request, 'requested_amount', 'requestedAmount')))}.`,
      JSON.stringify({
        paymentRequestId: request.id,
        providerTransactionId: value(transaction, 'provider_transaction_id', 'providerTransactionId'),
        receiptDocumentId: receipt.id,
        provider: PROVIDER,
        providerSurface,
        providerEnvironment: value(request, 'provider_environment', 'providerEnvironment'),
        unappliedCreditAmount: unappliedAmount,
        correlationId,
      }),
      now,
      value(transaction, 'provider_transaction_id', 'providerTransactionId'),
    ],
  );
}

async function markRegistrationPaid(client, request, transaction, now) {
  const enrollmentId = value(request, 'enrollment_id', 'enrollmentId');
  if (!enrollmentId) return;
  await client.query(
    `update contact_course_records
        set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $1::jsonb,
            updated_at = now()
      where id = $2 and organization_id = $3 and business_unit_id = $4`,
    [
      JSON.stringify({
        registrationState: 'payment_verified',
        paymentRequestId: request.id,
        providerTransactionId: value(transaction, 'provider_transaction_id', 'providerTransactionId'),
        paymentVerifiedAt: now.toISOString(),
      }),
      enrollmentId,
      value(request, 'organization_id', 'organizationId'),
      value(request, 'business_unit_id', 'businessUnitId'),
    ],
  );
}

async function markRequestStatus(client, requestId, status) {
  const allowedFrom = status === 'completed'
    ? ['created', 'pending', 'failed', 'canceled', 'expired', 'completed']
    : status === 'pending'
      ? ['created', 'pending']
      : ['created', 'pending', status];
  await client.query(
    `update payment_requests set status = $1, updated_at = now()
      where id = $2 and status = any($3::text[])`,
    [status, requestId, allowedFrom],
  );
}

function expectsBookFulfillment(request) {
  const metadata = json(value(request, 'metadata_json', 'metadataJson'));
  return Boolean(metadata.registrationResult?.quote?.lines?.some((line) => (
    ['registration_book_bundle', 'book_only'].includes(String(line?.code || ''))
  )));
}

async function recordFulfillmentAttention(client, request, transaction, code) {
  await client.query(
    `insert into activity_events
      (organization_id, business_unit_id, contact_id, event_type, message, metadata_json, occurred_at)
     select $1, $2, $3, 'fulfillment.enqueue_attention', $4, $5::jsonb, now()
      where not exists (
        select 1 from activity_events
         where organization_id = $1
           and event_type = 'fulfillment.enqueue_attention'
           and metadata_json->>'providerTransactionId' = $6
      )`,
    [
      value(request, 'organization_id', 'organizationId'),
      value(request, 'business_unit_id', 'businessUnitId'),
      value(request, 'student_contact_id', 'studentContactId'),
      `Verified payment needs fulfillment review (${code}).`,
      JSON.stringify({
        paymentRequestId: request.id,
        providerTransactionId: value(transaction, 'provider_transaction_id', 'providerTransactionId'),
        reconciliationCode: code,
      }),
      value(transaction, 'provider_transaction_id', 'providerTransactionId'),
    ],
  );
}

async function activateFulfillmentWithoutBlockingPayment(client, request, transaction) {
  if (!expectsBookFulfillment(request)) return { queued: false, reason: 'not_required', fulfillmentId: null };
  await client.query('savepoint fulfillment_enqueue');
  try {
    const fulfillment = await activateBookFulfillmentForVerifiedPayment(client, {
      organizationId: value(request, 'organization_id', 'organizationId'),
      businessUnitId: value(request, 'business_unit_id', 'businessUnitId'),
      paymentRequestId: request.id,
      providerTransactionId: transaction.id,
    });
    if (!fulfillment) throw new Error('Expected book fulfillment record was not found.');
    await client.query('release savepoint fulfillment_enqueue');
    return { queued: true, reason: null, fulfillmentId: fulfillment.id };
  } catch (error) {
    await client.query('rollback to savepoint fulfillment_enqueue');
    await client.query('release savepoint fulfillment_enqueue');
    const code = error?.code || 'fulfillment_enqueue_failed';
    await recordFulfillmentAttention(client, request, transaction, code);
    return { queued: false, reason: code, fulfillmentId: null };
  }
}

export async function reconcileDejavooPayment(client, {
  merchantReference,
  environment,
  expectedMerchantId,
  callback,
  statusResult,
  providerSurface = 'hpp',
  now = new Date(),
}) {
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`payment-reconciliation:${environment}:${merchantReference}`],
    );
    const requestResult = await client.query(
      `select * from payment_requests
        where merchant_reference = $1 and provider = $2 and provider_environment = $3
        for update`,
      [merchantReference, PROVIDER, environment],
    );
    if (requestResult.rows.length > 1) {
      throw new PaymentReconciliationError(
        'payment_request_ambiguous',
        'Payment reference resolves to more than one request.',
        409,
      );
    }
    const request = requestResult.rows[0];
    if (!request) {
      throw new PaymentReconciliationError('payment_request_not_found', 'Expected payment request was not found.', 404);
    }
    const eventResult = await recordProviderEvent(client, {
      organizationId: value(request, 'organization_id', 'organizationId'),
      businessUnitId: value(request, 'business_unit_id', 'businessUnitId'),
      paymentRequestId: request.id,
      studentContactId: value(request, 'student_contact_id', 'studentContactId'),
      payerContactId: value(request, 'payer_contact_id', 'payerContactId'),
      enrollmentId: value(request, 'enrollment_id', 'enrollmentId'),
      classSectionId: value(request, 'class_section_id', 'classSectionId'),
      provider: PROVIDER,
      providerEnvironment: environment,
      eventType: callback.eventType,
      payloadSha256: callback.payloadSha256,
      safePayload: safeEventPayload(callback, statusResult),
      idempotencyKey: callback.idempotencyKey,
      occurredAt: now,
    });
    const event = eventResult.record;
    if (eventResult.duplicate && TERMINAL_EVENT_STATUSES.has(value(event, 'processing_status', 'processingStatus'))) {
      await client.query('commit');
      return { outcome: 'duplicate', duplicate: true, paymentRequestId: request.id, eventId: event.id };
    }

    if (!statusResult?.ok) {
      await markRequestStatus(client, request.id, 'pending');
      await updateEvent(client, event.id, {
        processingStatus: 'failed',
        errorCode: statusResult?.error?.code || 'DEJAVOO_STATUS_UNAVAILABLE',
        safePayload: safeEventPayload(callback, statusResult, { retryable: Boolean(statusResult?.error?.retryable) }),
      });
      await client.query('commit');
      return {
        outcome: 'verification_unavailable',
        duplicate: eventResult.duplicate,
        retryable: Boolean(statusResult?.error?.retryable),
        paymentRequestId: request.id,
        eventId: event.id,
      };
    }

    if (['pending', 'unknown'].includes(statusResult.status)) {
      await markRequestStatus(client, request.id, 'pending');
      await updateEvent(client, event.id, {
        processingStatus: 'received',
        errorCode: `provider_status_${statusResult.status}`,
        safePayload: safeEventPayload(callback, statusResult, { retryable: true }),
      });
      await client.query('commit');
      return {
        outcome: 'pending',
        duplicate: eventResult.duplicate,
        retryable: true,
        paymentRequestId: request.id,
        eventId: event.id,
      };
    }

    if (['failed', 'canceled', 'expired'].includes(statusResult.status)) {
      if (value(request, 'status') !== 'completed') {
        await markRequestStatus(client, request.id, statusResult.status === 'failed' ? 'failed' : statusResult.status);
      }
      await updateEvent(client, event.id, {
        processingStatus: 'processed',
        safePayload: safeEventPayload(callback, statusResult, { terminal: true }),
        processed: true,
      });
      await client.query('commit');
      return {
        outcome: statusResult.status,
        duplicate: eventResult.duplicate,
        paymentRequestId: request.id,
        eventId: event.id,
      };
    }

    if (statusResult.status !== 'succeeded') {
      await updateEvent(client, event.id, {
        processingStatus: 'failed',
        errorCode: 'provider_status_unsupported',
        safePayload: safeEventPayload(callback, statusResult),
      });
      await recordOperatorAttention(client, request, event, 'provider_status_unsupported', statusResult);
      await client.query('commit');
      return { outcome: 'review_required', duplicate: eventResult.duplicate, paymentRequestId: request.id, eventId: event.id };
    }

    const verification = succeededValidation(request, statusResult, expectedMerchantId);
    if (verification.code) {
      await updateEvent(client, event.id, {
        processingStatus: 'failed',
        errorCode: verification.code,
        safePayload: safeEventPayload(callback, statusResult, { reviewRequired: true }),
      });
      await recordOperatorAttention(client, request, event, verification.code, statusResult);
      await client.query('commit');
      return {
        outcome: 'review_required',
        code: verification.code,
        duplicate: eventResult.duplicate,
        paymentRequestId: request.id,
        eventId: event.id,
      };
    }

    const transaction = await ensureVerifiedTransaction(client, request, statusResult, now, providerSurface);
    const plan = allocationPlan(request);
    const allocations = [];
    let unappliedCents = 0n;
    for (const entry of plan) {
      if (entry.treatment === 'unapplied_credit') {
        unappliedCents += moneyToCents(entry.amount, 'unapplied credit amount');
        continue;
      }
      allocations.push(await allocateVerifiedPaymentInTransaction(client, {
        organizationId: value(request, 'organization_id', 'organizationId'),
        businessUnitId: value(request, 'business_unit_id', 'businessUnitId'),
        chargeId: entry.chargeId,
        transactionId: transaction.id,
        amount: entry.amount,
        idempotencyKey: `dejavoo:allocation:${transaction.id}:${entry.chargeId}`,
        metadata: { paymentRequestId: request.id, itemCode: entry.itemCode || null },
        asOf: now,
      }));
    }
    const receipt = await ensureReceipt(client, request, transaction, now, providerSurface);
    const unappliedAmount = centsToMoney(unappliedCents);
    await markRegistrationPaid(client, request, transaction, now);
    await recordVerifiedActivity(
      client,
      request,
      transaction,
      receipt,
      unappliedAmount,
      now,
      statusResult.correlationId || null,
      providerSurface,
    );
    await markRequestStatus(client, request.id, 'completed');
    const fulfillment = await activateFulfillmentWithoutBlockingPayment(client, request, transaction);
    await updateEvent(client, event.id, {
      processingStatus: 'processed',
      transactionId: transaction.id,
      safePayload: safeEventPayload(callback, statusResult, {
        receiptDocumentId: receipt.id,
        allocatedChargeCount: allocations.length,
        unappliedCreditAmount: unappliedAmount,
        fulfillmentQueued: fulfillment.queued,
        fulfillmentId: fulfillment.fulfillmentId,
        fulfillmentReason: fulfillment.reason,
      }),
      processed: true,
    });
    await client.query('commit');
    return {
      outcome: 'completed',
      duplicate: eventResult.duplicate,
      paymentRequestId: request.id,
      transactionId: transaction.id,
      receiptDocumentId: receipt.id,
      allocatedChargeCount: allocations.length,
      unappliedCreditAmount: unappliedAmount,
      fulfillmentQueued: fulfillment.queued,
      fulfillmentId: fulfillment.fulfillmentId,
      eventId: event.id,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
