import assert from 'node:assert/strict';
import test from 'node:test';
import { manifestContentSha256 } from './manifest.js';
import { buildRosterImportPlan } from './planner.js';

function inactiveManifest(overrides = {}) {
  const value = {
    schemaVersion: 1,
    manifestId: 'mis-318-inactive-test-v1',
    lane: 'inactive',
    generatedAt: '2026-07-16T20:00:00Z',
    approvalState: 'held',
    sequence: { afterLane: null, attendanceSupported: false },
    expectedCounts: { contacts: 1, resolvedContacts: 1, deferredContacts: 0, courses: 1 },
    contactActions: [{
      idempotencyKey: 'mis-318:inactive:contact:a',
      candidate_id: 'candidate-a',
      student_name: 'Maria Student',
      primary_phone: '908-555-0100',
      primary_phone_policy: 'inactive_workbook_authoritative',
      phone_history_policy: 'preserve_all_other_valid_numbers',
      historical_phone_options: '908-555-0199',
      final_contact_action: 'reuse_existing_contact_exact',
      target_contact_id: '11111111-1111-4111-8111-111111111111',
      planned_contact_reference: '11111111-1111-4111-8111-111111111111',
      active_roster_overlap: 'yes',
      proposed_lifecycle_action: 'preserve_newer_or_active_lifecycle',
      location: 'Bound Brook',
    }],
    classSectionActions: [],
    courseActions: [{
      idempotencyKey: 'mis-318:inactive:course:a',
      proposed_course_action: 'insert_dropped_course_after_approval',
      planned_contact_reference: '11111111-1111-4111-8111-111111111111',
      mapped_course: 'English 1',
      course_status: 'dropped',
      start_date: '2025-01-01',
      end_date: '2025-02-01',
    }],
    ...overrides,
  };
  value.contentSha256 = manifestContentSha256(value);
  return value;
}

test('dry-run preserves newer lifecycle and plans historical course without mutating input', () => {
  const manifest = inactiveManifest();
  const plan = buildRosterImportPlan(manifest, {
    contacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Maria Student', phone: '9085550199', address: 'Plainfield' }],
    latestLeadStatusByContact: { '11111111-1111-4111-8111-111111111111': 'Enrolled' },
  }, { now: new Date('2026-07-17T00:00:00Z') });

  assert.equal(plan.approvalEligible, true);
  assert.equal(plan.contactActions[0].operation, 'reuse_contact');
  assert.equal(plan.contactActions[0].primaryPhonePolicy, 'inactive_workbook_authoritative');
  assert.equal(plan.contactActions[0].phoneHistoryPolicy, 'preserve_all_other_valid_numbers');
  assert.equal(plan.contactActions[0].primaryPhoneOperation, 'replace_primary_preserve_previous');
  assert.equal(plan.contactActions[0].lifecycle.operation, 'preserve');
  assert.equal(plan.contactActions[0].location.operation, 'set_manifest_location');
  assert.equal(plan.contactActions[0].location.desiredLocation, 'Bound Brook');
  assert.equal(plan.courseActions[0].operation, 'insert_course_record');
  assert.equal(manifest.contactActions[0].primary_phone, '908-555-0100');
});

test('inactive manifest lifecycle protection is authoritative for nonterminal CRM statuses', () => {
  const manifest = inactiveManifest({
    contactActions: [{
      ...inactiveManifest().contactActions[0],
      active_roster_overlap: 'no',
      proposed_lifecycle_action: 'preserve_newer_or_active_lifecycle',
    }],
  });
  const plan = buildRosterImportPlan(manifest, {
    contacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Maria Student', phone: '9085550100', address: 'Bound Brook' }],
    latestLeadStatusByContact: { '11111111-1111-4111-8111-111111111111': 'Retargeting' },
  }, { now: new Date('2026-07-17T00:00:00Z') });

  assert.equal(plan.contactActions[0].lifecycle.operation, 'preserve');
  assert.equal(plan.contactActions[0].lifecycle.liveStatus, 'Retargeting');
});

test('dry-run blocks malformed structured course dates before apply', () => {
  const value = inactiveManifest({
    courseActions: [{
      ...inactiveManifest().courseActions[0],
      start_date: 'PROSPECTO',
      raw_start_date: 'PROSPECTO',
    }],
  });
  const plan = buildRosterImportPlan(value, {
    contacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Maria Student', phone: '9085550100' }],
  }, { now: new Date('2026-07-17T00:00:00Z') });

  assert.equal(plan.approvalEligible, false);
  assert.equal(plan.courseActions[0].state, 'error');
  assert.match(plan.courseActions[0].reason, /non-ISO structured date/);
});

