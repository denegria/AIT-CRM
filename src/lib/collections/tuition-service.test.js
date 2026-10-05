import assert from 'node:assert/strict';
import test from 'node:test';
import { createFourWeekTuitionCharge, adjustUnpaidTuitionCharge } from './tuition-service.js';

const scope = { organizationId: 'org-1', businessUnitId: 'ait-usa-1' };
const enrollment = { id: 'enroll-1', contact_id: 'student-1', class_section_id: null, status: 'active', metadata_json: { tuitionPricing: { residenceCountryCode: 'US', billingCountryCode: 'US', pricingVersion: '2026-09-17.v1' } } };
const base = { ...scope, studentContactId: 'student-1', enrollmentId: 'enroll-1', servicePeriodStart: '2026-10-05', idempotencyKey: 'tuition:period:fixture-1', actorUserId: 'admin-1' };

function fakeClient({ enrollmentRow = enrollment, allocated = false, requested = false, charge = null, dateValues = false } = {}) {
  const state = { charge, enrollmentRow, audits: [], writes: [], allocated, requested, calls: [], advisoryKeys: [] };
  return {
    state,
    async query(sql, args = []) {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push(q);
      if (q.startsWith('select pg_advisory_xact_lock')) state.advisoryKeys.push(args[0]);
      if (['begin', 'commit', 'rollback'].includes(q) || q.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (q.startsWith('select * from student_charges where organization_id')) {
        const matched = state.charge && args[0] === scope.organizationId && args[1] === scope.businessUnitId && args[2] === state.charge.enrollment_id && state.charge.service_period_start <= args[3] && state.charge.service_period_end >= args[4];
        return { rows: matched ? [dateValues ? { ...state.charge, service_period_start: new Date(`${state.charge.service_period_start}T00:00:00Z`), service_period_end: new Date(`${state.charge.service_period_end}T00:00:00Z`) } : state.charge] : [] };
      }
      if (q.startsWith('select e.id, e.contact_id')) {
        return { rows: state.enrollmentRow && args[0] === state.enrollmentRow.id && args[1] === scope.organizationId && args[2] === scope.businessUnitId && args[3] === state.enrollmentRow.contact_id ? [state.enrollmentRow] : [] };
      }
      if (q.startsWith('update contact_course_records set metadata_json')) {
        state.enrollmentRow = { ...state.enrollmentRow, metadata_json: { ...state.enrollmentRow.metadata_json, ...JSON.parse(args[0]) } };
        state.writes.push('enrollment_review'); return { rows: [] };
      }
      if (q.startsWith('select id from contacts')) return { rows: args[0] === 'student-1' && args[1] === scope.organizationId && args[2] === scope.businessUnitId ? [{ id: 'student-1' }] : [] };
      if (q.startsWith('insert into student_charges')) {
        state.charge = { id: 'charge-1', organization_id: args[0], business_unit_id: args[1], student_contact_id: args[2], enrollment_id: args[4], charge_type: args[6], description: args[7], amount: args[8], currency: args[9], status: 'due', service_period_start: args[10], service_period_end: args[11], idempotency_key: args[15], metadata_json: JSON.parse(args[16]) };
        state.writes.push('charge'); return { rows: [state.charge] };
      }
      if (q.startsWith('insert into charge_pricing_audit')) { state.audits.push({ charge_id: args[2], old_amount: args[6], new_amount: args[7], reason: args[8], idempotency_key: args[9] }); state.writes.push('audit'); return { rows: [] }; }
      if (q.startsWith('select * from student_charges where id')) return { rows: state.charge && args[0] === state.charge.id && args[1] === scope.organizationId && args[2] === scope.businessUnitId ? [state.charge] : [] };
      if (q.startsWith('select * from charge_pricing_audit')) return { rows: state.audits.filter((row) => row.idempotency_key === args[2]) };
      if (q.startsWith('select exists(select 1 from payment_allocations')) return { rows: [{ has_allocations: state.allocated, has_requests: state.requested }] };
      if (q.startsWith('update student_charges set amount')) {
        state.charge = { ...state.charge, amount: args[0], metadata_json: { ...state.charge.metadata_json, ...JSON.parse(args[1]) } };
        state.writes.push('update'); return { rows: [state.charge] };
      }
      throw new Error(`Unexpected SQL: ${q}`);
    },
  };
}

test('four-week $195 standard charge becomes real $175 charge with immutable audit; replay writes nothing', async () => {
  const client = fakeClient();
  const first = await createFourWeekTuitionCharge(client, { ...base, canOverridePricing: true, finalAmount: '175', reason: 'Scholarship' });
  assert.equal(first.charge.amount, '175.00');
  assert.equal(first.charge.metadata_json.standardAmount, '195.00');
  assert.equal(first.charge.metadata_json.discount, '20.00');
  assert.equal(first.charge.service_period_end, '2026-11-01');
  assert.deepEqual(client.state.writes, ['charge', 'audit']);
  const replay = await createFourWeekTuitionCharge(client, { ...base, canOverridePricing: true, finalAmount: '175', reason: 'Scholarship' });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(client.state.writes, ['charge', 'audit']);
  await assert.rejects(createFourWeekTuitionCharge(client, { ...base, servicePeriodStart: '2026-10-06', idempotencyKey: 'tuition:period:overlap-1' }), (error) => error.code === 'tuition_period_overlap');
  assert.deepEqual(client.state.writes, ['charge', 'audit']);
  await assert.rejects(createFourWeekTuitionCharge(client, { ...base, canOverridePricing: false }), (error) => error.code === 'idempotency_conflict');
  assert.deepEqual(client.state.writes, ['charge', 'audit']);
  assert.equal((await createFourWeekTuitionCharge(client, { ...base, servicePeriodStart: '2026-11-02', idempotencyKey: 'tuition:period:adjacent-1' })).charge.service_period_start, '2026-11-02');
  assert.equal(new Set(client.state.advisoryKeys).size, 1);
});

test('regular coordinator can create standard charge but cannot discount; cross-unit and no-region fail without writes', async () => {
  const regular = fakeClient();
  await createFourWeekTuitionCharge(regular, { ...base, actorUserId: 'coordinator-1', canOverridePricing: false });
  assert.equal(regular.state.charge.amount, '195.00');
  assert.deepEqual(regular.state.writes, ['charge']);
  const restricted = fakeClient();
  await assert.rejects(createFourWeekTuitionCharge(restricted, { ...base, canOverridePricing: false, finalAmount: '175', reason: 'Forged' }), (error) => error.status === 403);
  assert.deepEqual(restricted.state.writes, []);
  const cross = fakeClient();
  await assert.rejects(createFourWeekTuitionCharge(cross, { ...base, businessUnitId: 'other-unit' }), (error) => error.status === 404);
  assert.deepEqual(cross.state.writes, []);
  const noRegion = fakeClient({ enrollmentRow: { ...enrollment, metadata_json: {} } });
  await assert.rejects(createFourWeekTuitionCharge(noRegion, base), (error) => error.code === 'pricing_evidence_missing');
  assert.deepEqual(noRegion.state.writes, []);
  const malformed = fakeClient({ enrollmentRow: { ...enrollment, metadata_json: { tuitionPricing: {} } } });
  await assert.rejects(createFourWeekTuitionCharge(malformed, { ...base, canOverridePricing: true, legacyPricingReview: { residenceCountryCode: 'US', billingCountryCode: 'US', evidence: 'Registrar file 42' } }), (error) => error.code === 'pricing_evidence_invalid');
  assert.deepEqual(malformed.state.writes, []);
});

test('privileged legacy review cites country evidence, persists pricing, and replays without writes', async () => {
  const client = fakeClient({ enrollmentRow: { ...enrollment, metadata_json: {} } });
  const legacyPricingReview = { residenceCountryCode: 'us', billingCountryCode: 'US', evidence: 'Signed 2024 intake form, registrar file 42' };
  const reviewed = await createFourWeekTuitionCharge(client, { ...base, canOverridePricing: true, legacyPricingReview });
  assert.equal(reviewed.charge.amount, '195.00');
  assert.equal(client.state.enrollmentRow.metadata_json.tuitionPricing.review.actorUserId, 'admin-1');
  assert.equal(client.state.enrollmentRow.metadata_json.tuitionPricing.residenceCountryCode, 'US');
  assert.deepEqual(client.state.writes, ['enrollment_review', 'charge', 'audit']);
  assert.match(client.state.audits[0].reason, /Signed 2024 intake form/);
  assert.equal((await createFourWeekTuitionCharge(client, { ...base, canOverridePricing: true, legacyPricingReview })).duplicate, true);
  assert.deepEqual(client.state.writes, ['enrollment_review', 'charge', 'audit']);
  await assert.rejects(createFourWeekTuitionCharge(client, { ...base, idempotencyKey: 'tuition:period:new-attempt', canOverridePricing: true, legacyPricingReview }), (error) => error.code === 'tuition_period_duplicate');
  assert.deepEqual(client.state.writes, ['enrollment_review', 'charge', 'audit']);
  const later = await createFourWeekTuitionCharge(client, { ...base, servicePeriodStart: '2026-11-02', idempotencyKey: 'tuition:period:later-1', canOverridePricing: true });
  assert.equal(later.charge.amount, '195.00');
});

test('legacy review rejects unprivileged, uncited, and conflicting evidence before writes', async () => {
  const legacyPricingReview = { residenceCountryCode: 'US', billingCountryCode: 'US', evidence: 'Registrar record dated 2024-09-01' };
  for (const [review, privileged, code] of [
    [legacyPricingReview, false, 'pricing_review_denied'],
    [{ ...legacyPricingReview, evidence: 'unknown' }, true, 'pricing_review_invalid'],
    [{ ...legacyPricingReview, billingCountryCode: 'MX' }, true, 'pricing_review_invalid'],
  ]) {
    const client = fakeClient({ enrollmentRow: { ...enrollment, metadata_json: {} } });
    await assert.rejects(createFourWeekTuitionCharge(client, { ...base, canOverridePricing: privileged, legacyPricingReview: review }), (error) => error.code === code);
    assert.deepEqual(client.state.writes, []);
  }
});

test('stale review cannot silently bill using another reviewer country decision', async () => {
  const client = fakeClient();
  await assert.rejects(createFourWeekTuitionCharge(client, { ...base, canOverridePricing: true,
    legacyPricingReview: { residenceCountryCode: 'MX', billingCountryCode: 'MX', evidence: 'Prior registrar file 123' } }),
  (error) => error.code === 'pricing_review_stale');
  assert.deepEqual(client.state.writes, []);
});

test('replay recognizes driver date objects for the same period', async () => {
  const client = fakeClient({ dateValues: true });
  await createFourWeekTuitionCharge(client, base);
  assert.equal((await createFourWeekTuitionCharge(client, base)).duplicate, true);
  assert.deepEqual(client.state.writes, ['charge']);
});

test('unpaid charge adjustment locks, checks exposure, updates amount once, and rejects a forged replay', async () => {
  const client = fakeClient();
  await createFourWeekTuitionCharge(client, base);
  const input = { ...scope, chargeId: 'charge-1', finalAmount: '175', reason: 'Aid', idempotencyKey: 'tuition:adjust:fixture-1', actorUserId: 'admin-1', canOverridePricing: true };
  const result = await adjustUnpaidTuitionCharge(client, input);
  assert.equal(result.charge.amount, '175.00');
  assert.equal(client.state.audits[0].old_amount, '195.00');
  const writes = [...client.state.writes];
  assert.equal((await adjustUnpaidTuitionCharge(client, input)).duplicate, true);
  assert.deepEqual(client.state.writes, writes);
  await assert.rejects(adjustUnpaidTuitionCharge(client, { ...input, finalAmount: '170' }), (error) => error.code === 'idempotency_conflict');
});

test('adjustment rejects allocations, requests, paid status and nonprivileged actor without update', async () => {
  for (const condition of [{ allocated: true }, { requested: true }, { charge: { id: 'charge-1', charge_type: 'tuition_four_week', status: 'paid', amount: '195.00', metadata_json: { standardAmount: '195.00' } } }]) {
    const client = fakeClient(condition);
    if (!client.state.charge) await createFourWeekTuitionCharge(client, base);
    const before = [...client.state.writes];
    await assert.rejects(adjustUnpaidTuitionCharge(client, { ...scope, chargeId: 'charge-1', finalAmount: '175', reason: 'Aid', idempotencyKey: 'tuition:adjust:fixture-2', actorUserId: 'admin-1', canOverridePricing: true }));
    assert.deepEqual(client.state.writes, before);
  }
  const regular = fakeClient();
  await assert.rejects(adjustUnpaidTuitionCharge(regular, { ...scope, chargeId: 'charge-1', finalAmount: '175', reason: 'Forge', idempotencyKey: 'tuition:adjust:fixture-3', actorUserId: 'coordinator-1', canOverridePricing: false }), (error) => error.status === 403);
  assert.deepEqual(regular.state.writes, []);
});
