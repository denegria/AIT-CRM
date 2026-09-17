import assert from 'node:assert/strict';
import test from 'node:test';

import { RegistrationActionError, orchestrateRegistration } from './action.js';
import { REGISTRATION_ITEM_CODES } from './catalog.js';

function normalizedPhone(value) {
  return String(value || '').replace(/[^0-9+]/g, '');
}

function fakeRegistrationClient(seed = {}) {
  const state = {
    contacts: [...(seed.contacts || [])],
    enrollments: [],
    charges: [],
    requests: [],
    sections: [...(seed.sections || [])],
    calls: [],
    next: 1,
  };
  return {
    state,
    async query(sql, parameters = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: statement, parameters });
      if (['begin', 'commit', 'rollback'].includes(statement)) return { rows: [] };
      if (statement.startsWith('select pg_advisory_xact_lock')) return { rows: [{}] };
      if (statement.startsWith('select * from payment_requests')) {
        return { rows: state.requests.filter((row) => (
          row.organization_id === parameters[0]
          && row.business_unit_id === parameters[1]
          && row.idempotency_key === parameters[2]
        )).slice(0, 1) };
      }
      if (statement.startsWith('select id, name, label, is_active from business_units')) {
        if (seed.businessUnit === null) return { rows: [] };
        return { rows: [seed.businessUnit || {
          id: parameters[0],
          name: 'AIT USA Institute',
          label: 'Divisions',
          is_active: true,
        }] };
      }
      if (statement.includes('lower(email) = $2')) {
        return { rows: state.contacts.filter((row) => (
          row.organization_id === parameters[0]
          && String(row.email || '').toLowerCase() === parameters[1]
        )).map(({ id }) => ({ id })).sort((a, b) => a.id.localeCompare(b.id)) };
      }
      if (statement.includes("regexp_replace(coalesce(phone, ''), '[^0-9+]'")) {
        return { rows: state.contacts.filter((row) => (
          row.organization_id === parameters[0]
          && normalizedPhone(row.phone) === parameters[1]
        )).map(({ id }) => ({ id })).sort((a, b) => a.id.localeCompare(b.id)) };
      }
      if (statement.startsWith('select id, organization_id, primary_business_unit_id, archived_at from contacts')) {
        return { rows: state.contacts.filter((row) => row.id === parameters[0] && row.organization_id === parameters[1]).slice(0, 1) };
      }
      if (statement.startsWith('update contacts set primary_business_unit_id')) {
        const contact = state.contacts.find((row) => row.id === parameters[1] && row.organization_id === parameters[2]);
        if (contact && !contact.primary_business_unit_id) contact.primary_business_unit_id = parameters[0];
        return { rows: [] };
      }
      if (statement.startsWith('insert into contacts')) {
        const row = {
          id: `contact-${state.next++}`,
          organization_id: parameters[0],
          primary_business_unit_id: parameters[1],
          name: parameters[2],
          phone: parameters[3] || null,
          email: parameters[4] || null,
        };
        state.contacts.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('select id, course_name, status from course_class_sections')) {
        return { rows: state.sections.filter((row) => (
          row.id === parameters[0]
          && row.organization_id === parameters[1]
          && row.business_unit_id === parameters[2]
        )).slice(0, 1) };
      }
      if (statement.startsWith('insert into contact_course_records')) {
        const row = {
          id: `enrollment-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          contact_id: parameters[2],
          class_section_id: parameters[3],
          course_name: parameters[4],
          status: 'planned',
          metadata_json: JSON.parse(parameters[5]),
        };
        state.enrollments.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('select id from contacts')) {
        const match = state.contacts.find((row) => (
          row.id === parameters[0]
          && row.organization_id === parameters[1]
          && row.primary_business_unit_id === parameters[2]
        ));
        return { rows: match ? [{ id: match.id }] : [] };
      }
      if (statement.startsWith('insert into student_charges')) {
        const row = {
          id: `charge-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          student_contact_id: parameters[2],
          payer_contact_id: parameters[3],
          enrollment_id: parameters[4],
          class_section_id: parameters[5],
          charge_type: parameters[6],
          description: parameters[7],
          amount: parameters[8],
          currency: parameters[9],
          idempotency_key: parameters[15],
          metadata_json: JSON.parse(parameters[16]),
        };
        state.charges.push(row);
        return { rows: [row] };
      }
      if (statement.startsWith('insert into payment_requests')) {
        const row = {
          id: `request-${state.next++}`,
          organization_id: parameters[0],
          business_unit_id: parameters[1],
          student_contact_id: parameters[2],
          payer_contact_id: parameters[3],
          enrollment_id: parameters[4],
          class_section_id: parameters[5],
          charge_id: parameters[6],
          requested_amount: parameters[7],
          currency: parameters[8],
          status: parameters[9],
          merchant_reference: parameters[13],
          source_type: parameters[15],
          source_reference: parameters[16],
          idempotency_key: parameters[17],
          metadata_json: JSON.parse(parameters[18]),
        };
        state.requests.push(row);
        return { rows: [row] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
}

const publicRequest = {
  organizationId: 'org-1',
  businessUnitId: 'bu-usa',
  idempotencyKey: 'registration:public:0001',
  sourceReference: 'public-form-0001',
  channel: 'public',
  residenceCountryCode: 'MX',
  student: { name: 'Ana Student', email: 'ana@example.com', phone: '+52 55 1000 2000' },
};

test('guest registration creates one contact, planned enrollment, charge, and fixed payment request', async () => {
  const client = fakeRegistrationClient();
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    requestedAmount: '0.01',
    browserPrice: '0.01',
  });
  assert.equal(result.status, 'payment_request_created');
  assert.equal(result.duplicate, false);
  assert.equal(result.quote.total, '95.00');
  assert.equal(result.paymentRequest.requested_amount, '95.00');
  assert.deepEqual(result.states, { registration: 'payment_pending', placement: 'not_started', section: 'pending' });
  assert.equal(client.state.contacts.length, 1);
  assert.equal(client.state.enrollments.length, 1);
  assert.equal(client.state.enrollments[0].status, 'planned');
  assert.equal(client.state.charges.length, 1);
  assert.equal(client.state.requests.length, 1);
});

