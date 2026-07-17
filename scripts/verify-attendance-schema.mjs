import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { allTables } from '../src/db/schema.js';
import {
  reopenAttendanceSession,
  resolveAttendanceSection,
  saveAttendanceSnapshot,
  saveSessionNote,
  submitAttendanceSession,
} from '../src/lib/attendance/service.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. This verifier always rolls back.');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function expectConstraintViolation(query, values, expectedCode = '23503') {
  const savepoint = `attendance_check_${crypto.randomUUID().replaceAll('-', '')}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query(query, values);
    assert.fail(`Expected PostgreSQL error ${expectedCode}.`);
  } catch (error) {
    assert.equal(error.code, expectedCode);
  } finally {
    await client.query(`rollback to savepoint ${savepoint}`);
  }
}

try {
  await client.query('begin');
  await client.query(fs.readFileSync(new URL('../drizzle/0026_attendance_sessions.sql', import.meta.url), 'utf8'));

  const suffix = crypto.randomUUID();
  const organization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-325 rollback verification ${suffix}`, `mis-325-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const unit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT USA', 'Division'],
  );
  const businessUnitId = unit.rows[0].id;
  const actor = await client.query(
    'insert into users (organization_id, name, email) values ($1, $2, $3) returning id',
    [organizationId, 'Attendance Verifier', `mis-325-${suffix}@example.test`],
  );
  const actorUserId = actor.rows[0].id;
  const contacts = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name)
     values ($1, $2, 'Student One'), ($1, $2, 'Student Two') returning id`,
    [organizationId, businessUnitId],
  );
  const sections = await client.query(
    `insert into course_class_sections
      (organization_id, business_unit_id, section_key, course_name, schedule_days_json, start_time, end_time, status)
     values ($1, $2, 'mis-325-primary', 'Computer', '["Friday"]'::jsonb, '09:00', '10:30', 'active'),
            ($1, $2, 'mis-325-other', 'English', '["Friday"]'::jsonb, '11:00', '12:30', 'active')
     returning id`,
    [organizationId, businessUnitId],
  );
  const [primarySectionId, otherSectionId] = sections.rows.map((row) => row.id);
  const enrollments = await client.query(
    `insert into contact_course_records
      (organization_id, business_unit_id, contact_id, class_section_id, course_name, status, start_date)
     values ($1, $2, $3, $5, 'Computer', 'active', '2026-07-01'),
            ($1, $2, $4, $6, 'English', 'active', '2026-07-01')
     returning id`,
    [organizationId, businessUnitId, contacts.rows[0].id, contacts.rows[1].id, primarySectionId, otherSectionId],
  );
  const [primaryEnrollmentId, otherEnrollmentId] = enrollments.rows.map((row) => row.id);
  const db = drizzle(client, { schema: allTables });
  const authorizedSession = {
    user: {
      organizationId,
      businessUnitIds: [businessUnitId],
      canAccessAllBusinessUnits: false,
    },
  };
  const resolvedSection = await resolveAttendanceSection({
    db,
    session: authorizedSession,
    sectionId: primarySectionId,
  });
  assert.equal(resolvedSection.id, primarySectionId);
  await assert.rejects(
    resolveAttendanceSection({
      db,
      session: { user: { ...authorizedSession.user, businessUnitIds: [] } },
      sectionId: primarySectionId,
    }),
    (error) => error.status === 403,
  );
  const section = {
    id: primarySectionId,
    organizationId,
    businessUnitId,
    courseName: 'Computer',
    scheduleDaysJson: ['Friday'],
    startTime: '09:00',
    endTime: '10:30',
  };
  const transactionRunner = async (work) => work(db);
  const noteOnly = await saveSessionNote({
    db,
    section,
    sessionDate: '2026-07-24',
    expectedRevision: 0,
    note: 'Guest speaker planned',
    transactionRunner,
  });
  assert.equal(noteOnly.attendanceState, 'not_started');

  const noted = await saveSessionNote({
    db,
    section,
    sessionDate: '2026-07-17',
    expectedRevision: 0,
    note: 'First class meeting',
    transactionRunner,
  });
  assert.equal(noted.revision, 1);
  const marked = await saveAttendanceSnapshot({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: noted.revision,
    marks: [{ enrollmentId: primaryEnrollmentId, status: 'present' }],
    transactionRunner,
  });
  assert.equal(marked.attendanceState, 'in_progress');
  const noteReplay = await saveSessionNote({
    db,
    section,
    sessionDate: '2026-07-17',
    expectedRevision: noted.revision,
    note: 'First class meeting',
    transactionRunner,
  });
  assert.equal(noteReplay.revision, marked.revision, 'identical stale note replay must return current revision');
  const renoted = await saveSessionNote({
    db,
    section,
    sessionDate: '2026-07-17',
    expectedRevision: marked.revision,
    note: 'First class meeting — projector worked',
    transactionRunner,
  });
  const attendanceReplay = await saveAttendanceSnapshot({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: noted.revision,
    marks: [{ enrollmentId: primaryEnrollmentId, status: 'present' }],
    transactionRunner,
  });
  assert.equal(attendanceReplay.revision, renoted.revision, 'identical stale attendance replay must return current revision');
  await assert.rejects(
    saveAttendanceSnapshot({
      db,
      section,
      sessionDate: '2026-07-17',
      actorUserId,
      expectedRevision: noted.revision,
      marks: [{ enrollmentId: primaryEnrollmentId, status: 'absent' }],
      transactionRunner,
    }),
    (error) => error.status === 409,
  );
  const submitted = await submitAttendanceSession({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: renoted.revision,
    transactionRunner,
  });
  assert.equal(submitted.status, 'submitted');
  await assert.rejects(
    saveAttendanceSnapshot({
      db,
      section,
      sessionDate: '2026-07-17',
      actorUserId,
      expectedRevision: submitted.revision,
      marks: [{ enrollmentId: primaryEnrollmentId, status: 'absent' }],
      transactionRunner,
    }),
    (error) => error.status === 409,
  );
  const reopened = await reopenAttendanceSession({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: submitted.revision,
    reason: 'Instructor corrected the paper roster.',
    transactionRunner,
  });
  const corrected = await saveAttendanceSnapshot({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: reopened.revision,
    marks: [{ enrollmentId: primaryEnrollmentId, status: 'absent', note: 'Corrected after review' }],
    transactionRunner,
  });
  assert.equal(corrected.attendanceState, 'in_progress');
  const finalSubmitted = await submitAttendanceSession({
    db,
    section,
    sessionDate: '2026-07-17',
    actorUserId,
    expectedRevision: corrected.revision,
    transactionRunner,
  });
  const sessionId = finalSubmitted.id;

  const otherUnit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT Signs', 'Division'],
  );
  const otherOrganization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-325 other organization ${suffix}`, `mis-325-other-${suffix}`],
  );
  const otherOrganizationUnit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [otherOrganization.rows[0].id, 'AIT USA', 'Division'],
  );
  await expectConstraintViolation(
    `insert into class_sessions
      (organization_id, business_unit_id, class_section_id, session_date)
     values ($1, $2, $3, '2026-07-31')`,
    [organizationId, otherUnit.rows[0].id, primarySectionId],
  );
  await expectConstraintViolation(
    `insert into class_sessions
      (organization_id, business_unit_id, class_section_id, session_date)
     values ($1, $2, $3, '2026-07-31')`,
    [otherOrganization.rows[0].id, otherOrganizationUnit.rows[0].id, primarySectionId],
  );
  await expectConstraintViolation(
    `insert into class_sessions
      (organization_id, business_unit_id, class_section_id, session_date)
     values ($1, $2, $3, '2026-07-17')`,
    [organizationId, businessUnitId, primarySectionId],
    '23505',
  );
  await expectConstraintViolation(
    `insert into attendance_records
      (organization_id, business_unit_id, class_session_id, class_section_id, enrollment_id, status)
     values ($1, $2, $3, $4, $5, 'present')`,
    [organizationId, businessUnitId, sessionId, primarySectionId, primaryEnrollmentId],
    '23505',
  );

  await assert.rejects(
    saveSessionNote({
      db,
      section,
      sessionDate: '2026-07-18',
      expectedRevision: 0,
      note: 'Invalid Saturday session',
      transactionRunner,
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    saveAttendanceSnapshot({
      db,
      section,
      sessionDate: '2026-07-17',
      actorUserId,
      expectedRevision: finalSubmitted.revision,
      marks: [{ enrollmentId: otherEnrollmentId, status: 'present' }],
      transactionRunner,
    }),
    (error) => error.status === 400,
  );

  await expectConstraintViolation(
    `insert into attendance_records
      (organization_id, business_unit_id, class_session_id, class_section_id, enrollment_id, status)
     values ($1, $2, $3, $4, $5, 'absent')`,
    [organizationId, businessUnitId, sessionId, primarySectionId, otherEnrollmentId],
  );
  await expectConstraintViolation(
    `insert into attendance_records
      (organization_id, business_unit_id, class_session_id, class_section_id, enrollment_id, status)
     values ($1, $2, $3, $4, $5, 'late')`,
    [organizationId, businessUnitId, sessionId, primarySectionId, primaryEnrollmentId],
    '23514',
  );
  await expectConstraintViolation(
    'delete from contact_course_records where id = $1',
    [primaryEnrollmentId],
  );
  await expectConstraintViolation(
    'delete from course_class_sections where id = $1',
    [primarySectionId],
  );

  await expectConstraintViolation(
    `update class_sessions
        set status = 'open'
      where id = $1`,
    [sessionId],
    '23514',
  );

  const rows = await client.query(
    `select cs.status, cs.revision, ar.status as attendance_status
       from class_sessions cs
       join attendance_records ar on ar.class_session_id = cs.id
      where cs.id = $1`,
    [sessionId],
  );
  assert.deepEqual(rows.rows, [{ status: 'submitted', revision: 7, attendance_status: 'absent' }]);
  const audit = await client.query(
    `select event_type, metadata_json
       from activity_events
      where metadata_json->>'sessionId' = $1
      order by created_at`,
    [sessionId],
  );
  assert.deepEqual(audit.rows.map((row) => row.event_type).sort(), [
    'attendance.mark_corrected',
    'attendance.session_submitted',
    'attendance.session_submitted',
    'attendance.session_reopened',
  ].sort());
  const correctionEvent = audit.rows.find((row) => row.event_type === 'attendance.mark_corrected');
  assert.equal(correctionEvent.metadata_json.reason, 'Instructor corrected the paper roster.');

  console.log(JSON.stringify({
    status: 'passed',
    tablesCreated: ['class_sessions', 'attendance_records'],
    crossSectionEnrollmentRejected: true,
    crossBusinessUnitSessionRejected: true,
    crossOrganizationSessionRejected: true,
    unauthorizedBusinessUnitAccessRejected: true,
    duplicateSessionRejected: true,
    duplicateAttendanceRejected: true,
    invalidAttendanceStatusRejected: true,
    enrollmentDeleteRestricted: true,
    sectionDeleteRestricted: true,
    submittedStateInvariantEnforced: true,
    noteAttendanceWritesSeparated: true,
    optimisticConflictsEnforced: true,
    identicalReplayIdempotent: true,
    submitReopenCorrectionsAudited: true,
    transaction: 'rolled_back',
  }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
