import assert from 'node:assert/strict';
import test from 'node:test';
import { createFourWeekTuitionCharge, adjustUnpaidTuitionCharge } from './tuition-service.js';

const scope = { organizationId: 'org-1', businessUnitId: 'ait-usa-1' };
const enrollment = { id: 'enroll-1', contact_id: 'student-1', class_section_id: null, status: 'active', metadata_json: { tuitionPricing: { residenceCountryCode: 'US', billingCountryCode: 'US', pricingVersion: '2026-09-17.v1' } } };
const base = { ...scope, studentContactId: 'student-1', enrollmentId: 'enroll-1', servicePeriodStart: '2026-10-05', idempotencyKey: 'tuition:period:fixture-1', actorUserId: 'admin-1' };

function fakeClient({ enrollmentRow = enrollment, allocated = false, requested = false, charge = null } = {}) {
  const state = { charge, audits: [], writes: [], allocated, requested, calls: [] };
  return {
    state,
    async query(sql, args = []) {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push(q);
      if (['begin', 'commit', 'rollback'].includes(q) || q.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
      if (q.startsWith('select * from student_charges where organization_id')) {
        return { rows: state.charge && args[0] === scope.organizationId && args[1] === scope.businessUnitId && args[2] === state.charge.enrollment_id && args[3] === state.charge.service_period_start ? [state.charge] : [] };
      }
      if (q.startsWith('select e.id, e.contact_id')) {
        return { rows: enrollmentRow && args[0] === enrollmentRow.id && args[1] === scope.organizationId && args[2] === scope.businessUnitId && args[3] === enrollmentRow.contact_id ? [enrollmentRow] : [] };
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
  await assert.rejects(createFourWeekTuitionCharge(client, { ...base, canOverridePricing: false }), (error) => error.code === 'idempotency_conflict');
  assert.deepEqual(client.state.writes, ['charge', 'audit']);
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
