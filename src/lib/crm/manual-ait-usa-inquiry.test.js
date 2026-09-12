import assert from 'node:assert/strict';
import test from 'node:test';
import { manualAitUsaRequestFingerprint, submitManualAitUsaInquiry } from './manual-ait-usa-inquiry.js';
import { issueManualAitUsaConfirmation } from './manual-ait-usa-confirmation.js';

const ids = Object.freeze({ organization: 'org-1', businessUnit: 'bu-1', user: 'user-1', contact: 'contact-1', lead: 'lead-1' });
const contactValues = Object.freeze({ primaryBusinessUnitId: ids.businessUnit, name: 'Ana Student', email: 'ANA@example.com', phone: '(555) 010-1000', address: null, sourceLabel: 'Walk-in' });
const leadValues = Object.freeze({ sourceType: 'manual', sourceName: 'Walk-in', status: 'New Lead', currentStage: 'New Lead', assignedUserId: null, programInterest: 'English' });

function poolFor(query) {
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql: String(sql), values });
          return query(String(sql), values);
        },
        release() {},
      };
    },
  };
}

function baseArgs(pool, overrides = {}) {
  return {
    pool,
    organizationId: ids.organization,
    businessUnitId: ids.businessUnit,
    actorUserId: ids.user,
    contactValues,
    leadValues,
    idempotencyKey: 'request-00000001',
    authorizeExistingContact: async () => true,
    ...overrides,
  };
}

test('manual AIT USA entry locks replay and shared inbound identity keys before atomically inserting Contact then inquiry', async () => {
  const pool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [] };
    if (sql.includes('lower(email)')) return { rows: [] };
    if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [] };
    if (sql.startsWith('insert into contacts')) return { rows: [{ id: ids.contact, organization_id: ids.organization, primary_business_unit_id: ids.businessUnit, name: 'Ana Student', email: 'ana@example.com', phone: '5550101000' }] };
    if (sql.startsWith('insert into leads')) return { rows: [{ id: ids.lead, organization_id: ids.organization, business_unit_id: ids.businessUnit, contact_id: ids.contact, source_type: 'manual', source_name: 'Walk-in', status: 'New Lead', current_stage: 'New Lead' }] };
    return { rows: [] };
  });

  const result = await submitManualAitUsaInquiry(baseArgs(pool));

  assert.equal(result.outcome, 'created');
  assert.equal(result.createdContact, true);
  const locks = pool.calls.filter((call) => call.sql.includes('pg_advisory_xact_lock')).map((call) => call.values[0]);
  assert.deepEqual(locks, [
    'manual-ait-usa-inquiry:org-1:request-00000001',
    'aitusa-crm-contact:org-1:email:ana@example.com',
    'aitusa-crm-contact:org-1:phone:5550101000',
    'ait-usa-opportunity:org-1:bu-1:contact-1',
  ]);
  assert.ok(pool.calls.findIndex((call) => call.sql.startsWith('insert into contacts')) < pool.calls.findIndex((call) => call.sql.startsWith('insert into leads')));
  assert.equal(pool.calls.some((call) => call.sql.startsWith('insert into activity_events')), true);
});

test('inaccessible exact identity returns the generic review path without inserts or identity details', async () => {
  const pool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [] };
    if (sql.includes('lower(email)')) return { rows: [{ id: ids.contact }] };
    if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [] };
    if (sql.startsWith('select * from contacts')) return { rows: [{ id: ids.contact, organization_id: ids.organization, primary_business_unit_id: ids.businessUnit, name: 'Private Existing Contact' }] };
    if (sql.startsWith('select * from leads')) return { rows: [] };
    return { rows: [] };
  });

  const result = await submitManualAitUsaInquiry(baseArgs(pool, { authorizeExistingContact: async () => false }));

  assert.deepEqual(result, { outcome: 'review_required', error: 'This inquiry needs review before it can be added.' });
  assert.equal(pool.calls.some((call) => /^insert into (contacts|leads)/.test(call.sql)), false);
  assert.equal(JSON.stringify(result).includes('Private Existing Contact'), false);
});

