import assert from 'node:assert/strict';
import pg from 'pg';
import {
  manifestContentSha256,
  signRosterManifestApproval,
  validateRosterManifestApproval,
} from '../src/lib/roster-import/manifest.js';
import { buildRosterImportPlan } from '../src/lib/roster-import/planner.js';
import { applyRosterImportPlan, loadRosterImportSnapshot } from '../src/lib/roster-import/postgres.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. This verifier always rolls back.');

const now = new Date();
const secret = 'mis-322-verifier-secret';
const suffix = crypto.randomUUID();
const manifest = {
  schemaVersion: 1,
  manifestId: `mis-322-verification-${suffix}`,
  lane: 'inactive',
  generatedAt: now.toISOString(),
  approvalState: 'held',
  sourceWorkbook: { filename: 'synthetic-verifier.xlsx', sha256: 'a'.repeat(64) },
  sourceProductionFingerprint: { neonBranchId: 'verification', businessUnitName: 'AIT USA' },
  sequence: { afterLane: null, attendanceSupported: false },
  expectedCounts: { contacts: 1, resolvedContacts: 1, deferredContacts: 0, courses: 1 },
  contactActions: [{
    idempotencyKey: `mis-318:inactive:contact:${suffix}`,
    candidate_id: suffix,
    identity_key: `verification:${suffix}`,
    student_name: 'MIS 322 Verification Student',
    primary_phone: '(908) 555-0198',
    historical_phone_options: '(908) 555-0197',
    final_contact_action: 'create_new_contact',
    planned_contact_reference: `planned:verification:${suffix}`,
    active_roster_overlap: 'no',
  }],
  classSectionActions: [],
  courseActions: [{
    idempotencyKey: `mis-318:inactive:course:${suffix}`,
    proposed_course_action: 'insert_dropped_course_after_approval',
    planned_contact_reference: `planned:verification:${suffix}`,
    mapped_course: 'Computer',
    course_status: 'dropped',
    start_date: '2025-01-01',
    end_date: '2025-02-01',
    outcome_reason: 'Verification only',
    source_sheet: 'Verifier',
    source_cell: 'A2',
  }],
};
manifest.contentSha256 = manifestContentSha256(manifest);
const approval = {
  manifestId: manifest.manifestId,
  manifestSha256: manifest.contentSha256,
  approvedAt: new Date(now.getTime() - 60_000).toISOString(),
  expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  approvalRef: 'MIS-322 rollback verifier',
};
approval.signature = signRosterManifestApproval(approval, secret);
validateRosterManifestApproval(manifest, approval, secret, { now });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  const organization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-322 verification ${suffix}`, `mis-322-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const unit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT USA', 'Division'],
  );
  const scope = { organizationId, businessUnitId: unit.rows[0].id, businessUnitName: 'AIT USA' };

  const firstSnapshot = await loadRosterImportSnapshot(client, scope);
  const firstPlan = buildRosterImportPlan(manifest, firstSnapshot, { now });
  assert.equal(firstPlan.approvalEligible, true);
  const firstApply = await applyRosterImportPlan(client, {
    scope,
    manifest,
    approval,
    plan: firstPlan,
    manageTransaction: false,
  });
  assert.equal(firstApply.replay, false);

  const secondSnapshot = await loadRosterImportSnapshot(client, scope);
  const secondPlan = buildRosterImportPlan(manifest, secondSnapshot, { now });
  assert.equal(secondPlan.contactActions[0].operation, 'replay');
  assert.equal(secondPlan.courseActions[0].operation, 'replay');
  const secondApply = await applyRosterImportPlan(client, {
    scope,
    manifest,
    approval,
    plan: secondPlan,
    manageTransaction: false,
  });
  assert.equal(secondApply.replay, true);

  const counts = await client.query(
    `select
       (select count(*)::int from contacts where organization_id = $1) as contacts,
       (select count(*)::int from contact_phone_numbers where organization_id = $1) as phones,
       (select count(*)::int from contact_course_records where organization_id = $1) as courses,
       (select count(*)::int from roster_import_runs where organization_id = $1) as runs,
       (select count(*)::int from roster_import_actions where organization_id = $1 and status = 'applied') as actions`,
    [organizationId],
  );
  assert.deepEqual(counts.rows[0], { contacts: 1, phones: 2, courses: 1, runs: 1, actions: 2 });
  console.log(JSON.stringify({
    status: 'passed',
    firstApply: 'completed',
    replay: 'no-op',
    contacts: 1,
    phoneHistoryRows: 2,
    courseRecords: 1,
    appliedActions: 2,
    transaction: 'rolled_back',
  }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
