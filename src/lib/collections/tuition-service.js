import { createStudentCharge } from '../billing-ledger/service.js';
import { resolveRegionalPricing, REGIONAL_PRICING_VERSION } from '../registration/catalog.js';
import { CollectionsError, centsToMoney, moneyToCents } from './model.js';

const KEY = /^[A-Za-z0-9._:-]{12,160}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? '').trim();
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : text(value).slice(0, 10);

function period(start) {
  if (!DATE.test(text(start))) throw new CollectionsError('period_invalid', 'Choose a valid four-week service period start.');
  const date = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start) {
    throw new CollectionsError('period_invalid', 'Choose a valid four-week service period start.');
  }
  date.setUTCDate(date.getUTCDate() + 27);
  return { start, end: date.toISOString().slice(0, 10) };
}

function scopeOf(input) {
  const organizationId = text(input.organizationId);
  const businessUnitId = text(input.businessUnitId);
  if (!organizationId || !businessUnitId) throw new CollectionsError('scope_required', 'AIT USA business unit is required.', 403);
  return { organizationId, businessUnitId };
}

function validKey(value) {
  const key = text(value);
  if (!KEY.test(key)) throw new CollectionsError('idempotency_key_invalid', 'A safe idempotency key is required.');
  return key;
}

function priceForEnrollment(enrollment, input) {
  const stored = enrollment.metadata_json?.tuitionPricing;
  if (!stored) {
    const review = input.legacyPricingReview;
    if (!review) throw new CollectionsError('pricing_evidence_missing', 'Enrollment has no verified regional pricing. A senior coordinator or administrator must review its country evidence before billing.', 409);
    if (!input.canOverridePricing || !input.actorUserId) throw new CollectionsError('pricing_review_denied', 'Senior coordinator or administrator access is required to review legacy pricing.', 403);
    const residenceCountryCode = text(review.residenceCountryCode).toUpperCase();
    const billingCountryCode = text(review.billingCountryCode).toUpperCase();
    const evidence = text(review.evidence);
    if (!/^[A-Z]{2}$/.test(residenceCountryCode) || !/^[A-Z]{2}$/.test(billingCountryCode)
      || evidence.length < 10 || evidence.length > 300) {
      throw new CollectionsError('pricing_review_invalid', 'Enter both two-letter country codes and a 10–300 character evidence source.');
    }
    const decision = resolveRegionalPricing({ residenceCountryCode, billingCountryCode });
    if (decision.status !== 'eligible') throw new CollectionsError('pricing_review_invalid', 'The reviewed countries do not resolve to one supported regional rate.', 409);
    return { decision, review: { residenceCountryCode, billingCountryCode, evidence } };
  }
  const decision = resolveRegionalPricing(stored);
  if (decision.status !== 'eligible' || stored.pricingVersion !== REGIONAL_PRICING_VERSION) {
    throw new CollectionsError('pricing_evidence_invalid', 'Enrollment regional pricing needs staff review before billing.', 409);
  }
  if (input.legacyPricingReview && (
    text(input.legacyPricingReview.residenceCountryCode).toUpperCase() !== stored.residenceCountryCode
    || text(input.legacyPricingReview.billingCountryCode).toUpperCase() !== stored.billingCountryCode
  )) throw new CollectionsError('pricing_review_stale', 'Enrollment pricing was reviewed by another staff member. Refresh before billing.', 409);
  return { decision, review: null };
}

function finalPricing(input, standardCents) {
  const requested = input.finalAmount == null || text(input.finalAmount) === ''
    ? standardCents : moneyToCents(input.finalAmount, 'Final amount');
  if (requested > standardCents) throw new CollectionsError('pricing_surcharge_denied', 'Final amount cannot exceed the authoritative standard rate.');
  if (requested < standardCents) {
    if (!input.canOverridePricing || !input.actorUserId) {
      throw new CollectionsError('pricing_override_denied', 'Senior coordinator or administrator access is required to adjust pricing.', 403);
    }
    const reason = text(input.reason);
    if (!reason || reason.length > 500) throw new CollectionsError('pricing_reason_required', 'A reason (up to 500 characters) is required for a discount.');
    return { finalCents: requested, reason };
  }
  if (input.reason || input.finalAmount != null) {
    // Standard payments do not create a false adjustment history.
    if (input.reason) throw new CollectionsError('pricing_discount_required', 'A discount reason requires a reduced final amount.');
  }
  return { finalCents: requested, reason: null };
}

async function writeAudit(client, { scope, chargeId, actorUserId, eventType, standard, oldAmount, newAmount, reason, idempotencyKey }) {
  await client.query(
    `insert into charge_pricing_audit
      (organization_id, business_unit_id, charge_id, actor_user_id, event_type, standard_amount, old_amount, new_amount, reason, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (organization_id, business_unit_id, idempotency_key) do nothing`,
    [scope.organizationId, scope.businessUnitId, chargeId, actorUserId, eventType, standard, oldAmount, newAmount, reason, idempotencyKey],
  );
}

