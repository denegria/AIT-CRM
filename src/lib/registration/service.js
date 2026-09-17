import { createHash } from 'node:crypto';

import {
  createPaymentRequest,
  createStudentCharge,
} from '../billing-ledger/service.js';

const PROGRAMS = Object.freeze({
  english_program: Object.freeze({ code: 'english_program', courseName: 'English Program' }),
});

function required(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new Error(`${name} is required.`);
  return clean;
}

function moneyFromCents(cents) {
  return (cents / 100).toFixed(2);
}

function json(value) {
  return JSON.stringify(value || {});
}

export function registrationRecordKeys(scope, idempotencyKey) {
  const root = `registration:${required(idempotencyKey, 'idempotencyKey')}`;
  const digest = createHash('sha256')
    .update(`${scope.organizationId}:${scope.businessUnitId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
  return Object.freeze({
    root,
    enrollment: `${root}:enrollment`,
    paymentRequest: `${root}:payment-request`,
    merchantReference: `AITUSA-REG-${digest}`,
    charge: (lineCode) => `${root}:charge:${lineCode}`,
  });
}

export async function loadRegistrationReplay(client, scope, idempotencyKey) {
  const keys = registrationRecordKeys(scope, idempotencyKey);
  const result = await client.query(
    `select * from payment_requests
      where organization_id = $1 and business_unit_id = $2 and idempotency_key = $3
      limit 1`,
    [scope.organizationId, scope.businessUnitId, keys.paymentRequest],
  );
  if (!result.rows[0]) return null;
  const record = result.rows[0];
  const metadata = record.metadata_json ?? record.metadataJson ?? {};
  return {
    status: 'payment_request_created',
    duplicate: true,
    ...metadata.registrationResult,
    paymentRequest: record,
  };
}

export async function createRegistrationContact(client, scope, identity, role) {
  const result = await client.query(
    `insert into contacts
      (organization_id, primary_business_unit_id, name, phone, email, source_label)
     values ($1, $2, $3, nullif($4, ''), nullif($5, ''), $6)
     returning id, organization_id, primary_business_unit_id, name, phone, email`,
    [
      scope.organizationId,
      scope.businessUnitId,
      identity.name,
      identity.phone,
      identity.email,
      role === 'student' ? 'AIT USA Registration' : 'AIT USA Registration Payer',
    ],
  );
  return result.rows[0];
}

export async function assignContactToRegistrationScope(client, scope, contactId) {
  const result = await client.query(
    `select id, organization_id, primary_business_unit_id, archived_at
       from contacts
      where id = $1 and organization_id = $2
      for update`,
    [contactId, scope.organizationId],
  );
  const contact = result.rows[0];
  if (!contact || contact.archived_at) throw new Error('Contact is not available for registration.');
  const businessUnitId = contact.primary_business_unit_id ?? contact.primaryBusinessUnitId ?? null;
  if (businessUnitId && businessUnitId !== scope.businessUnitId) {
    throw new Error('Contact is outside the requested business unit.');
  }
  if (!businessUnitId) {
    await client.query(
      `update contacts set primary_business_unit_id = $1, updated_at = now()
        where id = $2 and organization_id = $3 and primary_business_unit_id is null`,
      [scope.businessUnitId, contactId, scope.organizationId],
    );
  }
  return { ...contact, id: contact.id, primary_business_unit_id: scope.businessUnitId };
}

async function resolveProgramAndSection(client, scope, programCode, classSectionId) {
  const program = PROGRAMS[programCode];
  if (!program) throw new Error('Registration program is not supported.');
  if (!classSectionId) return { program, section: null };
  const result = await client.query(
    `select id, course_name, status
       from course_class_sections
      where id = $1 and organization_id = $2 and business_unit_id = $3
      limit 1`,
    [classSectionId, scope.organizationId, scope.businessUnitId],
  );
  const section = result.rows[0];
  if (!section || section.status !== 'active') throw new Error('Class section is not available for registration.');
  return { program, section };
}

async function createPlannedEnrollment(client, input) {
  const result = await client.query(
    `insert into contact_course_records
      (organization_id, business_unit_id, contact_id, class_section_id, course_name, status, metadata_json)
     values ($1, $2, $3, $4, $5, 'planned', $6::jsonb)
     returning *`,
    [
      input.scope.organizationId,
      input.scope.businessUnitId,
      input.studentContactId,
      input.section?.id || null,
      input.section?.course_name || input.program.courseName,
      json({
        registrationIdempotencyKey: input.idempotencyKey,
        registrationState: 'payment_pending',
        placementState: 'not_started',
        sectionState: input.section ? 'assigned' : 'pending',
        sourceReference: input.sourceReference,
      }),
    ],
  );
  return result.rows[0];
}

export async function persistRegistrationBundle(client, input) {
  const scope = {
    organizationId: required(input.organizationId, 'organizationId'),
    businessUnitId: required(input.businessUnitId, 'businessUnitId'),
  };
  const keys = registrationRecordKeys(scope, input.idempotencyKey);
  const { program, section } = await resolveProgramAndSection(
    client,
    scope,
    input.programCode,
    input.classSectionId,
  );
  const enrollment = await createPlannedEnrollment(client, {
    scope,
    program,
    section,
    studentContactId: input.studentContactId,
    idempotencyKey: keys.enrollment,
    sourceReference: input.sourceReference,
  });

  const charges = [];
  for (const line of input.quote.lines.filter((entry) => entry.ledgerTreatment === 'charge')) {
    const created = await createStudentCharge(client, {
      ...scope,
      studentContactId: input.studentContactId,
      payerContactId: input.payerContactId,
      enrollmentId: enrollment.id,
      classSectionId: section?.id || null,
      chargeType: line.chargeType,
      description: line.label,
      amount: line.amount,
      currency: input.quote.currency,
      sourceType: 'registration',
      sourceReference: input.sourceReference,
      idempotencyKey: keys.charge(line.code),
      metadata: {
        catalogVersion: input.quote.catalogVersion,
        pricingVersion: input.quote.pricingVersion,
        catalogItemCode: line.code,
        taxable: line.taxable,
      },
    });
    charges.push(created.record);
  }

  const allocationPlan = [
    ...charges.map((charge, index) => ({
      treatment: 'charge',
      chargeId: charge.id,
      itemCode: input.quote.lines.filter((entry) => entry.ledgerTreatment === 'charge')[index].code,
      amount: charge.amount,
    })),
    ...input.quote.lines
      .filter((entry) => entry.ledgerTreatment === 'unapplied_credit')
      .map((line) => ({ treatment: 'unapplied_credit', chargeId: null, itemCode: line.code, amount: line.amount })),
  ];
  const states = Object.freeze({
    registration: 'payment_pending',
    placement: 'not_started',
    section: section ? 'assigned' : 'pending',
  });
  const registrationResult = {
    studentContactId: input.studentContactId,
    payerContactId: input.payerContactId,
    enrollmentId: enrollment.id,
    classSectionId: section?.id || null,
    chargeIds: charges.map((charge) => charge.id),
    quote: input.quote,
    allocationPlan,
    states,
  };
  const singleChargeOnly = charges.length === 1
    && allocationPlan.every((entry) => entry.treatment === 'charge');
  const paymentRequest = await createPaymentRequest(client, {
    ...scope,
    studentContactId: input.studentContactId,
    payerContactId: input.payerContactId,
    enrollmentId: enrollment.id,
    classSectionId: section?.id || null,
    chargeId: singleChargeOnly ? charges[0].id : null,
    requestedAmount: moneyFromCents(input.quote.totalCents),
    currency: input.quote.currency,
    status: 'created',
    merchantReference: keys.merchantReference,
    sourceType: 'registration',
    sourceReference: input.sourceReference,
    idempotencyKey: keys.paymentRequest,
    metadata: {
      registrationCatalogVersion: input.quote.catalogVersion,
      regionalPricingVersion: input.quote.pricingVersion,
      registrationResult,
    },
  });
  return {
    status: 'payment_request_created',
    duplicate: false,
    ...registrationResult,
    paymentRequest: paymentRequest.record,
  };
}
