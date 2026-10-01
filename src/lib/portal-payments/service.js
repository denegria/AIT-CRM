import { createHash, timingSafeEqual } from 'node:crypto';

import { createPaymentRequest } from '../billing-ledger/service.js';
import { createHostedCollectionLink } from '../collections/service.js';
import {
  centsToMoney,
  cleanPortalIdentity,
  moneyToCents,
  normalizePortalPaymentIntent,
  PortalPaymentsError,
  portalPaymentState,
} from './model.js';

function clean(value) { return String(value || '').trim(); }

export function verifyPortalPaymentsSecret(received, expected) {
  const left = Buffer.from(clean(received));
  const right = Buffer.from(clean(expected));
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}

export async function resolvePortalStudent(client, scope, identityInput) {
  const identity = cleanPortalIdentity(identityInput);
  const result = await client.query(
    `select id, name, email
       from contacts
      where organization_id = $1 and primary_business_unit_id = $2
        and archived_at is null and lower(email) = $3
      order by id limit 2`,
    [scope.organizationId, scope.businessUnitId, identity.email],
  );
  if (result.rows.length !== 1) {
    throw new PortalPaymentsError(
      result.rows.length ? 'portal_identity_review_required' : 'portal_billing_not_linked',
      result.rows.length ? 'Portal billing identity requires staff review.' : 'Portal billing is not linked yet.',
      409,
    );
  }
  return { ...result.rows[0], portalAccountId: identity.accountId };
}

const LEDGER_SQL = `
with charge_ledger as (
  select sc.*,
         coalesce(sum(case when pt.transaction_kind = 'refund' then -pa.amount else pa.amount end)
           filter (where pt.status = 'verified'), 0)::numeric(12,2) as applied_amount
    from student_charges sc
    left join payment_allocations pa on pa.charge_id = sc.id
    left join provider_transactions pt on pt.id = pa.transaction_id
   where sc.organization_id = $1 and sc.business_unit_id = $2 and sc.student_contact_id = $3
     and sc.status not in ('waived', 'voided', 'refunded')
   group by sc.id
), classified as (
  select *, greatest(amount - applied_amount, 0)::numeric(12,2) as remaining_amount,
    case when amount - applied_amount <= 0 then 'paid'
      when original_due_date is not null and original_due_date < current_date then 'overdue'
      when applied_amount > 0 then 'partially_paid' else 'due' end as derived_status
  from charge_ledger
)
select * from classified order by
  case when derived_status = 'paid' then 1 else 0 end,
  case when original_due_date is null then 1 else 0 end,
  original_due_date, created_at`;

