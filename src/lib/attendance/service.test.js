import assert from 'node:assert/strict';
import test from 'node:test';
import { listAttendanceClasses } from './service.js';
import { classSectionVersions } from '../../db/schema.js';

function classListDb(rows) {
  return {
    select: () => ({
      from: (table) => ({
        innerJoin: () => ({ where: async () => rows }),
        where: () => table === classSectionVersions
          ? { orderBy: async () => rows.map((row, index) => ({ ...row, classSectionId: row.id || `section-${index}`,
            effectiveDate: '2026-09-01', status: 'active' })) }
          : Promise.resolve([]),
      }),
    }),
  };
}

test('next-class guidance uses only authorized AIT USA schedules', async () => {
  const rows = [
    { id: 'section-1', businessUnitId: 'authorized', businessUnitName: 'AIT USA Institute', scheduleDaysJson: ['Wednesday'] },
    { id: 'section-2', businessUnitId: 'other', businessUnitName: 'AIT USA Institute', scheduleDaysJson: ['Friday'] },
    { id: 'section-3', businessUnitId: 'authorized', businessUnitName: 'AIT Signs', scheduleDaysJson: ['Friday'] },
  ];
  const session = { user: { organizationId: 'org', businessUnitIds: ['authorized'] } };
  const result = await listAttendanceClasses({ db: classListDb(rows), session, date: '2026-09-24' });
  assert.deepEqual(result, {
    date: '2026-09-24',
    classes: [],
    hasActiveSchedules: true,
    nextScheduledDate: '2026-09-30',
  });

  const noAccess = await listAttendanceClasses({
    db: classListDb(rows),
    session: { user: { organizationId: 'org', businessUnitIds: [] } },
    date: '2026-09-24',
  });
  assert.equal(noAccess.hasActiveSchedules, false);
  assert.equal(noAccess.nextScheduledDate, null);
});

test('active class rail resolves Tuesday and Saturday from their own time groups', async () => {
  const rows = [{ id: 'section-1', businessUnitId: 'authorized', businessUnitName: 'AIT USA Institute',
    courseName: 'English', scheduleDaysJson: ['Tuesday', 'Thursday', 'Saturday'],
    scheduleSlotsJson: [
      { days: ['Tuesday', 'Thursday'], startTime: '18:00', endTime: '21:00' },
      { days: ['Saturday'], startTime: '09:00', endTime: '12:00' },
    ] }];
  const session = { user: { organizationId: 'org', businessUnitIds: ['authorized'] } };
  const tuesday = await listAttendanceClasses({ db: classListDb(rows), session, date: '2026-10-06' });
  const saturday = await listAttendanceClasses({ db: classListDb(rows), session, date: '2026-10-10' });
  assert.deepEqual([tuesday.classes[0].startTime, tuesday.classes[0].endTime], ['18:00', '21:00']);
  assert.deepEqual([saturday.classes[0].startTime, saturday.classes[0].endTime], ['09:00', '12:00']);
});

test('attendance workspace shows distinct times for each upcoming day in one class', async () => {
  const { getAttendanceWorkspace } = await import('./service.js');
  const { courseClassSections, classSectionVersions } = await import('../../db/schema.js');
  const section = { id: 'section-1', organizationId: 'org', businessUnitId: 'authorized',
    businessUnitName: 'AIT USA Institute', sectionKey: 'ENG-1', courseName: 'English',
    teacher: 'Ana', courseLocation: 'Bound Brook', modality: 'in_person', status: 'active' };
  const version = { classSectionId: section.id, effectiveDate: '2026-10-05', revision: 1, status: 'active',
    scheduleDaysJson: ['Tuesday', 'Thursday', 'Saturday'], scheduleSlotsJson: [
      { days: ['Tuesday', 'Thursday'], startTime: '18:00', endTime: '21:00' },
      { days: ['Saturday'], startTime: '09:00', endTime: '12:00' },
    ] };
  const db = { select: () => ({ from: (table) => {
    const chain = { innerJoin: () => chain, where: () => chain,
      limit: async () => table === courseClassSections ? [section] : [],
      orderBy: async () => table === classSectionVersions ? [version] : [],
      then: (resolve) => resolve([]),
    };
    return chain;
  } }) };
  const workspace = await getAttendanceWorkspace({ db, session: { user: { organizationId: 'org',
    businessUnitIds: ['authorized'], roleKeys: ['account_coordinator'] } },
  sectionId: section.id, weekOf: '2026-10-06', selectedDate: '2026-10-06' });
  assert.deepEqual(workspace.sessions.map((item) => [item.date, item.startTime, item.endTime]), [
    ['2026-10-06', '18:00', '21:00'], ['2026-10-08', '18:00', '21:00'], ['2026-10-10', '09:00', '12:00'],
  ]);
  assert.equal(workspace.class.startTime, '18:00');
  assert.equal(workspace.class.scheduleSlots.length, 2);
});

