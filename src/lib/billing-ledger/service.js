import {
  assertPaymentAllocation,
  centsToMoney,
  moneyToCents,
  nonnegativeMoneyToCents,
  normalizeCurrency,
  summarizeChargeLedger,
} from './model.js';

export class BillingLedgerError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'BillingLedgerError';
    this.code = code;
    this.status = status;
  }
}

function required(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new BillingLedgerError('invalid_input', `${name} is required.`);
  return clean;
}

function scope(input) {
  return {
    organizationId: required(input.organizationId, 'organizationId'),
    businessUnitId: required(input.businessUnitId, 'businessUnitId'),
  };
}

async function assertContactScope(client, ledgerScope, contactId, label) {
  if (!contactId) return;
  const result = await client.query(
    `select id from contacts
      where id = $1 and organization_id = $2 and primary_business_unit_id = $3
      limit 1`,
    [contactId, ledgerScope.organizationId, ledgerScope.businessUnitId],
  );
  if (result.rows.length !== 1) {
    throw new BillingLedgerError('scope_not_found', `${label} is not available in the requested business unit.`, 404);
  }
}

async function resolveDuplicate(client, table, ledgerScope, idempotencyKey) {
  const result = await client.query(
    `select * from ${table}
      where organization_id = $1 and business_unit_id = $2 and idempotency_key = $3
      limit 1`,
    [ledgerScope.organizationId, ledgerScope.businessUnitId, idempotencyKey],
  );
  if (result.rows.length !== 1) throw new BillingLedgerError('idempotency_conflict', 'The idempotent record could not be resolved.', 409);
  return { record: result.rows[0], duplicate: true };
}

