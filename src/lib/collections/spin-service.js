import { createHash } from 'node:crypto';

import { moneyToCents } from '../billing-ledger/model.js';
import {
  createDejavooSpinAdapter,
  resolveDejavooSpinConfig,
} from '../payments/providers/dejavoo-spin.js';
import { reconcileDejavooPayment } from '../payments/reconciliation.js';
import { CollectionsError } from './model.js';

function clean(value) {
  return String(value ?? '').trim();
}

function value(row, snake, camel = snake) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function json(valueToParse) {
  if (!valueToParse) return {};
  if (typeof valueToParse === 'object') return valueToParse;
  try { return JSON.parse(valueToParse); } catch { return {}; }
}

function scope(input = {}) {
  const organizationId = clean(input.organizationId);
  const businessUnitId = clean(input.businessUnitId);
  if (!organizationId || !businessUnitId) {
    throw new CollectionsError('scope_required', 'Organization and business unit are required.');
  }
  return { organizationId, businessUnitId };
}

function normalizeInput(input = {}) {
  const paymentRequestId = clean(input.paymentRequestId);
  const idempotencyKey = clean(input.idempotencyKey);
  if (!paymentRequestId || !idempotencyKey || idempotencyKey.length > 180) {
    throw new CollectionsError('terminal_input_invalid', 'Payment request and idempotency key are required.');
  }
  const environment = clean(input.environment).toLowerCase();
  if (!['uat', 'production'].includes(environment)) {
    throw new CollectionsError('provider_environment_invalid', 'Payment provider environment is invalid.');
  }
  return { paymentRequestId, idempotencyKey, environment };
}

function safeResult(result) {
  if (!result) return null;
  return {
    ok: Boolean(result.ok),
    status: result.status || 'unknown',
    providerStatus: result.providerStatus || null,
    providerTransactionId: result.providerTransactionId || null,
    merchantReference: result.merchantReference || null,
    correlationId: result.correlationId || null,
    errorCode: result.ok ? null : result.error?.code || 'DEJAVOO_SPIN_UNKNOWN',
    retryable: Boolean(result.error?.retryable),
    uncertain: Boolean(result.uncertain),
  };
}

function statusEvent({ request, action, saleResult, statusResult, now }) {
  const safePayload = {
    providerSurface: 'spin',
    action,
    paymentRequestId: request.id,
    sale: safeResult(saleResult),
    verification: safeResult(statusResult),
  };
  const serialized = JSON.stringify(safePayload);
  const payloadSha256 = createHash('sha256').update(serialized).digest('hex');
  return {
    eventType: `spin.${action}`,
    payloadSha256,
    safePayload,
    idempotencyKey: `dejavoo:spin:${value(request, 'provider_environment', 'providerEnvironment')}:${request.id}:${payloadSha256}`,
    occurredAt: now,
  };
}

function recoveryGuidance(outcome) {
  if (outcome === 'completed') return null;
  if (['failed', 'canceled', 'expired'].includes(outcome)) {
    return 'The terminal reported a final non-payment result. Use a new payment request for another card attempt; record cash or check only if it was actually received.';
  }
  if (outcome === 'review_required') {
    return 'Do not retry or record payment manually. Verify the reference and amount, then escalate the mismatch.';
  }
  return 'Do not start another terminal payment. Keep the request pending and use Check terminal status.';
}