test('repeated idempotency key returns the original registration without duplicate records', async () => {
  const client = fakeRegistrationClient();
  const first = await orchestrateRegistration(client, publicRequest);
  const second = await orchestrateRegistration(client, {
    ...publicRequest,
    student: { name: 'Changed Name', email: 'changed@example.com' },
    requestedAmount: '9999.00',
  });
  assert.equal(first.paymentRequest.id, second.paymentRequest.id);
  assert.equal(second.duplicate, true);
  assert.equal(second.studentContactId, first.studentContactId);
  assert.equal(second.quote.total, '95.00');
  assert.equal(client.state.contacts.length, 1);
  assert.equal(client.state.enrollments.length, 1);
  assert.equal(client.state.charges.length, 1);
  assert.equal(client.state.requests.length, 1);
});

test('tuition prepayment stays unapplied while registration charge remains allocatable', async () => {
  const client = fakeRegistrationClient();
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    idempotencyKey: 'registration:public:0002',
    includeTuitionPrepayment: true,
  });
  assert.equal(result.quote.total, '240.00');
  assert.equal(result.charges?.length, undefined);
  assert.equal(result.chargeIds.length, 1);
  assert.deepEqual(result.allocationPlan.map((entry) => entry.treatment), ['charge', 'unapplied_credit']);
  assert.equal(result.allocationPlan[1].amount, '145.00');
  assert.equal(result.allocationPlan[1].chargeId, null);
  assert.equal(result.paymentRequest.charge_id, null);
});

test('verified portal contact is reused and a separate payer does not own the enrollment', async () => {
  const client = fakeRegistrationClient({
    contacts: [{
      id: 'student-existing',
      organization_id: 'org-1',
      primary_business_unit_id: 'bu-usa',
      email: 'student@example.com',
      phone: null,
      archived_at: null,
    }],
  });
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    idempotencyKey: 'registration:public:0003',
    actor: {
      portalAccountId: 'portal-student-1',
      verifiedCrmContactIds: ['student-existing'],
    },
    student: {
      contactId: 'student-existing',
    },
    payer: { name: 'Pat Payer', email: 'payer@example.com' },
  });
  assert.equal(result.studentContactId, 'student-existing');
  assert.notEqual(result.payerContactId, result.studentContactId);
  assert.equal(client.state.enrollments[0].contact_id, 'student-existing');
  assert.equal(client.state.contacts.length, 2);
});