export async function createStudentCharge(client, input) {
  const ledgerScope = scope(input);
  const studentContactId = required(input.studentContactId, 'studentContactId');
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await assertContactScope(client, ledgerScope, studentContactId, 'Student contact');
  await assertContactScope(client, ledgerScope, input.payerContactId, 'Payer contact');
  const result = await client.query(
    `insert into student_charges
      (organization_id, business_unit_id, student_contact_id, payer_contact_id, enrollment_id,
       class_section_id, charge_type, description, amount, currency, status, service_period_start,
       service_period_end, original_due_date, source_type, source_reference, idempotency_key, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'due', $11, $12, $13, $14, $15, $16, $17::jsonb)
     on conflict (organization_id, business_unit_id, idempotency_key) do nothing
     returning *`,
    [
      ledgerScope.organizationId, ledgerScope.businessUnitId, studentContactId, input.payerContactId || null,
      input.enrollmentId || null, input.classSectionId || null, required(input.chargeType, 'chargeType'),
      required(input.description, 'description'), input.amount, normalizeCurrency(input.currency),
      input.servicePeriodStart || null, input.servicePeriodEnd || null, input.originalDueDate || null,
      required(input.sourceType, 'sourceType'), input.sourceReference || null, idempotencyKey,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0] ? { record: result.rows[0], duplicate: false } : resolveDuplicate(client, 'student_charges', ledgerScope, idempotencyKey);
}

export async function createPaymentRequest(client, input) {
  const ledgerScope = scope(input);
  const studentContactId = required(input.studentContactId, 'studentContactId');
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await assertContactScope(client, ledgerScope, studentContactId, 'Student contact');
  await assertContactScope(client, ledgerScope, input.payerContactId, 'Payer contact');
  const result = await client.query(
    `insert into payment_requests
      (organization_id, business_unit_id, student_contact_id, payer_contact_id, enrollment_id,
       class_section_id, charge_id, requested_amount, currency, status, provider, provider_environment,
       provider_request_id, merchant_reference, expires_at, source_type, source_reference, idempotency_key, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
     on conflict (organization_id, business_unit_id, idempotency_key) do nothing
     returning *`,
    [
      ledgerScope.organizationId, ledgerScope.businessUnitId, studentContactId, input.payerContactId || null,
      input.enrollmentId || null, input.classSectionId || null, input.chargeId || null, input.requestedAmount,
      normalizeCurrency(input.currency), input.status || 'created', input.provider || null,
      input.providerEnvironment || null, input.providerRequestId || null, required(input.merchantReference, 'merchantReference'),
      input.expiresAt || null, required(input.sourceType, 'sourceType'), input.sourceReference || null,
      idempotencyKey, JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0] ? { record: result.rows[0], duplicate: false } : resolveDuplicate(client, 'payment_requests', ledgerScope, idempotencyKey);
}

export async function createProviderTransaction(client, input) {
  const ledgerScope = scope(input);
  const studentContactId = required(input.studentContactId, 'studentContactId');
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await assertContactScope(client, ledgerScope, studentContactId, 'Student contact');
  await assertContactScope(client, ledgerScope, input.payerContactId, 'Payer contact');
  const status = input.status || 'pending';
  if (status === 'verified' && !input.verifiedAt) throw new BillingLedgerError('invalid_input', 'verifiedAt is required for verified transactions.');
  const result = await client.query(
    `insert into provider_transactions
      (organization_id, business_unit_id, payment_request_id, student_contact_id, payer_contact_id,
       enrollment_id, class_section_id, parent_transaction_id, receipt_document_id, provider,
       provider_environment, provider_transaction_id, merchant_reference, transaction_kind, status,
       amount, currency, occurred_at, verified_at, source_type, source_reference, idempotency_key, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23::jsonb)
     on conflict (organization_id, business_unit_id, idempotency_key) do nothing
     returning *`,
    [
      ledgerScope.organizationId, ledgerScope.businessUnitId, input.paymentRequestId || null, studentContactId,
      input.payerContactId || null, input.enrollmentId || null, input.classSectionId || null,
      input.parentTransactionId || null, input.receiptDocumentId || null, required(input.provider, 'provider'),
      required(input.providerEnvironment, 'providerEnvironment'), required(input.providerTransactionId, 'providerTransactionId'),
      required(input.merchantReference, 'merchantReference'), input.transactionKind || 'payment', status,
      input.amount, normalizeCurrency(input.currency), input.occurredAt || null, input.verifiedAt || null,
      required(input.sourceType, 'sourceType'), input.sourceReference || null, idempotencyKey,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return result.rows[0] ? { record: result.rows[0], duplicate: false } : resolveDuplicate(client, 'provider_transactions', ledgerScope, idempotencyKey);
}

export async function recordProviderEvent(client, input) {
  const ledgerScope = scope(input);
  const studentContactId = required(input.studentContactId, 'studentContactId');
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  if (!input.paymentRequestId && !input.transactionId) {
    throw new BillingLedgerError('invalid_input', 'A provider event must link to a payment request or transaction.');
  }
  await assertContactScope(client, ledgerScope, studentContactId, 'Student contact');
  await assertContactScope(client, ledgerScope, input.payerContactId, 'Payer contact');
  const result = await client.query(
    `insert into payment_provider_events
      (organization_id, business_unit_id, payment_request_id, transaction_id, student_contact_id,
       payer_contact_id, enrollment_id, class_section_id, provider, provider_environment,
       provider_event_id, event_type, processing_status, payload_sha256, safe_payload_json,
       idempotency_key, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'received', $13, $14::jsonb, $15, $16)
     on conflict (organization_id, business_unit_id, idempotency_key) do nothing
     returning *`,
    [
      ledgerScope.organizationId, ledgerScope.businessUnitId, input.paymentRequestId || null,
      input.transactionId || null, studentContactId, input.payerContactId || null,
      input.enrollmentId || null, input.classSectionId || null, required(input.provider, 'provider'),
      required(input.providerEnvironment, 'providerEnvironment'), input.providerEventId || null,
      required(input.eventType, 'eventType'), required(input.payloadSha256, 'payloadSha256'),
      JSON.stringify(input.safePayload || {}), idempotencyKey, input.occurredAt || null,
    ],
  );
  return result.rows[0] ? { record: result.rows[0], duplicate: false } : resolveDuplicate(client, 'payment_provider_events', ledgerScope, idempotencyKey);
}

export async function allocateVerifiedPayment(client, input) {
  const ledgerScope = scope(input);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`billing-allocation:${ledgerScope.organizationId}:${ledgerScope.businessUnitId}:${input.chargeId}:${input.transactionId}`],
    );
    const duplicate = await client.query(
      `select * from payment_allocations
        where organization_id = $1 and business_unit_id = $2 and idempotency_key = $3
        limit 1`,
      [ledgerScope.organizationId, ledgerScope.businessUnitId, idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query('commit');
      return { allocation: duplicate.rows[0], duplicate: true };
    }
    const chargeResult = await client.query(
      `select * from student_charges
        where id = $1 and organization_id = $2 and business_unit_id = $3
        for update`,
      [input.chargeId, ledgerScope.organizationId, ledgerScope.businessUnitId],
    );
    const transactionResult = await client.query(
      `select * from provider_transactions
        where id = $1 and organization_id = $2 and business_unit_id = $3
        for update`,
      [input.transactionId, ledgerScope.organizationId, ledgerScope.businessUnitId],
    );
    if (!chargeResult.rows[0] || !transactionResult.rows[0]) {
      throw new BillingLedgerError('scope_not_found', 'Charge or transaction is not available in the requested business unit.', 404);
    }
    const chargeRecord = {
      ...chargeResult.rows[0],
      originalDueDate: chargeResult.rows[0].original_due_date ?? chargeResult.rows[0].originalDueDate ?? null,
    };
    const transactionRecord = {
      ...transactionResult.rows[0],
      transactionKind: transactionResult.rows[0].transaction_kind ?? transactionResult.rows[0].transactionKind,
    };
    const chargeAllocations = await client.query(
      `select coalesce(sum(case when t.transaction_kind = 'refund' then -a.amount else a.amount end), 0)::text as allocated
         from payment_allocations a
         join provider_transactions t on t.id = a.transaction_id
        where a.charge_id = $1 and a.organization_id = $2 and a.business_unit_id = $3 and t.status = 'verified'`,
      [input.chargeId, ledgerScope.organizationId, ledgerScope.businessUnitId],
    );
    const transactionAllocations = await client.query(
      `select coalesce(sum(amount), 0)::text as allocated
         from payment_allocations
        where transaction_id = $1 and organization_id = $2 and business_unit_id = $3`,
      [input.transactionId, ledgerScope.organizationId, ledgerScope.businessUnitId],
    );
    const invariant = assertPaymentAllocation({
      charge: chargeRecord,
      transaction: transactionRecord,
      chargeAllocated: chargeAllocations.rows[0]?.allocated || '0.00',
      transactionAllocated: transactionAllocations.rows[0]?.allocated || '0.00',
      amount: input.amount,
    });
    const inserted = await client.query(
      `insert into payment_allocations
        (organization_id, business_unit_id, charge_id, transaction_id, amount, idempotency_key, metadata_json)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       returning *`,
      [
        ledgerScope.organizationId, ledgerScope.businessUnitId, input.chargeId, input.transactionId,
        invariant.amount, idempotencyKey, JSON.stringify(input.metadata || {}),
      ],
    );
    const snapshot = summarizeChargeLedger({
      charge: chargeRecord,
      allocations: [{ amount: invariant.amount, transactionKind: 'payment', transactionStatus: 'verified' }],
      asOf: input.asOf || new Date(),
    });
    const totalAfter = centsToMoney(
      nonnegativeMoneyToCents(chargeAllocations.rows[0]?.allocated || '0.00', 'charge allocated amount')
        + moneyToCents(invariant.amount, 'allocation amount'),
    );
    const fullSnapshot = summarizeChargeLedger({
      charge: chargeRecord,
      allocations: [{ amount: totalAfter, transactionKind: 'payment', transactionStatus: 'verified' }],
      asOf: input.asOf || new Date(),
    });
    await client.query(
      `update student_charges set status = $1, updated_at = now()
        where id = $2 and organization_id = $3 and business_unit_id = $4`,
      [fullSnapshot.status, input.chargeId, ledgerScope.organizationId, ledgerScope.businessUnitId],
    );
    await client.query('commit');
    return { allocation: inserted.rows[0], duplicate: false, charge: fullSnapshot, applied: snapshot };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
