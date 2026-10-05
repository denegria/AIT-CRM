import assert from 'node:assert/strict';
import test from 'node:test';
import { classSectionInput, classSectionLabel, classSectionPayload } from './class-sections.js';

test('class sections normalize source schedule and modality without losing lineage', () => {
  const input = classSectionInput({
    sectionKey: ' plainfield:english-1:weekday-am ',
    courseName: ' English 1 ',
    teacher: ' Ana  Rivera ',
    courseLocation: 'plainfield',
    modality: 'in person',
    scheduleDays: ['Monday', 'Wednesday', 'Monday'],
    startTime: '09:00',
    endTime: '12:00',
    sourceType: 'roster_manifest',
    sourceReference: 'MIS-323:Plainfield:section-1',
  });
  assert.equal(input.sectionKey, 'plainfield:english-1:weekday-am');
  assert.equal(input.courseLocation, 'Plainfield');
  assert.equal(input.modality, 'in_person');
  assert.deepEqual(input.scheduleDaysJson, ['Monday', 'Wednesday']);
  assert.equal(input.scheduledDaysPerWeek, 2);
  assert.equal(input.sourceReference, 'MIS-323:Plainfield:section-1');
});

test('class section payload and label keep section-owned context together', () => {
  const payload = classSectionPayload({
    id: 'section-1',
    sectionKey: 'section-1',
    courseName: 'Computer',
    teacher: 'Luis',
    courseLocation: 'Bound Brook',
    modality: 'in_person',
    scheduleDaysJson: ['Saturday'],
    startTime: '09:00',
    endTime: '12:00',
  });
  assert.match(classSectionLabel(payload), /Computer · Luis · Bound Brook · Saturday 09:00–12:00/);
});

test('class sections reject invalid schedule data', () => {
  assert.throws(() => classSectionInput({ sectionKey: 'x', courseName: 'Math', startTime: '9am' }), /HH:MM/);
  assert.throws(() => classSectionInput({ sectionKey: 'x', courseName: 'Math', scheduledDaysPerWeek: 8 }), /between 1 and 7/);
  assert.throws(
    () => classSectionInput({ sectionKey: 'x', courseName: 'Math', scheduleDays: ['Mon'] }),
    /schedule day is not supported/,
  );
});

test('effective versions never borrow rollout baseline for earlier meetings', async () => {
  const { resolveSectionVersion, sectionAtDate } = await import('./class-sections.js');
  const section = { id: 'section-1', sectionKey: 'ENG-1', teacher: 'Current source row' };
  const versions = [
    { effectiveDate: '2026-10-05', teacher: 'Rollout teacher', status: 'active' },
    { effectiveDate: '2026-11-01', teacher: 'Next teacher', status: 'active' },
  ];
  assert.equal(resolveSectionVersion(versions, '2026-10-04'), null);
  assert.equal(sectionAtDate(section, versions, '2026-10-04'), null);
  assert.equal(sectionAtDate(section, versions, '2026-10-31').teacher, 'Rollout teacher');
  assert.equal(sectionAtDate(section, versions, '2026-11-01').teacher, 'Next teacher');
});

test('managed section validation requires local time, canonical location and matched weekdays', async () => {
  const { normalizeManagedSection } = await import('./class-sections.js');
  const valid = { sectionKey: 'ENG-2', courseName: 'English', courseLocation: 'Bound Brook',
    scheduleDays: ['Monday', 'Wednesday'], startTime: '09:00', endTime: '10:00', status: 'planned' };
  assert.equal(normalizeManagedSection(valid).status, 'planned');
  assert.throws(() => normalizeManagedSection({ ...valid, courseLocation: 'Unknown' }), /valid AIT USA/);
  assert.throws(() => normalizeManagedSection({ ...valid, endTime: '08:00' }), /New York local time/);
  assert.throws(() => normalizeManagedSection({ ...valid, scheduledDaysPerWeek: 1 }), /match the selected days/);
});