test('ambiguous contact evidence fails closed and rolls back before registration records', async () => {
  const client = fakeRegistrationClient({
    contacts: [
      { id: 'contact-a', organization_id: 'org-1', primary_business_unit_id: 'bu-usa', email: 'duplicate@example.com' },
      { id: 'contact-b', organization_id: 'org-1', primary_business_unit_id: 'bu-usa', email: 'duplicate@example.com' },
    ],
  });
  await assert.rejects(
    () => orchestrateRegistration(client, {
      ...publicRequest,
      idempotencyKey: 'registration:public:0004',
      student: { name: 'Duplicate', email: 'duplicate@example.com' },
    }),
    (error) => error instanceof RegistrationActionError
      && error.code === 'identity_review_required'
      && error.status === 409,
  );
  assert.equal(client.state.enrollments.length, 0);
  assert.equal(client.state.charges.length, 0);
  assert.equal(client.state.requests.length, 0);
  assert.equal(client.state.calls.at(-1).sql, 'rollback');
});

test('verified portal contact from another business unit fails closed', async () => {
  const client = fakeRegistrationClient({
    contacts: [{
      id: 'contact-signs',
      organization_id: 'org-1',
      primary_business_unit_id: 'bu-signs',
      email: 'signs@example.com',
      archived_at: null,
    }],
  });
  await assert.rejects(
    () => orchestrateRegistration(client, {
      ...publicRequest,
      idempotencyKey: 'registration:public:0007',
      actor: { verifiedCrmContactIds: ['contact-signs'] },
      student: { contactId: 'contact-signs' },
    }),
    (error) => error instanceof RegistrationActionError
      && error.code === 'contact_scope_conflict'
      && error.status === 409,
  );
  assert.equal(client.state.enrollments.length, 0);
  assert.equal(client.state.calls.at(-1).sql, 'rollback');
});

test('active class section produces assigned section state without starting placement', async () => {
  const client = fakeRegistrationClient({
    sections: [{
      id: 'section-1',
      organization_id: 'org-1',
      business_unit_id: 'bu-usa',
      course_name: 'English 2',
      status: 'active',
    }],
  });
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    idempotencyKey: 'registration:public:0008',
    classSectionId: 'section-1',
  });
  assert.equal(result.classSectionId, 'section-1');
  assert.deepEqual(result.states, { registration: 'payment_pending', placement: 'not_started', section: 'assigned' });
  assert.equal(client.state.enrollments[0].course_name, 'English 2');
  assert.equal(client.state.enrollments[0].status, 'planned');
});

test('unsupported country returns advisor handling without opening a transaction', async () => {
  const client = fakeRegistrationClient();
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    idempotencyKey: 'registration:public:0005',
    residenceCountryCode: 'BR',
  });
  assert.equal(result.status, 'advisor_required');
  assert.equal(result.reason, 'unsupported_pricing_country');
  assert.equal(result.wroteRecords, false);
  assert.equal(client.state.calls.length, 0);
});

test('staff-only items require explicit permission and persist separate charges', async () => {
  const client = fakeRegistrationClient();
  const result = await orchestrateRegistration(client, {
    ...publicRequest,
    idempotencyKey: 'registration:staff:0001',
    sourceReference: 'staff-checkout-0001',
    channel: 'staff',
    actor: { canManageRegistrations: true, businessUnitIds: ['bu-usa'] },
    itemCodes: [REGISTRATION_ITEM_CODES.REGISTRATION_ONLY, REGISTRATION_ITEM_CODES.BOOK_ONLY],
  });
  assert.equal(result.quote.total, '110.00');
  assert.equal(result.chargeIds.length, 2);
  assert.equal(result.paymentRequest.charge_id, null);
});

test('registration fails closed when the scoped business unit is not AIT USA', async () => {
  const client = fakeRegistrationClient({
    businessUnit: { id: 'bu-usa', name: 'AIT Signs', label: 'Divisions', is_active: true },
  });
  await assert.rejects(
    () => orchestrateRegistration(client, {
      ...publicRequest,
      idempotencyKey: 'registration:public:0006',
    }),
    (error) => error instanceof RegistrationActionError
      && error.code === 'business_unit_not_eligible'
      && error.status === 403,
  );
  assert.equal(client.state.contacts.length, 0);
  assert.equal(client.state.calls.at(-1).sql, 'rollback');
});