test('pre-rollout submitted meeting keeps stored time and explicitly unknown teacher/location', async () => {
  const { getAttendanceWorkspace } = await import('./service.js');
  const { courseClassSections, classSectionVersions, classSessions, contactCourseRecords, attendanceRecords } = await import('../../db/schema.js');
  const legacy = { id: 'session-old', classSectionId: 'section-1', sessionDate: '2026-10-01',
    scheduledStartTime: '08:30', scheduledEndTime: '10:00', status: 'submitted', revision: 2,
    submittedAt: new Date('2026-10-01T15:00:00Z'), submittedByUserId: 'teacher-1' };
  const section = { id: 'section-1', organizationId: 'org', businessUnitId: 'authorized',
    businessUnitName: 'AIT USA Institute', sectionKey: 'ENG-1', courseName: 'English',
    teacher: 'Current teacher', courseLocation: 'Bound Brook', modality: 'in_person',
    scheduleDaysJson: ['Thursday'], startTime: '09:00', endTime: '11:00', status: 'active' };
  const db = { select: () => ({ from: (table) => {
    const chain = { innerJoin: () => chain, where: () => chain,
      limit: async () => table === courseClassSections ? [section] : [],
      orderBy: async () => table === classSectionVersions
        ? [{ classSectionId: 'section-1', effectiveDate: '2026-10-05', teacher: 'Current teacher',
          courseLocation: 'Bound Brook', scheduleDaysJson: ['Thursday'], startTime: '09:00', endTime: '11:00', status: 'active' }]
        : table === classSessions ? [legacy] : [],
      then: (resolve) => resolve(table === attendanceRecords ? [] : []),
    };
    return chain;
  } }) };
  const result = await getAttendanceWorkspace({ db, session: { user: { organizationId: 'org',
    businessUnitIds: ['authorized'], roleKeys: ['account_coordinator'] } },
  sectionId: 'section-1', weekOf: '2026-10-01', selectedDate: '2026-10-01' });
  assert.equal(result.class.legacyContext, true);
  assert.equal(result.class.teacher, '');
  assert.equal(result.class.location, '');
  assert.equal(result.class.courseName, 'Course not recorded (legacy) · ENG-1');
  assert.equal(result.class.modality, null);
  assert.equal(result.sessions[0].status, 'submitted');
  assert.equal(result.sessions[0].startTime, '08:30');
  assert.equal(result.sessions[0].endTime, '10:00');
});


test('pre-rollout class rail does not present current course or modality as history', async () => {
  const { courseClassSections, classSessions, contactCourseRecords, attendanceRecords } = await import('../../db/schema.js');
  const section = { id: 'section-1', organizationId: 'org', businessUnitId: 'authorized',
    businessUnitName: 'AIT USA Institute', sectionKey: 'ENG-1', courseName: 'Current course',
    teacher: 'Current teacher', courseLocation: 'Bound Brook', modality: 'online',
    scheduleDaysJson: ['Thursday'], startTime: '09:00', endTime: '11:00', status: 'active' };
  const persisted = { id: 'session-1', classSectionId: 'section-1', sessionDate: '2026-10-01',
    scheduledStartTime: '08:30', scheduledEndTime: '10:00', status: 'submitted' };
  const db = { select: () => ({ from: (table) => {
    const chain = { innerJoin: () => chain, where: () => chain, orderBy: async () =>
      table === classSectionVersions ? [{ classSectionId: 'section-1', effectiveDate: '2026-10-05',
        courseName: 'Current course', modality: 'online', status: 'active' }] : [],
    then: (resolve) => resolve(table === courseClassSections ? [section]
      : table === classSessions ? [persisted] : table === contactCourseRecords || table === attendanceRecords ? [] : []) };
    return chain;
  } }) };
  const result = await listAttendanceClasses({ db, session: { user: { organizationId: 'org',
    businessUnitIds: ['authorized'] } }, date: '2026-10-01' });
  assert.equal(result.classes[0].courseName, 'Course not recorded (legacy) · ENG-1');
  assert.equal(result.classes[0].modality, null);
  assert.equal(result.classes[0].legacyContext, true);
  assert.equal(result.classes[0].startTime, '08:30');
});