export async function createFourWeekTuitionCharge(client, input = {}) {
  const scope = scopeOf(input);
  const enrollmentId = text(input.enrollmentId);
  const studentContactId = text(input.studentContactId);
  const idempotencyKey = validKey(input.idempotencyKey);
  const servicePeriod = period(input.servicePeriodStart);
  if (!enrollmentId || !studentContactId) throw new CollectionsError('enrollment_required', 'Select a student enrollment before billing.');
  await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`tuition:${scope.organizationId}:${scope.businessUnitId}:${enrollmentId}`]);
    const existing = await client.query(
      `select * from student_charges where organization_id = $1 and business_unit_id = $2
         and enrollment_id = $3 and charge_type = 'tuition_four_week'
         and service_period_start <= $4 and service_period_end >= $5 and status <> 'voided' limit 1`,
      [scope.organizationId, scope.businessUnitId, enrollmentId, servicePeriod.end, servicePeriod.start],
    );
    if (existing.rows[0]) {
      if (dateOnly(existing.rows[0].service_period_start) !== servicePeriod.start
        || dateOnly(existing.rows[0].service_period_end) !== servicePeriod.end) {
        throw new CollectionsError('tuition_period_overlap', 'This enrollment already has a charge overlapping the selected four-week period.', 409);
      }
      if (existing.rows[0].idempotency_key !== idempotencyKey || existing.rows[0].student_contact_id !== studentContactId) {
        throw new CollectionsError('tuition_period_duplicate', 'This enrollment already has a charge for the selected four-week period.', 409);
      }
      const standardCents = moneyToCents(existing.rows[0].metadata_json?.standardAmount, 'Standard amount');
      const pricing = finalPricing(input, standardCents);
      if (moneyToCents(existing.rows[0].amount) !== pricing.finalCents
        || text(existing.rows[0].metadata_json?.pricingAdjustment?.reason) !== text(pricing.reason)) {
        throw new CollectionsError('idempotency_conflict', 'This charge key was already used for a different final amount or reason.', 409);
      }
      await client.query('commit');
      return { duplicate: true, charge: existing.rows[0] };
    }
    const found = await client.query(
      `select e.id, e.contact_id, e.class_section_id, e.status, e.metadata_json
         from contact_course_records e join contacts c on c.id = e.contact_id
        where e.id = $1 and e.organization_id = $2 and e.business_unit_id = $3
          and e.contact_id = $4 and c.organization_id = $2 and c.primary_business_unit_id = $3
          and c.archived_at is null limit 1 for update of e`,
      [enrollmentId, scope.organizationId, scope.businessUnitId, studentContactId],
    );
    const enrollment = found.rows[0];
    if (!enrollment) throw new CollectionsError('enrollment_not_found', 'Enrollment is not available for this student in AIT USA.', 404);
    if (enrollment.status !== 'active') throw new CollectionsError('enrollment_inactive', 'Only an active enrollment can receive a four-week tuition charge.', 409);
    const { decision: regional, review } = priceForEnrollment(enrollment, input);
    const standardCents = regional.tuitionRateCents;
    const pricing = finalPricing(input, standardCents);
    const metadata = {
      pricingVersion: regional.pricingVersion,
      region: regional.region,
      standardAmount: centsToMoney(standardCents),
      discount: centsToMoney(standardCents - pricing.finalCents),
      ...(review ? { legacyPricingReview: { ...review, actorUserId: input.actorUserId } } : {}),
      ...(pricing.reason ? { pricingAdjustment: { reason: pricing.reason, actorUserId: input.actorUserId } } : {}),
    };
    if (review) {
      await client.query(
        `update contact_course_records set metadata_json = metadata_json || $1::jsonb, updated_at = now()
          where id = $2 and organization_id = $3 and business_unit_id = $4`,
        [JSON.stringify({ tuitionPricing: { residenceCountryCode: review.residenceCountryCode,
          billingCountryCode: review.billingCountryCode, pricingVersion: regional.pricingVersion,
          review: { evidence: review.evidence, actorUserId: input.actorUserId, reviewedAt: new Date().toISOString() } } }),
        enrollmentId, scope.organizationId, scope.businessUnitId],
      );
    }
    const created = await createStudentCharge(client, {
      ...scope, studentContactId, enrollmentId,
      classSectionId: enrollment.class_section_id,
      chargeType: 'tuition_four_week',
      description: `Four-week tuition · ${servicePeriod.start}–${servicePeriod.end}`,
      amount: centsToMoney(pricing.finalCents), currency: 'USD',
      servicePeriodStart: servicePeriod.start, servicePeriodEnd: servicePeriod.end,
      originalDueDate: servicePeriod.start, sourceType: 'staff_tuition', sourceReference: 'payments-workspace',
      idempotencyKey, metadata,
    });
    if (created.duplicate) throw new CollectionsError('idempotency_conflict', 'This request key was already used for a different charge.', 409);
    if (review) await writeAudit(client, {
      scope, chargeId: created.record.id, actorUserId: input.actorUserId, eventType: 'created',
      standard: metadata.standardAmount, oldAmount: null, newAmount: created.record.amount,
      reason: `Legacy regional pricing reviewed: ${review.evidence}`, idempotencyKey: `tuition:review:${idempotencyKey}`,
    });
    if (pricing.reason) await writeAudit(client, {
      scope, chargeId: created.record.id, actorUserId: input.actorUserId, eventType: 'created',
      standard: metadata.standardAmount, oldAmount: null, newAmount: created.record.amount,
      reason: pricing.reason, idempotencyKey: `tuition:create:${idempotencyKey}`,
    });
    await client.query('commit');
    return { duplicate: false, charge: created.record };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    if (error.code === '23505') throw new CollectionsError('tuition_period_duplicate', 'This enrollment already has a charge for this four-week period.', 409);
    throw error;
  }
}