test('pending deactivation rejects later spanning active enrollments without auto-cancel', async () => {
  const { assertNoPendingDeactivation } = await import('./class-sections.js');
  const versions = [{ effectiveDate: '2026-11-01', status: 'inactive' }];
  assert.throws(() => assertNoPendingDeactivation(versions,
    { status: 'active', startDate: '2026-10-06', endDate: null }, '2026-10-05'), /End or transition/);
  assert.doesNotThrow(() => assertNoPendingDeactivation(versions,
    { status: 'active', startDate: '2026-10-06', endDate: '2026-10-31' }, '2026-10-05'));
  assert.doesNotThrow(() => assertNoPendingDeactivation(versions,
    { status: 'completed', startDate: '2026-10-06', endDate: null }, '2026-10-05'));
});

test('deactivation checks spanning roster only after section row lock and never inserts on conflict', async () => {
  const { writeManagedSection } = await import('./class-sections.js');
  const { courseClassSections, classSectionVersions, classSessions, contactCourseRecords } = await import('../../db/schema.js');
  const calls = [];
  const section = { id: 'section-1', organizationId: 'org', businessUnitId: 'usa', sectionKey: 'ENG-1',
    courseName: 'English', teacher: 'Ana', courseLocation: 'Bound Brook', modality: 'in_person',
    scheduleDaysJson: ['Monday'], startTime: '09:00', endTime: '10:00', scheduledDaysPerWeek: 1, status: 'active' };
  const tx = {
    select: () => ({ from(table) {
      const chain = { where: () => chain,
        limit() { return { for: async () => { calls.push('section-lock'); return [section]; },
          then: (resolve) => resolve(table === classSessions ? [] : table === contactCourseRecords ? [{ id: 'blocking' }] : []) }; },
        orderBy: async () => [{ classSectionId: 'section-1', effectiveDate: '2026-10-05', revision: 1,
          ...section, id: 'version-1', isBaseline: true }],
      };
      assert.ok([courseClassSections, classSectionVersions, classSessions, contactCourseRecords].includes(table));
      return chain;
    } }),
    insert() { calls.push('insert'); throw new Error('must not insert'); },
  };
  const db = { transaction: (work) => work(tx) };
  await assert.rejects(() => writeManagedSection({ db, organizationId: 'org', businessUnitId: 'usa',
    actorUserId: 'manager', sectionId: 'section-1', expectedRevision: 1,
    effectiveDate: '2026-11-01', today: '2026-10-05', payload: {
      ...section, status: 'inactive', scheduleDays: ['Monday'],
    } }), /Active enrollments span/);
  assert.deepEqual(calls, ['section-lock']);
});

test('regular catalog payload omits unpublished versions, audit metadata and contact identifiers', async () => {
  const { listManagedSections } = await import('./class-sections.js');
  const { courseClassSections, classSectionVersions, contactCourseRecords } = await import('../../db/schema.js');
  const db = { select: () => ({ from(table) {
    const chain = { where: () => chain,
      orderBy: async () => table === courseClassSections
        ? [{ id: 'section-usa', organizationId: 'org', businessUnitId: 'usa', sectionKey: 'ENG-1', courseName: 'English' }]
        : [{ id: 'version-1', classSectionId: 'section-usa', effectiveDate: '2026-10-05', revision: 1,
          courseName: 'English', teacher: 'Ana', courseLocation: 'Bound Brook', status: 'active',
          scheduleDaysJson: ['Monday'], startTime: '09:00', endTime: '10:00',
          auditSummaryJson: { private: true }, contactId: 'forbidden-contact' },
        { id: 'version-2', classSectionId: 'section-usa', effectiveDate: '2026-11-01', revision: 2,
          courseName: 'English', teacher: 'Future teacher', courseLocation: 'Plainfield', status: 'active',
          scheduleDaysJson: ['Tuesday'], startTime: '11:00', endTime: '12:00' }],
      groupBy: async () => [{ classSectionId: 'section-usa', count: 3 }],
    };
    assert.ok([courseClassSections, classSectionVersions, contactCourseRecords].includes(table));
    return chain;
  } }) };
  const sections = await listManagedSections({ db, organizationId: 'org', businessUnitId: 'usa',
    canManage: false, today: '2026-10-06' });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].rosterCount, 3);
  assert.equal(sections[0].teacher, 'Ana');
  const serialized = JSON.stringify(sections);
  assert.doesNotMatch(serialized, /Future teacher|2026-11-01|auditSummaryJson|forbidden-contact|contactId|section-other/);
});
