import { createHash } from 'node:crypto';

import {
  allocateVerifiedPaymentInTransaction,
  createProviderTransaction,
} from '../billing-ledger/service.js';
import { activateBookFulfillmentForVerifiedPayment } from '../fulfillment/service.js';
import { createDejavooAdapter } from '../payments/providers/dejavoo.js';
import {
  CollectionsError,
  centsToMoney,
  normalizeHostedLinkInput,
  normalizeManualPayment,
  normalizeQueuePage,
  normalizeQueueState,
} from './model.js';

function value(row, snake, camel = snake) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function json(valueToParse) {
  if (!valueToParse) return {};
  if (typeof valueToParse === 'object') return valueToParse;
  try { return JSON.parse(valueToParse); } catch { return {}; }
}

function scoped(scope = {}) {
  const organizationId = String(scope.organizationId || '').trim();
  const businessUnitId = String(scope.businessUnitId || '').trim();
  if (!organizationId || !businessUnitId) {
    throw new CollectionsError('scope_required', 'Organization and business unit are required.');
  }
  return { organizationId, businessUnitId };
}

function mapCharge(row) {
  return {
    id: row.id,
    organizationId: value(row, 'organization_id', 'organizationId'),
    businessUnitId: value(row, 'business_unit_id', 'businessUnitId'),
    studentContactId: value(row, 'student_contact_id', 'studentContactId'),
    payerContactId: value(row, 'payer_contact_id', 'payerContactId'),
    enrollmentId: value(row, 'enrollment_id', 'enrollmentId'),
    classSectionId: value(row, 'class_section_id', 'classSectionId'),
    studentName: value(row, 'student_name', 'studentName'),
    studentEmail: value(row, 'student_email', 'studentEmail'),
    studentPhone: value(row, 'student_phone', 'studentPhone'),
    payerName: value(row, 'payer_name', 'payerName'),
    courseName: value(row, 'course_name', 'courseName'),
    sectionKey: value(row, 'section_key', 'sectionKey'),
    chargeType: value(row, 'charge_type', 'chargeType'),
    description: row.description,
    amount: String(row.amount),
    allocated: String(row.allocated || '0.00'),
    balance: String(row.balance || row.amount),
    currency: row.currency,
    state: value(row, 'derived_status', 'derivedStatus'),
    originalDueDate: value(row, 'original_due_date', 'originalDueDate'),
    createdAt: value(row, 'created_at', 'createdAt'),
    paymentRequest: value(row, 'payment_request_id', 'paymentRequestId') ? {
      id: value(row, 'payment_request_id', 'paymentRequestId'),
      status: value(row, 'payment_request_status', 'paymentRequestStatus'),
      requestedAmount: String(value(row, 'requested_amount', 'requestedAmount')),
      merchantReference: value(row, 'merchant_reference', 'merchantReference'),
      provider: value(row, 'request_provider', 'requestProvider'),
      providerEnvironment: value(row, 'provider_environment', 'providerEnvironment'),
      metadata: json(value(row, 'request_metadata_json', 'requestMetadataJson')),
    } : null,
    latestTransaction: value(row, 'transaction_id', 'transactionId') ? {
      id: value(row, 'transaction_id', 'transactionId'),
      provider: value(row, 'transaction_provider', 'transactionProvider'),
      status: value(row, 'transaction_status', 'transactionStatus'),
      amount: String(value(row, 'transaction_amount', 'transactionAmount')),
      verifiedAt: value(row, 'verified_at', 'verifiedAt'),
      receiptDocumentId: value(row, 'receipt_document_id', 'receiptDocumentId'),
    } : null,
    fulfillment: value(row, 'fulfillment_id', 'fulfillmentId') ? {
      id: value(row, 'fulfillment_id', 'fulfillmentId'),
      deliveryMode: value(row, 'delivery_mode', 'deliveryMode'),
      status: value(row, 'fulfillment_status', 'fulfillmentStatus'),
      digitalStatus: value(row, 'digital_status', 'digitalStatus'),
      physicalStatus: value(row, 'physical_status', 'physicalStatus'),
    } : null,
  };
}