test('a valid confirmation proof never creates a second active inquiry', async () => {
  const pool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [] };
    if (sql.includes('lower(email)')) return { rows: [{ id: ids.contact }] };
    if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [] };
    if (sql.startsWith('select * from contacts')) return { rows: [{ id: ids.contact, organization_id: ids.organization, primary_business_unit_id: ids.businessUnit, name: 'Accessible Contact' }] };
    if (sql.startsWith('select * from leads')) return { rows: [{ id: ids.lead, organization_id: ids.organization, business_unit_id: ids.businessUnit, contact_id: ids.contact, status: 'Follow Up', current_stage: 'Follow Up' }] };
    return { rows: [] };
  });

  const confirmationEnv = { CRM_MANUAL_CONFIRMATION_SECRET: 'test-confirmation-secret' };
  const confirmationProof = issueManualAitUsaConfirmation({
    organizationId: ids.organization, businessUnitId: ids.businessUnit, actorUserId: ids.user, contactId: ids.contact, contactValues,
  }, confirmationEnv);
  const result = await submitManualAitUsaInquiry(baseArgs(pool, { confirmationProof, confirmationEnv }));

  assert.equal(result.outcome, 'active_conflict');
  assert.equal(pool.calls.some((call) => call.sql.startsWith('insert into leads')), false);
});

test('manual entry rejects missing or oversized idempotency keys before any database write', async () => {
  for (const idempotencyKey of ['', 'x'.repeat(129)]) {
    const pool = poolFor(() => ({ rows: [] }));
    await assert.rejects(
      submitManualAitUsaInquiry(baseArgs(pool, { idempotencyKey })),
      (error) => error.status === 400 && /idempotency key/.test(error.message),
    );
    assert.equal(pool.calls.length, 0);
  }
});

test('manual entry serializes the exact Contact opportunity scope before re-querying active inquiries', async () => {
  const pool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [] };
    if (sql.includes('lower(email)')) return { rows: [{ id: ids.contact }] };
    if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [] };
    if (sql.startsWith('select * from contacts')) return { rows: [{ id: ids.contact, organization_id: ids.organization, name: 'Accessible Contact' }] };
    if (sql.startsWith('select * from leads')) return { rows: [{ id: ids.lead, organization_id: ids.organization, business_unit_id: ids.businessUnit, contact_id: ids.contact, status: 'Follow Up' }] };
    return { rows: [] };
  });
  const result = await submitManualAitUsaInquiry(baseArgs(pool));
  assert.equal(result.outcome, 'confirmation_required');
  const locks = pool.calls.filter((call) => call.sql.includes('pg_advisory_xact_lock')).map((call) => call.values[0]);
  assert.equal(locks.at(-1), `ait-usa-opportunity:${ids.organization}:${ids.businessUnit}:${ids.contact}`);
});

test('same idempotency key replays only the original request fingerprint', async () => {
  const fingerprint = manualAitUsaRequestFingerprint({
    organizationId: ids.organization, businessUnitId: ids.businessUnit, actorUserId: ids.user, contactValues, leadValues,
  });
  const pool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [{ contact_id: ids.contact, lead_id: ids.lead, metadata_json: { manual_ait_usa_inquiry_fingerprint: fingerprint } }] };
    if (sql.startsWith('select * from contacts')) return { rows: [{ id: ids.contact, organization_id: ids.organization, name: 'Ana Student' }] };
    if (sql.startsWith('select * from leads')) return { rows: [{ id: ids.lead, organization_id: ids.organization, business_unit_id: ids.businessUnit, contact_id: ids.contact, status: 'New Lead' }] };
    return { rows: [] };
  });
  const replayed = await submitManualAitUsaInquiry(baseArgs(pool));
  assert.equal(replayed.outcome, 'replayed');

  const changedPool = poolFor((sql) => {
    if (sql.includes("metadata_json->>'manual_ait_usa")) return { rows: [{ contact_id: ids.contact, lead_id: ids.lead, metadata_json: { manual_ait_usa_inquiry_fingerprint: fingerprint } }] };
    return { rows: [] };
  });
  const changed = await submitManualAitUsaInquiry(baseArgs(changedPool, { leadValues: { ...leadValues, programInterest: 'HVAC' } }));
  assert.deepEqual(changed, { outcome: 'idempotency_conflict', error: 'This idempotency key was already used for a different inquiry.' });
  assert.equal(changedPool.calls.some((call) => /^insert into (contacts|leads)/.test(call.sql)), false);
});
