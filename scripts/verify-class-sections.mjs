import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { allTables } from '../src/db/schema.js';
import { upsertClassSection } from '../src/lib/crm/class-sections.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. This verifier always rolls back.');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  await client.query(fs.readFileSync(new URL('../drizzle/0023_course_class_sections.sql', import.meta.url), 'utf8'));
  const db = drizzle(client, { schema: allTables });
  const suffix = crypto.randomUUID();
  const organization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-321 rollback verification ${suffix}`, `mis-321-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const unit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT USA', 'Division'],
  );
  const businessUnitId = unit.rows[0].id;
  const contact = await client.query(
    'insert into contacts (organization_id, primary_business_unit_id, name, phone) values ($1, $2, $3, $4) returning id',
    [organizationId, businessUnitId, 'Multiple Enrollment Student', '(908) 555-0123'],
  );
  const contactId = contact.rows[0].id;

  const firstSection = await upsertClassSection({
    db,
    organizationId,
    businessUnitId,
    payload: {
      sectionKey: 'bound-brook-computer-morning',
      courseName: 'Computer',
      teacher: 'Teacher One',
      courseLocation: 'Bound Brook',
      modality: 'in_person',
      scheduleDays: ['Monday', 'Wednesday'],
      startTime: '09:00',
      endTime: '10:30',
      sourceType: 'student_roster',
      sourceReference: 'MIS-321:verification:first',
    },
  });
  const replay = await upsertClassSection({
    db,
    organizationId,
    businessUnitId,
    payload: {
      sectionKey: 'bound-brook-computer-morning',
      courseName: 'Computer',
      teacher: 'Teacher One',
      courseLocation: 'Bound Brook',
      modality: 'in_person',
      scheduleDays: ['Monday', 'Wednesday'],
      startTime: '09:00',
      endTime: '10:30',
      sourceType: 'student_roster',
      sourceReference: 'MIS-321:verification:first',
    },
  });
  const secondSection = await upsertClassSection({
    db,
    organizationId,
    businessUnitId,
    payload: {
      sectionKey: 'plainfield-math-evening',
      courseName: 'Math',
      teacher: 'Teacher Two',
      courseLocation: 'Plainfield',
      modality: 'in_person',
      scheduleDays: ['Tuesday', 'Thursday'],
      startTime: '18:00',
      endTime: '19:30',
      sourceType: 'student_roster',
      sourceReference: 'MIS-321:verification:second',
    },
  });

  await client.query(
    `insert into contact_course_records
      (organization_id, business_unit_id, contact_id, class_section_id, course_name, course_location, teacher, status, start_date)
     values ($1, $2, $3, $4, $5, $6, $7, 'active', $8),
            ($1, $2, $3, $9, $10, $11, $12, 'active', $8)`,
    [
      organizationId,
      businessUnitId,
      contactId,
      firstSection.id,
      firstSection.courseName,
      firstSection.courseLocation,
      firstSection.teacher,
      '2026-07-01',
      secondSection.id,
      secondSection.courseName,
      secondSection.courseLocation,
      secondSection.teacher,
    ],
  );

  await client.query('savepoint duplicate_enrollment');
  let duplicateRejected = false;
  try {
    await client.query(
      `insert into contact_course_records
        (organization_id, business_unit_id, contact_id, class_section_id, course_name, status, start_date)
       values ($1, $2, $3, $4, $5, 'active', $6)`,
      [organizationId, businessUnitId, contactId, firstSection.id, firstSection.courseName, '2026-07-01'],
    );
  } catch (error) {
    duplicateRejected = error.code === '23505';
    await client.query('rollback to savepoint duplicate_enrollment');
  }

  const sections = await client.query(
    'select section_key, source_reference from course_class_sections where organization_id = $1 order by section_key',
    [organizationId],
  );
  const enrollments = await client.query(
    `select ccr.status, ccs.section_key, ccs.course_location
       from contact_course_records ccr
       join course_class_sections ccs on ccs.id = ccr.class_section_id
      where ccr.organization_id = $1 and ccr.contact_id = $2
      order by ccs.section_key`,
    [organizationId, contactId],
  );

  assert.equal(firstSection.id, replay.id, 'section replay must update the same stable section');
  assert.equal(sections.rows.length, 2, 'section replay must not create a duplicate section');
  assert.equal(enrollments.rows.length, 2, 'different sections may both be active');
  assert.deepEqual(enrollments.rows.map((row) => row.course_location), ['Bound Brook', 'Plainfield']);
  assert.equal(duplicateRejected, true, 'the same active section enrollment must be rejected');

  console.log(JSON.stringify({
    status: 'passed',
    classSections: sections.rows.length,
    activeEnrollments: enrollments.rows.length,
    duplicateActiveEnrollmentRejected: duplicateRejected,
    sourceLineagePreserved: sections.rows.every((row) => row.source_reference?.startsWith('MIS-321:')),
    transaction: 'rolled_back',
  }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