const LEDGER_CTE = `
with charge_ledger as (
  select sc.*,
         coalesce(sum(case when pt.transaction_kind = 'refund' then -pa.amount else pa.amount end)
           filter (where pt.status = 'verified'), 0)::numeric(12,2) as allocated
    from student_charges sc
    left join payment_allocations pa on pa.charge_id = sc.id
    left join provider_transactions pt on pt.id = pa.transaction_id
   where sc.organization_id = $1 and sc.business_unit_id = $2
     and sc.status not in ('waived', 'voided', 'refunded')
   group by sc.id
), classified as (
  select *,
         greatest(amount - allocated, 0)::numeric(12,2) as balance,
         case
           when amount - allocated <= 0 then 'paid'
           when original_due_date is not null and original_due_date < current_date then 'overdue'
           when allocated > 0 then 'partially_paid'
           else 'due'
         end as derived_status
    from charge_ledger
)`;

export async function loadCollectionsQueue(client, input = {}) {
  const scope = scoped(input);
  const state = normalizeQueueState(input.state);
  const { page, pageSize } = normalizeQueuePage(input);
  const search = String(input.search || '').trim().slice(0, 120);
  const offset = (page - 1) * pageSize;
  const params = [scope.organizationId, scope.businessUnitId, state, search, pageSize, offset];
  const result = await client.query(
    `${LEDGER_CTE}
     select c.*, student.name as student_name, student.email as student_email, student.phone as student_phone,
            payer.name as payer_name, enrollment.course_name, section.section_key,
            request.id as payment_request_id, request.status as payment_request_status,
            request.requested_amount, request.merchant_reference, request.provider as request_provider,
            request.provider_environment, request.metadata_json as request_metadata_json,
            transaction.id as transaction_id, transaction.provider as transaction_provider,
            transaction.status as transaction_status, transaction.amount as transaction_amount,
            transaction.verified_at, transaction.receipt_document_id,
            fulfillment.id as fulfillment_id, fulfillment.delivery_mode, fulfillment.status as fulfillment_status,
            fulfillment.digital_status, fulfillment.physical_status,
            count(*) over()::int as total
       from classified c
       join contacts student on student.id = c.student_contact_id
       left join contacts payer on payer.id = c.payer_contact_id
       left join contact_course_records enrollment on enrollment.id = c.enrollment_id
       left join course_class_sections section on section.id = c.class_section_id
       left join lateral (
         select pr.* from payment_requests pr
          where pr.organization_id = c.organization_id and pr.business_unit_id = c.business_unit_id
            and (pr.charge_id = c.id or
              (coalesce(pr.metadata_json #> '{registrationResult,chargeIds}', '[]'::jsonb) ? c.id::text))
          order by pr.created_at desc limit 1
       ) request on true
       left join lateral (
         select pt.* from payment_allocations pa2
         join provider_transactions pt on pt.id = pa2.transaction_id
          where pa2.charge_id = c.id order by pt.created_at desc limit 1
       ) transaction on true
       left join book_fulfillments fulfillment on fulfillment.payment_request_id = request.id
      where c.derived_status = $3
        and ($4 = '' or student.name ilike '%' || $4 || '%' or coalesce(student.email, '') ilike '%' || $4 || '%'
          or coalesce(student.phone, '') ilike '%' || $4 || '%')
      order by case when c.original_due_date is null then 1 else 0 end, c.original_due_date, c.created_at
      limit $5 offset $6`,
    params,
  );
  const countResult = await client.query(
    `${LEDGER_CTE}
     select derived_status, count(*)::int as count from classified
      where derived_status in ('due', 'partially_paid', 'overdue') group by derived_status`,
    [scope.organizationId, scope.businessUnitId],
  );
  const counts = { due: 0, partially_paid: 0, overdue: 0 };
  for (const row of countResult.rows) counts[row.derived_status] = Number(row.count || 0);
  return {
    state,
    page,
    pageSize,
    total: Number(result.rows[0]?.total || 0),
    counts,
    items: result.rows.map(mapCharge),
  };
}

