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
  expectedCounts: { contacts: 2, resolvedContacts: 2, deferredContacts: 0, courses: 2 },
  contactActions: [
    {
      idempotencyKey: `mis-318:inactive:contact:${suffix}`,
      candidate_id: suffix,
      identity_key: `verification:${suffix}`,
      student_name: 'MIS 322 Verification Student',
      primary_phone: '(908) 555-0198',
      historical_phone_options: '(908) 555-0197',
      final_contact_action: 'create_new_contact',
      planned_contact_reference: `planned:verification:${suffix}`,
      proposed_lifecycle_action: 'create_dropped_quit_lead_after_approval',
      active_roster_overlap: 'no',
      location: 'Bound Brook',
    },
    {
      idempotencyKey: `mis-318:inactive:contact:protected:${suffix}`,
      candidate_id: `protected-${suffix}`,
      identity_key: `verification:protected:${suffix}`,
      student_name: 'MIS 322 Protected Student',
      primary_phone: '(908) 555-0196',
      final_contact_action: 'reuse_existing_contact_exact',
      target_contact_id: 'REPLACED_AFTER_FIXTURE_INSERT',
      planned_contact_reference: 'REPLACED_AFTER_FIXTURE_INSERT',
      proposed_lifecycle_action: 'preserve_newer_or_active_lifecycle',
      active_roster_overlap: 'no',
      location: 'Plainfield',
    },
  ],
  classSectionActions: [],
  courseActions: [
    {
      idempotencyKey: `mis-318:inactive:course:${suffix}`,
      proposed_course_action: 'insert_dropped_course_after_approval',
      planned_contact_reference: `planned:verification:${suffix}`,
      mapped_course: 'Computer',
      course_status: 'dropped',
      location: 'Bound Brook',
      start_date: '2025-01-01',
      end_date: '2025-02-01',
      outcome_reason: 'Verification only',
      source_sheet: 'Verifier',
      source_cell: 'A2',
    },
    {
      idempotencyKey: `mis-318:inactive:course:protected:${suffix}`,
      proposed_course_action: 'insert_dropped_course_after_approval',
      planned_contact_reference: 'REPLACED_AFTER_FIXTURE_INSERT',
      mapped_course: 'Math',
      course_status: 'dropped',
      location: 'Plainfield',
      start_date: '2025-03-01',
      end_date: '2025-04-01',
      outcome_reason: 'Verification only',
      source_sheet: 'Verifier',
      source_cell: 'B2',
    },
  ],
};

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
  const protectedContact = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name, phone, address, source_label)
     values ($1, $2, 'MIS 322 Protected Student', '+19085550196', null, 'Existing CRM source') returning id`,
    [organizationId, scope.businessUnitId],
  );
  const protectedContactId = protectedContact.rows[0].id;
  await client.query(
    `insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage)
     values ($1, $2, $3, 'website', 'Existing website lead', 'Retargeting', 'Retargeting')`,
    [organizationId, scope.businessUnitId, protectedContactId],
  );
  for (const action of manifest.contactActions) {
    if (action.target_contact_id === 'REPLACED_AFTER_FIXTURE_INSERT') {
      action.target_contact_id = protectedContactId;
      action.planned_contact_reference = protectedContactId;
    }
  }
  for (const action of manifest.courseActions) {
    if (action.planned_contact_reference === 'REPLACED_AFTER_FIXTURE_INSERT') action.planned_contact_reference = protectedContactId;
  }
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
       (select count(*)::int from contact_course_records where organization_id = $1 and status = 'dropped') as dropped_courses,
       (select count(*)::int from contact_course_records where organization_id = $1 and class_section_id is null) as historical_courses_without_sections,
       (select count(*)::int from contact_course_records where organization_id = $1 and course_location in ('Bound Brook', 'Plainfield')) as located_courses,
       (select status from leads where contact_id = $2 order by updated_at desc limit 1) as protected_lifecycle,
       (select address from contacts where id = $2) as protected_location,
       (select address from contacts where organization_id = $1 and name = 'MIS 322 Verification Student') as created_location,
       (select count(*)::int from roster_import_runs where organization_id = $1) as runs,
       (select count(*)::int from roster_import_actions where organization_id = $1 and status = 'applied') as actions`,
    [organizationId, protectedContactId],
  );
  assert.deepEqual(counts.rows[0], {
    contacts: 2,
    phones: 3,
    courses: 2,
    dropped_courses: 2,
    historical_courses_without_sections: 2,
    located_courses: 2,
    protected_lifecycle: 'Retargeting',
    protected_location: 'Plainfield',
    created_location: 'Bound Brook',
    runs: 1,
    actions: 4,
  });
  console.log(JSON.stringify({
    status: 'passed',
    firstApply: 'completed',
    replay: 'no-op',
    contacts: 2,
    phoneHistoryRows: 3,
    courseRecords: 2,
    protectedLifecycle: 'Retargeting',
    contactLocations: ['Bound Brook', 'Plainfield'],
    inactiveClassSections: null,
    appliedActions: 4,
    transaction: 'rolled_back',
  }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