function dateAfter(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function mapCharge(row) {
  return {
    id: row.id,
    type: row.charge_type,
    description: row.description,
    originalAmount: String(row.amount),
    appliedAmount: String(row.applied_amount),
    remainingAmount: String(row.remaining_amount),
    currency: row.currency,
    state: row.derived_status,
    servicePeriodStart: row.service_period_start,
    servicePeriodEnd: row.service_period_end,
    upcomingPeriodStart: dateAfter(row.service_period_end),
    originalDueDate: row.original_due_date,
  };
}

export async function loadPortalPaymentsSnapshot(client, scope, identityInput) {
  const student = await resolvePortalStudent(client, scope, identityInput);
  const charges = await client.query(LEDGER_SQL, [scope.organizationId, scope.businessUnitId, student.id]);
  const credit = await client.query(
    `select coalesce(sum(case when pt.transaction_kind = 'refund' then -pt.amount else pt.amount end), 0)
              - coalesce(sum(alloc.allocated), 0) as unapplied
       from provider_transactions pt
       left join lateral (
         select coalesce(sum(pa.amount), 0) as allocated from payment_allocations pa
          where pa.transaction_id = pt.id
       ) alloc on true
      where pt.organization_id = $1 and pt.business_unit_id = $2 and pt.student_contact_id = $3
        and pt.status = 'verified'`,
    [scope.organizationId, scope.businessUnitId, student.id],
  );
  const receipts = await client.query(
    `select distinct fd.id, fd.document_number, fd.issue_date, fd.total, fd.paid_amount, pt.currency
       from provider_transactions pt
       join financial_documents fd on fd.id = pt.receipt_document_id
      where pt.organization_id = $1 and pt.business_unit_id = $2 and pt.student_contact_id = $3
        and pt.status = 'verified' and fd.status = 'Paid'
      order by fd.issue_date desc, fd.id desc limit 24`,
    [scope.organizationId, scope.businessUnitId, student.id],
  );
  const requests = await client.query(
    `select pr.id, pr.charge_id, pr.requested_amount, pr.currency, pr.status as request_status,
            pr.expires_at, pt.status as transaction_status, pt.verified_at, pt.receipt_document_id
       from payment_requests pr
       left join lateral (
         select status, verified_at, receipt_document_id from provider_transactions
          where payment_request_id = pr.id and organization_id = pr.organization_id
          order by created_at desc limit 1
       ) pt on true
      where pr.organization_id = $1 and pr.business_unit_id = $2 and pr.student_contact_id = $3
        and pr.source_type = 'portal_payment'
      order by pr.created_at desc limit 12`,
    [scope.organizationId, scope.businessUnitId, student.id],
  );
  const unappliedCents = Math.max(0, moneyToCents(credit.rows[0]?.unapplied || '0'));
  return {
    student: { name: student.name, email: student.email },
    charges: charges.rows.map(mapCharge),
    unappliedCredit: { amount: centsToMoney(unappliedCents), currency: 'USD' },
    receipts: receipts.rows.map((row) => ({
      id: row.id,
      number: row.document_number,
      issueDate: row.issue_date,
      total: String(row.total || row.paid_amount || '0.00'),
      currency: row.currency || 'USD',
    })),
    paymentRequests: requests.rows.map((row) => ({
      id: row.id,
      chargeId: row.charge_id,
      amount: String(row.requested_amount),
      currency: row.currency,
      state: portalPaymentState(row),
      verifiedAt: row.verified_at || null,
      receiptAvailable: Boolean(row.receipt_document_id),
    })),
  };
}

export async function createPortalPaymentRequest(client, scope, identityInput, intentInput) {
  const student = await resolvePortalStudent(client, scope, identityInput);
  const intent = normalizePortalPaymentIntent(intentInput);
  await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `portal-payment:${scope.organizationId}:${student.id}:${intent.idempotencyKey}`,
    ]);
    const chargeResult = await client.query(
      `select * from student_charges
        where id = $1 and organization_id = $2 and business_unit_id = $3 and student_contact_id = $4
          and status not in ('waived', 'voided', 'refunded')
        for update`,
      [intent.chargeId, scope.organizationId, scope.businessUnitId, student.id],
    );
    const charge = chargeResult.rows[0];
    if (!charge) throw new PortalPaymentsError('charge_not_found', 'Charge is not available for this account.', 404);
    const allocated = await client.query(
      `select coalesce(sum(case when pt.transaction_kind = 'refund' then -pa.amount else pa.amount end), 0)::numeric(12,2) as applied_amount
         from payment_allocations pa
         join provider_transactions pt on pt.id = pa.transaction_id
        where pa.charge_id = $1 and pa.organization_id = $2 and pa.business_unit_id = $3
          and pt.status = 'verified'`,
      [charge.id, scope.organizationId, scope.businessUnitId],
    );
    const remainingCents = Math.max(0, moneyToCents(charge.amount) - moneyToCents(allocated.rows[0]?.applied_amount || '0'));
    if (intent.amountCents > remainingCents) {
      throw new PortalPaymentsError('amount_exceeds_balance', 'Payment cannot exceed the remaining balance.', 409, {
        remainingAmount: centsToMoney(remainingCents),
      });
    }
    const merchantReference = `portal_${createHash('sha256').update(`${student.portalAccountId}:${intent.idempotencyKey}`).digest('hex').slice(0, 28)}`;
    const request = await createPaymentRequest(client, {
      ...scope,
      studentContactId: student.id,
      payerContactId: student.id,
      enrollmentId: charge.enrollment_id,
      classSectionId: charge.class_section_id,
      chargeId: charge.id,
      requestedAmount: centsToMoney(intent.amountCents),
      currency: charge.currency,
      status: 'created',
      merchantReference,
      sourceType: 'portal_payment',
      sourceReference: student.portalAccountId,
      idempotencyKey: `portal:request:${intent.idempotencyKey}`,
      metadata: { portalAccountId: student.portalAccountId, chargeId: charge.id },
    });
    await client.query('commit');
    return {
      duplicate: request.duplicate,
      paymentRequestId: request.record.id,
      amount: String(request.record.requested_amount ?? request.record.requestedAmount),
      currency: request.record.currency,
      state: 'created',
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export async function createPortalHostedLink(client, scope, identityInput, input = {}) {
  const student = await resolvePortalStudent(client, scope, identityInput);
  const owned = await client.query(
    `select id from payment_requests where id = $1 and organization_id = $2 and business_unit_id = $3
      and student_contact_id = $4 and source_type = 'portal_payment' limit 1`,
    [clean(input.paymentRequestId), scope.organizationId, scope.businessUnitId, student.id],
  );
  if (!owned.rows[0]) throw new PortalPaymentsError('payment_request_not_found', 'Payment request is not available for this account.', 404);
  return createHostedCollectionLink(client, {
    ...scope,
    paymentRequestId: input.paymentRequestId,
    idempotencyKey: input.idempotencyKey,
    environment: input.environment,
    baseUrl: input.baseUrl,
    customerUrls: input.customerUrls,
    requiredSourceType: 'portal_payment',
    adapter: input.adapter,
  });
}

export async function loadPortalPaymentStatus(client, scope, identityInput, paymentRequestId) {
  const student = await resolvePortalStudent(client, scope, identityInput);
  const result = await client.query(
    `select pr.id, pr.requested_amount, pr.currency, pr.status as request_status, pr.expires_at,
            pt.status as transaction_status, pt.verified_at, pt.receipt_document_id
       from payment_requests pr
       left join lateral (
         select status, verified_at, receipt_document_id from provider_transactions
          where payment_request_id = pr.id and organization_id = pr.organization_id
          order by created_at desc limit 1
       ) pt on true
      where pr.id = $1 and pr.organization_id = $2 and pr.business_unit_id = $3
        and pr.student_contact_id = $4 and pr.source_type = 'portal_payment' limit 1`,
    [clean(paymentRequestId), scope.organizationId, scope.businessUnitId, student.id],
  );
  const row = result.rows[0];
  if (!row) throw new PortalPaymentsError('payment_request_not_found', 'Payment request is not available for this account.', 404);
  return {
    paymentRequestId: row.id,
    state: portalPaymentState(row),
    amount: String(row.requested_amount),
    currency: row.currency,
    verifiedAt: row.verified_at || null,
    receiptAvailable: Boolean(row.receipt_document_id),
  };
}

export function createPreviewPortalPaymentsAdapter({ siteOrigin, returnState }) {
  const origin = new URL(siteOrigin).origin;
  return {
    async createHostedPaymentPage(input) {
      return {
        ok: true,
        correlationId: input.correlationId,
        checkoutUrl: `${origin}/portal/payments/?payment=return&state=${encodeURIComponent(returnState)}&provider=preview`,
        checkout: { origin },
      };
    },
  };
}