export async function loadCollectionsSetup(client, input = {}) {
  const scope = scoped(input);
  const [sections, recentContacts] = await Promise.all([
    client.query(
      `select id, section_key, course_name, modality, course_location
         from course_class_sections where organization_id = $1 and business_unit_id = $2 and status = 'active'
        order by course_name, section_key`,
      [scope.organizationId, scope.businessUnitId],
    ),
    client.query(
      `select id, name, email, phone from contacts
        where organization_id = $1 and primary_business_unit_id = $2 and archived_at is null
        order by updated_at desc limit 25`,
      [scope.organizationId, scope.businessUnitId],
    ),
  ]);
  return {
    sections: sections.rows.map((row) => ({
      id: row.id,
      sectionKey: row.section_key,
      courseName: row.course_name,
      modality: row.modality,
      courseLocation: row.course_location,
    })),
    contacts: recentContacts.rows,
  };
}

function manualTransactionReference(idempotencyKey) {
  return `manual_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

function manualReceiptNumber(reference) {
  return `REC-MAN-${createHash('sha256').update(reference).digest('hex').slice(0, 12).toUpperCase()}`;
}

async function ensureManualReceipt(client, { scope, charge, transaction, payment, actorUserId, now }) {
  const existingReceiptId = value(transaction, 'receipt_document_id', 'receiptDocumentId');
  if (existingReceiptId) return { id: existingReceiptId, duplicate: true };
  const inserted = await client.query(
    `insert into financial_documents
      (organization_id, business_unit_id, contact_id, document_number, document_type, status,
       subtotal, tax, total, paid_amount, balance_due, issue_date, due_date, items_json, notes)
     values ($1, $2, $3, $4, 'Receipt', 'Paid', $5, 0, $5, $5, 0, $6, $6, $7::jsonb, $8)
     returning id, document_number`,
    [
      scope.organizationId,
      scope.businessUnitId,
      value(charge, 'student_contact_id', 'studentContactId'),
      manualReceiptNumber(value(transaction, 'provider_transaction_id', 'providerTransactionId')),
      centsToMoney(payment.amountCents),
      now.toISOString().slice(0, 10),
      JSON.stringify([{ desc: charge.description, qty: 1, amount: Number(centsToMoney(payment.amountCents)), ledgerTreatment: 'charge' }]),
      `Staff-recorded ${payment.method.replaceAll('_', ' ')} payment${payment.reference ? ` · ${payment.reference}` : ''}.`,
    ],
  );
  await client.query(
    'update provider_transactions set receipt_document_id = $1, updated_at = now() where id = $2',
    [inserted.rows[0].id, transaction.id],
  );
  await client.query(
    `insert into activity_events
      (organization_id, business_unit_id, contact_id, event_type, message, metadata_json, actor_user_id, occurred_at)
     select $1, $2, $3, 'financial.manual_payment_recorded', $4, $5::jsonb, $6, $7
      where not exists (
        select 1 from activity_events where organization_id = $1
          and event_type = 'financial.manual_payment_recorded'
          and metadata_json->>'providerTransactionId' = $8
      )`,
    [
      scope.organizationId,
      scope.businessUnitId,
      value(charge, 'student_contact_id', 'studentContactId'),
      `Recorded ${centsToMoney(payment.amountCents)} ${payment.method.replaceAll('_', ' ')} payment.`,
      JSON.stringify({
        providerTransactionId: value(transaction, 'provider_transaction_id', 'providerTransactionId'),
        chargeId: charge.id,
        receiptDocumentId: inserted.rows[0].id,
        method: payment.method,
        reference: payment.reference,
        note: payment.note,
      }),
      actorUserId,
      now,
      value(transaction, 'provider_transaction_id', 'providerTransactionId'),
    ],
  );
  return { ...inserted.rows[0], duplicate: false };
}

export async function recordManualCollectionPayment(client, input = {}) {
  const scope = scoped(input);
  const payment = normalizeManualPayment(input);
  const now = input.now instanceof Date ? input.now : new Date();
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`manual-collection:${scope.organizationId}:${scope.businessUnitId}:${payment.idempotencyKey}`],
    );
    const chargeResult = await client.query(
      `select sc.*, pr.id as payment_request_id
         from student_charges sc
         left join lateral (
           select id from payment_requests where organization_id = sc.organization_id
             and business_unit_id = sc.business_unit_id and charge_id = sc.id
           order by created_at desc limit 1
         ) pr on true
        where sc.id = $1 and sc.organization_id = $2 and sc.business_unit_id = $3 for update of sc`,
      [payment.chargeId, scope.organizationId, scope.businessUnitId],
    );
    const charge = chargeResult.rows[0];
    if (!charge) throw new CollectionsError('charge_not_found', 'Charge is not available in this division.', 404);
    const providerTransactionId = manualTransactionReference(payment.idempotencyKey);
    const transactionResult = await createProviderTransaction(client, {
      ...scope,
      paymentRequestId: value(charge, 'payment_request_id', 'paymentRequestId'),
      studentContactId: value(charge, 'student_contact_id', 'studentContactId'),
      payerContactId: value(charge, 'payer_contact_id', 'payerContactId'),
      enrollmentId: value(charge, 'enrollment_id', 'enrollmentId'),
      classSectionId: value(charge, 'class_section_id', 'classSectionId'),
      provider: 'manual',
      providerEnvironment: 'staff',
      providerTransactionId,
      merchantReference: providerTransactionId,
      transactionKind: 'payment',
      status: 'verified',
      amount: centsToMoney(payment.amountCents),
      currency: value(charge, 'currency') || 'USD',
      occurredAt: now,
      verifiedAt: now,
      sourceType: 'staff_manual_payment',
      sourceReference: payment.reference,
      idempotencyKey: `manual:transaction:${payment.idempotencyKey}`,
      metadata: { method: payment.method, reference: payment.reference, note: payment.note, actorUserId: input.actorUserId },
    });
    const allocation = await allocateVerifiedPaymentInTransaction(client, {
      ...scope,
      chargeId: charge.id,
      transactionId: transactionResult.record.id,
      amount: centsToMoney(payment.amountCents),
      idempotencyKey: `manual:allocation:${payment.idempotencyKey}`,
      metadata: { method: payment.method, actorUserId: input.actorUserId },
      asOf: now,
    });
    const receipt = await ensureManualReceipt(client, {
      scope,
      charge,
      transaction: transactionResult.record,
      payment,
      actorUserId: input.actorUserId,
      now,
    });
    if (allocation.charge?.status === 'paid' && value(charge, 'payment_request_id', 'paymentRequestId')) {
      await client.query(
        `update payment_requests set status = 'completed', updated_at = now()
          where id = $1 and organization_id = $2 and business_unit_id = $3 and status in ('created', 'pending')`,
        [value(charge, 'payment_request_id', 'paymentRequestId'), scope.organizationId, scope.businessUnitId],
      );
      await activateBookFulfillmentForVerifiedPayment(client, {
        ...scope,
        paymentRequestId: value(charge, 'payment_request_id', 'paymentRequestId'),
        providerTransactionId: transactionResult.record.id,
      });
    }
    await client.query('commit');
    return {
      duplicate: transactionResult.duplicate || allocation.duplicate,
      transactionId: transactionResult.record.id,
      allocationId: allocation.allocation.id,
      receiptDocumentId: receipt.id,
      charge: allocation.charge,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export async function createHostedCollectionLink(client, input = {}) {
  const scope = scoped(input);
  const link = normalizeHostedLinkInput(input);
  const environment = String(input.environment || '').trim().toLowerCase();
  if (!['uat', 'production'].includes(environment)) {
    throw new CollectionsError('provider_environment_invalid', 'Payment provider environment is invalid.');
  }
  await client.query('begin');
  let request;
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`collection-hpp:${scope.organizationId}:${scope.businessUnitId}:${link.paymentRequestId}`],
    );
    const found = await client.query(
      `select pr.*, student.name as student_name, student.email as student_email, student.phone as student_phone
         from payment_requests pr join contacts student on student.id = pr.student_contact_id
        where pr.id = $1 and pr.organization_id = $2 and pr.business_unit_id = $3 for update of pr`,
      [link.paymentRequestId, scope.organizationId, scope.businessUnitId],
    );
    request = found.rows[0];
    if (!request) throw new CollectionsError('payment_request_not_found', 'Payment request is not available in this division.', 404);
    if (value(request, 'status') === 'completed') {
      throw new CollectionsError('payment_request_completed', 'This payment request is already completed.', 409);
    }
    const metadata = json(value(request, 'metadata_json', 'metadataJson'));
    const attempt = metadata.hostedPaymentAttempt;
    if (attempt) {
      throw new CollectionsError(
        'hosted_link_already_attempted',
        attempt.state === 'created'
          ? 'A hosted link was already created. Open it from the original response or create a new payment request.'
          : 'A previous hosted-link attempt may have reached the provider. Review it before creating another request.',
        409,
        { state: attempt.state, correlationId: attempt.correlationId || null },
      );
    }
    const correlationId = `collections:${createHash('sha256').update(link.idempotencyKey).digest('hex').slice(0, 32)}`;
    await client.query(
      `update payment_requests
          set provider = 'dejavoo', provider_environment = $1, status = 'pending',
              metadata_json = coalesce(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = now()
        where id = $3`,
      [environment, JSON.stringify({ hostedPaymentAttempt: { state: 'started', correlationId, startedAt: new Date().toISOString() } }), request.id],
    );
    await client.query('commit');
    request = { ...request, correlationId };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }

  const envPrefix = environment === 'production' ? 'DEJAVOO_PROD' : 'DEJAVOO_UAT';
  const merchantId = String(process.env[`${envPrefix}_CLOUDPOS_TPN`] || '').trim();
  const postAuthHeader = String(process.env[`${envPrefix}_CALLBACK_AUTH_HEADER`] || '').trim();
  const baseUrl = String(input.baseUrl || '').replace(/\/$/, '');
  const adapter = input.adapter || createDejavooAdapter({ environment });
  let result;
  try {
    result = await adapter.createHostedPaymentPage({
      merchantId,
      merchantReference: value(request, 'merchant_reference', 'merchantReference'),
      amountCents: Math.round(Number(value(request, 'requested_amount', 'requestedAmount')) * 100),
      currency: value(request, 'currency') || 'USD',
      correlationId: request.correlationId,
      returnUrl: `${baseUrl}/collections?payment=return`,
      failureUrl: `${baseUrl}/collections?payment=failed`,
      cancelUrl: `${baseUrl}/collections?payment=canceled`,
      postUrl: `${baseUrl}/api/payments/dejavoo/callback`,
      postAuthHeader,
      expiryDays: 1,
      customer: {
        name: value(request, 'student_name', 'studentName'),
        email: value(request, 'student_email', 'studentEmail'),
        mobile: value(request, 'student_phone', 'studentPhone'),
      },
      personalization: {
        merchantName: 'AIT USA Institute',
        description: `AIT USA payment ${value(request, 'merchant_reference', 'merchantReference')}`,
        payNowButtonText: 'Pay securely',
      },
    });
  } catch {
    result = {
      ok: false,
      correlationId: request.correlationId,
      error: { code: 'DEJAVOO_HPP_UNCERTAIN', retryable: false },
    };
  }
  const finalState = result.ok ? 'created' : 'uncertain';
  await client.query('begin');
  try {
    await client.query(
      `update payment_requests
          set provider_request_id = $1, expires_at = case when $2 then now() + interval '1 day' else expires_at end,
              metadata_json = coalesce(metadata_json, '{}'::jsonb) || $3::jsonb, updated_at = now()
        where id = $4 and organization_id = $5 and business_unit_id = $6`,
      [
        result.ok ? result.correlationId : null,
        result.ok,
        JSON.stringify({ hostedPaymentAttempt: {
          state: finalState,
          correlationId: result.correlationId || request.correlationId,
          completedAt: new Date().toISOString(),
          checkout: result.ok ? { origin: result.checkout?.origin || null } : null,
          errorCode: result.ok ? null : result.error?.code || 'DEJAVOO_HPP_UNCERTAIN',
        } }),
        request.id,
        scope.organizationId,
        scope.businessUnitId,
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
  if (!result.ok) {
    throw new CollectionsError(
      result.error?.code || 'hosted_link_failed',
      'The hosted-link attempt did not complete safely. Review provider status before trying again.',
      result.error?.retryable ? 503 : 502,
      { correlationId: result.correlationId || request.correlationId },
    );
  }
  return {
    paymentRequestId: request.id,
    checkoutUrl: result.checkoutUrl,
    checkout: result.checkout,
    correlationId: result.correlationId,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}