async function loadAndMarkAttempt(client, input, action, now) {
  const paymentScope = scope(input);
  const normalized = normalizeInput(input);
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`collection-spin:${paymentScope.organizationId}:${paymentScope.businessUnitId}:${normalized.paymentRequestId}`],
    );
    const found = await client.query(
      `select * from payment_requests
        where id = $1 and organization_id = $2 and business_unit_id = $3
        for update`,
      [normalized.paymentRequestId, paymentScope.organizationId, paymentScope.businessUnitId],
    );
    const request = found.rows[0];
    if (!request) {
      throw new CollectionsError('payment_request_not_found', 'Payment request is not available in this division.', 404);
    }
    if (value(request, 'status') === 'completed') {
      throw new CollectionsError('payment_request_completed', 'This payment request is already completed.', 409);
    }
    const metadata = json(value(request, 'metadata_json', 'metadataJson'));
    const terminalAttempt = metadata.terminalPaymentAttempt;
    if (action === 'initiate') {
      if (metadata.hostedPaymentAttempt) {
        throw new CollectionsError(
          'payment_request_provider_conflict',
          'This request already has a hosted-checkout attempt. Review that attempt before choosing a terminal.',
          409,
        );
      }
      if (terminalAttempt) {
        throw new CollectionsError(
          'terminal_attempt_exists',
          'A terminal attempt already exists. Check its status instead of charging again.',
          409,
          { state: terminalAttempt.state || 'unknown', correlationId: terminalAttempt.correlationId || null },
        );
      }
    } else if (!terminalAttempt) {
      throw new CollectionsError('terminal_attempt_missing', 'No terminal attempt is available to recover.', 409);
    }
    const correlationId = terminalAttempt?.correlationId
      || `collections:spin:${createHash('sha256').update(normalized.idempotencyKey).digest('hex').slice(0, 32)}`;
    if (action === 'initiate') {
      await client.query(
        `update payment_requests
            set provider = 'dejavoo', provider_environment = $1, provider_request_id = $2,
                status = 'pending', metadata_json = coalesce(metadata_json, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          where id = $4 and organization_id = $5 and business_unit_id = $6`,
        [
          normalized.environment,
          correlationId,
          JSON.stringify({
            terminalPaymentAttempt: {
              state: 'started',
              correlationId,
              startedAt: now.toISOString(),
              actorUserId: input.actorUserId || null,
            },
          }),
          request.id,
          paymentScope.organizationId,
          paymentScope.businessUnitId,
        ],
      );
    } else if (value(request, 'provider_environment', 'providerEnvironment') !== normalized.environment) {
      throw new CollectionsError('provider_environment_mismatch', 'Terminal recovery environment does not match the payment request.', 409);
    }
    await client.query('commit');
    return {
      request: {
        ...request,
        provider: 'dejavoo',
        provider_environment: normalized.environment,
        providerEnvironment: normalized.environment,
      },
      paymentScope,
      normalized,
      correlationId,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function persistAttemptOutcome(client, prepared, action, result, now) {
  const safe = safeResult(result);
  await client.query(
    `update payment_requests
        set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $1::jsonb, updated_at = now()
      where id = $2 and organization_id = $3 and business_unit_id = $4`,
    [
      JSON.stringify({
        terminalPaymentAttempt: {
          state: result.outcome,
          correlationId: prepared.correlationId,
          lastAction: action,
          checkedAt: now.toISOString(),
          providerStatus: safe.providerStatus,
          providerTransactionId: safe.providerTransactionId,
          errorCode: safe.errorCode,
        },
      }),
      prepared.request.id,
      prepared.paymentScope.organizationId,
      prepared.paymentScope.businessUnitId,
    ],
  );
}

async function runTerminalOperation(client, input, action) {
  const now = input.now instanceof Date ? input.now : new Date();
  const prepared = await loadAndMarkAttempt(client, input, action, now);
  const adapter = input.adapter || createDejavooSpinAdapter({ environment: prepared.normalized.environment });
  const providerInput = {
    merchantReference: value(prepared.request, 'merchant_reference', 'merchantReference'),
    correlationId: prepared.correlationId,
    proxyTimeoutSeconds: input.proxyTimeoutSeconds,
  };
  let saleResult = null;
  if (action === 'initiate') {
    saleResult = await adapter.createTerminalSale({
      ...providerInput,
      amountCents: Number(moneyToCents(
        value(prepared.request, 'requested_amount', 'requestedAmount'),
        'requested amount',
      )),
      currency: value(prepared.request, 'currency') || 'USD',
    });
  }

  let statusResult;
  if (saleResult?.ok && ['failed', 'canceled'].includes(saleResult.status)) {
    statusResult = saleResult;
  } else if (saleResult?.ok || saleResult?.uncertain || action === 'recover') {
    statusResult = await adapter.queryTerminalStatus(providerInput);
  } else {
    statusResult = saleResult;
  }

  const callback = statusEvent({
    request: prepared.request,
    action,
    saleResult,
    statusResult,
    now,
  });
  const config = resolveDejavooSpinConfig({ environment: prepared.normalized.environment });
  const reconciliation = await reconcileDejavooPayment(client, {
    merchantReference: value(prepared.request, 'merchant_reference', 'merchantReference'),
    environment: prepared.normalized.environment,
    expectedMerchantId: config.tpn || null,
    callback,
    statusResult,
    providerSurface: 'spin',
    now,
  });
  const response = {
    ...reconciliation,
    correlationId: prepared.correlationId,
    providerStatus: statusResult?.providerStatus || null,
    terminalStatus: statusResult?.status || 'unknown',
    recoveryRequired: !['completed', 'failed', 'canceled', 'expired'].includes(reconciliation.outcome),
    recoveryGuidance: recoveryGuidance(reconciliation.outcome),
  };
  await persistAttemptOutcome(client, prepared, action, {
    ...response,
    ...statusResult,
    outcome: reconciliation.outcome,
  }, now);
  return response;
}

export function initiateSpinCollectionPayment(client, input = {}) {
  return runTerminalOperation(client, input, 'initiate');
}

export function recoverSpinCollectionPayment(client, input = {}) {
  return runTerminalOperation(client, input, 'recover');
}