export async function adjustUnpaidTuitionCharge(client, input = {}) {
  const scope = scopeOf(input);
  const chargeId = text(input.chargeId);
  const idempotencyKey = validKey(input.idempotencyKey);
  if (!chargeId || !input.actorUserId || !input.canOverridePricing) {
    throw new CollectionsError('pricing_override_denied', 'Senior coordinator or administrator access is required to adjust tuition.', 403);
  }
  await client.query('begin');
  try {
    const result = await client.query(
      `select * from student_charges where id = $1 and organization_id = $2 and business_unit_id = $3 for update`,
      [chargeId, scope.organizationId, scope.businessUnitId],
    );
    const charge = result.rows[0];
    if (!charge || charge.charge_type !== 'tuition_four_week') throw new CollectionsError('charge_not_found', 'Four-week tuition charge is not available in this division.', 404);
    const auditKey = `tuition:adjust:${idempotencyKey}`;
    const replay = await client.query(
      `select * from charge_pricing_audit where organization_id = $1 and business_unit_id = $2 and idempotency_key = $3 limit 1`,
      [scope.organizationId, scope.businessUnitId, auditKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].charge_id !== chargeId
        || moneyToCents(replay.rows[0].new_amount) !== moneyToCents(input.finalAmount)
        || replay.rows[0].reason !== text(input.reason)) {
        throw new CollectionsError('idempotency_conflict', 'This adjustment key was already used for a different amount.', 409);
      }
      await client.query('commit');
      return { duplicate: true, charge, audit: replay.rows[0] };
    }
    if (!['due', 'overdue'].includes(charge.status)) throw new CollectionsError('charge_not_adjustable', 'Only an unpaid, open tuition charge can be adjusted.', 409);
    const exposure = await client.query(
      `select exists(select 1 from payment_allocations where charge_id = $1 and organization_id = $2 and business_unit_id = $3) as has_allocations,
              exists(select 1 from payment_requests where charge_id = $1 and organization_id = $2 and business_unit_id = $3) as has_requests`,
      [chargeId, scope.organizationId, scope.businessUnitId],
    );
    if (exposure.rows[0]?.has_allocations || exposure.rows[0]?.has_requests) {
      throw new CollectionsError('charge_payment_started', 'This charge has a payment or link history. Cancel/reconcile it before creating a new charge; its amount cannot be changed.', 409);
    }
    const standardCents = moneyToCents(charge.metadata_json?.standardAmount, 'Standard amount');
    const newCents = moneyToCents(input.finalAmount, 'Final amount');
    const oldCents = moneyToCents(charge.amount, 'Current charge amount');
    if (newCents >= oldCents || newCents > standardCents) throw new CollectionsError('pricing_discount_required', 'Final amount must be below the current charge and no greater than standard.');
    const reason = text(input.reason);
    if (!reason || reason.length > 500) throw new CollectionsError('pricing_reason_required', 'A reason (up to 500 characters) is required for a discount.');
    const updated = await client.query(
      `update student_charges set amount = $1, metadata_json = metadata_json || $2::jsonb, updated_at = now()
        where id = $3 and organization_id = $4 and business_unit_id = $5 returning *`,
      [centsToMoney(newCents), JSON.stringify({ discount: centsToMoney(standardCents - newCents), pricingAdjustment: { reason, actorUserId: input.actorUserId } }), chargeId, scope.organizationId, scope.businessUnitId],
    );
    await writeAudit(client, {
      scope, chargeId, actorUserId: input.actorUserId, eventType: 'adjusted',
      standard: centsToMoney(standardCents), oldAmount: charge.amount, newAmount: centsToMoney(newCents),
      reason, idempotencyKey: auditKey,
    });
    await client.query('commit');
    return { duplicate: false, charge: updated.rows[0] };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