test('inactive manifest rejects an ambiguous primary-phone policy', () => {
  const value = inactiveManifest({
    contactActions: [{
      ...inactiveManifest().contactActions[0],
      primary_phone_policy: 'preserve_crm_primary',
    }],
  });
  assert.throws(
    () => buildRosterImportPlan(value, {}, { now: new Date('2026-07-17T00:00:00Z') }),
    /workbook phone as authoritative primary/,
  );
});

test('multiple active enrollment locations remain on course records instead of flattening Contact location', () => {
  const manifest = inactiveManifest({
    lane: 'active',
    sequence: { afterLane: 'inactive', attendanceSupported: false, requiredPriorManifestSha256: 'a'.repeat(64) },
    expectedCounts: { contacts: 1, enrollments: 0, classSections: 0 },
    contactActions: [{
      ...inactiveManifest().contactActions[0],
      idempotencyKey: 'mis-318:active:contact:a',
      locations: 'Bound Brook; Plainfield',
      location: undefined,
    }],
    courseActions: [],
  });
  const plan = buildRosterImportPlan(manifest, {
    contacts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Maria Student', phone: '9085550100', address: 'Plainfield' }],
    completedManifestShas: ['a'.repeat(64)],
  }, { now: new Date('2026-07-17T00:00:00Z') });

  assert.equal(plan.approvalEligible, true);
  assert.equal(plan.contactActions[0].location.operation, 'preserve');
  assert.deepEqual(plan.contactActions[0].location.desiredLocations, ['Bound Brook', 'Plainfield']);
});

test('dry-run converts a newly arrived exact identity into reuse and skips replays', () => {
  const manifest = inactiveManifest({
    contactActions: [{
      idempotencyKey: 'mis-318:inactive:contact:new',
      candidate_id: 'new',
      identity_key: 'maria|9085550100',
      student_name: 'María Student',
      primary_phone: '(908) 555-0100',
      primary_phone_policy: 'inactive_workbook_authoritative',
      phone_history_policy: 'preserve_all_other_valid_numbers',
      final_contact_action: 'create_new_contact',
      planned_contact_reference: 'planned:maria',
    }],
    courseActions: [{
      idempotencyKey: 'mis-318:inactive:course:new',
      proposed_course_action: 'insert_dropped_course_after_approval',
      planned_contact_reference: 'planned:maria',
      mapped_course: 'Computer',
      course_status: 'dropped',
    }],
  });
  const plan = buildRosterImportPlan(manifest, {
    contacts: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Maria Student', phone: '9085550100' }],
    appliedActionKeys: ['mis-318:inactive:course:new'],
  }, { now: new Date('2026-07-17T00:00:00Z') });
  assert.equal(plan.contactActions[0].targetContactId, '22222222-2222-4222-8222-222222222222');
  assert.equal(plan.contactActions[0].operation, 'reuse_contact');
  assert.equal(plan.courseActions[0].operation, 'replay');
});

test('contact merge is routed through the approved relationship service', () => {
  const manifest = inactiveManifest();
  manifest.contactActions[0].duplicate_contact_ids = '22222222-2222-4222-8222-222222222222';
  manifest.contentSha256 = manifestContentSha256(manifest);
  const plan = buildRosterImportPlan(manifest, {
    contacts: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Maria Student', phone: '9085550100' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Maria Student', phone: '9085550100' },
    ],
  }, { now: new Date('2026-07-17T00:00:00Z') });
  assert.equal(plan.approvalEligible, true);
  assert.equal(plan.contactActions[0].state, 'ready');
  assert.equal(plan.contactActions[0].operation, 'merge_contacts');
});

test('active lane refuses to proceed before the exact inactive manifest hash completed', () => {
  const value = inactiveManifest({
    manifestId: 'mis-318-active-test-v1',
    lane: 'active',
    sequence: { afterLane: 'inactive', attendanceSupported: false, requiredPriorManifestSha256: 'a'.repeat(64) },
    expectedCounts: { contacts: 0, enrollments: 0, classSections: 0 },
    contactActions: [],
    courseActions: [],
  });
  const plan = buildRosterImportPlan(value, {}, { now: new Date('2026-07-17T00:00:00Z') });
  assert.equal(plan.approvalEligible, false);
  assert.equal(plan.sequenceErrors.length, 1);
});
