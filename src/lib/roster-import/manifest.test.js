import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deterministicImportUuid,
  manifestContentSha256,
  signRosterManifestApproval,
  validateRosterManifest,
  validateRosterManifestApproval,
} from './manifest.js';

function manifest(overrides = {}) {
  const value = {
    schemaVersion: 1,
    manifestId: 'mis-318-inactive-test-v1',
    lane: 'inactive',
    generatedAt: '2026-07-16T20:00:00.000Z',
    approvalState: 'held',
    sequence: { afterLane: null, attendanceSupported: false },
    expectedCounts: { contacts: 1, resolvedContacts: 1, deferredContacts: 0, courses: 1 },
    contactActions: [{ idempotencyKey: 'mis-318:inactive:contact:a', final_contact_action: 'create_new_contact' }],
    classSectionActions: [],
    courseActions: [{ idempotencyKey: 'mis-318:inactive:course:a', proposed_course_action: 'insert_dropped_course_after_approval' }],
    ...overrides,
  };
  value.contentSha256 = manifestContentSha256(value);
  return value;
}

test('manifest validation accepts a checked, held, non-attendance lane', () => {
  assert.doesNotThrow(() => validateRosterManifest(manifest(), { now: new Date('2026-07-17T00:00:00Z') }));
});

test('manifest validation rejects attendance, hash tampering, stale data, and duplicate action keys', () => {
  const attendance = manifest({ lane: 'attendance', manifestId: 'attendance', contactActions: [], courseActions: [], expectedCounts: { contacts: 0 } });
  attendance.contentSha256 = manifestContentSha256(attendance);
  assert.throws(() => validateRosterManifest(attendance), /Attendance manifests/);

  const tampered = manifest();
  tampered.contactActions[0].final_contact_action = 'reuse_existing_contact_exact';
  assert.throws(() => validateRosterManifest(tampered, { now: new Date('2026-07-17T00:00:00Z') }), /content hash/);

  assert.throws(() => validateRosterManifest(manifest(), { now: new Date('2026-09-01T00:00:00Z') }), /stale/);

  const duplicate = manifest({
    courseActions: [{ idempotencyKey: 'mis-318:inactive:contact:a', proposed_course_action: 'insert_dropped_course_after_approval' }],
  });
  assert.throws(() => validateRosterManifest(duplicate, { now: new Date('2026-07-17T00:00:00Z') }), /must be unique/);
});

test('approval envelope is manifest-specific, expiring, and HMAC authenticated', () => {
  const value = manifest();
  const approval = {
    manifestId: value.manifestId,
    manifestSha256: value.contentSha256,
    approvedAt: '2026-07-16T23:00:00Z',
    expiresAt: '2026-07-17T23:00:00Z',
    approvalRef: 'Alvaro approval after dry-run review',
  };
  approval.signature = signRosterManifestApproval(approval, 'secret');
  assert.doesNotThrow(() => validateRosterManifestApproval(value, approval, 'secret', { now: new Date('2026-07-17T00:00:00Z') }));
  assert.throws(() => validateRosterManifestApproval(value, approval, 'wrong', { now: new Date('2026-07-17T00:00:00Z') }), /signature/);
  assert.throws(() => validateRosterManifestApproval(value, approval, 'secret', { now: new Date('2026-07-18T00:00:00Z') }), /not currently valid/);
});

test('deterministic import ids are stable UUIDs without exposing source identity', () => {
  const first = deterministicImportUuid('mis-318:inactive:contact:private-source-key');
  assert.equal(first, deterministicImportUuid('mis-318:inactive:contact:private-source-key'));
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(first.includes('private'), false);
});
