import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_COURSE_OPTIONS,
  courseNameOptions,
  courseRecordInputFromPayload,
  courseRecordPayloadFromRow,
  courseRecordStatusLabel,
  courseRecordValuesFromInput,
  deriveCourseSummary,
  normalizeCourseRecordStatus,
  validateCourseRecordInput,
} from './course-records.js';

test('course record status normalization maps staff language', () => {
  assert.equal(normalizeCourseRecordStatus('Current'), 'active');
  assert.equal(normalizeCourseRecordStatus('enrolled'), 'active');
  assert.equal(normalizeCourseRecordStatus('Dropped / Quit'), 'dropped');
  assert.equal(normalizeCourseRecordStatus('canceled'), 'cancelled');
  assert.equal(courseRecordStatusLabel('active'), 'Current');
});

test('course record input trims text and supports clearable dates', () => {
  assert.deepEqual(courseRecordInputFromPayload({
    courseName: '  OSHA 30 ',
    courseLocation: 'plainfield',
    teacher: '  Ana   Rivera ',
    status: 'Dropped / Quit',
    startDate: '',
    endDate: '2026-07-06',
    outcomeReason: ' cancelled halfway ',
  }, { allowClear: true }), {
    courseName: 'OSHA 30',
    courseLocation: 'Plainfield',
    teacher: 'Ana Rivera',
    status: 'dropped',
    startDate: null,
    endDate: '2026-07-06',
    outcomeReason: 'cancelled halfway',
  });
});

test('course options expose the AIT USA catalog and preserve legacy saved values', () => {
  assert.deepEqual(AIT_USA_COURSE_OPTIONS, [
    'Intro to English',
    'English 1',
    'English 2',
    'English 3',
    'English 4',
    'English 5',
    'English 6',
    'GED',
    'Citizenship Prep',
    'Computer',
    'Math',
  ]);
  assert.deepEqual(courseNameOptions('ESL Level 1'), [...AIT_USA_COURSE_OPTIONS, 'ESL Level 1']);
  assert.deepEqual(courseNameOptions(' English 1 '), AIT_USA_COURSE_OPTIONS);
  assert.deepEqual(courseNameOptions(' Computer '), AIT_USA_COURSE_OPTIONS);
  assert.deepEqual(courseNameOptions('Math'), AIT_USA_COURSE_OPTIONS);
});

test('course teacher round-trips and can be cleared', () => {
  assert.equal(courseRecordPayloadFromRow({ courseName: 'GED', teacher: ' Ana Rivera ' }).teacher, 'Ana Rivera');
  assert.deepEqual(courseRecordInputFromPayload({ teacher: '' }, { allowClear: true }), { teacher: null });
  assert.deepEqual(courseRecordValuesFromInput({ teacher: ' Ana Rivera ' }), { teacher: 'Ana Rivera' });
});

test('course record location round-trips structured and legacy values', () => {
  assert.deepEqual(courseRecordInputFromPayload({ courseLocation: ' piscataway ' }), {
    courseLocation: 'Piscataway',
  });
  assert.deepEqual(courseRecordInputFromPayload({ courseLocation: '' }, { allowClear: true }), {
    courseLocation: null,
  });
  assert.equal(courseRecordPayloadFromRow({
    courseName: 'Forklift',
    courseLocation: 'Legacy Campus',
  }).courseLocation, 'Legacy Campus');
  assert.deepEqual(courseRecordValuesFromInput({ courseLocation: ' Bound Brook ' }), {
    courseLocation: 'Bound Brook',
  });
});

test('course record validation allows multiple active sections and blocks duplicate enrollment replay', () => {
  assert.throws(
    () => validateCourseRecordInput(
      { classSectionId: 'section-a', courseName: 'English 1', status: 'active', startDate: '2026-07-01' },
      { existingRecords: [{ id: 'old', classSectionId: 'section-a', courseName: 'English 1', status: 'active' }] },
    ),
    /same class section/,
  );

  assert.throws(
    () => validateCourseRecordInput(
      { courseName: 'Forklift', status: 'active' },
      { existingRecords: [{ id: 'old', status: 'completed' }] },
    ),
    /Start date is required/,
  );

  assert.doesNotThrow(() => validateCourseRecordInput(
    { classSectionId: 'section-b', courseName: 'Computer', status: 'active', startDate: '2026-07-01' },
    { existingRecords: [{ id: 'old', classSectionId: 'section-a', courseName: 'English 1', status: 'active' }] },
  ));

  assert.doesNotThrow(() => validateCourseRecordInput(
    { courseName: 'Forklift', courseLocation: 'Bound Brook', teacher: 'Ana', status: 'active', startDate: '2026-07-01' },
    { existingRecords: [{ id: 'old', courseName: 'GED', courseLocation: 'Bound Brook', teacher: 'Ana', status: 'active', startDate: '2026-07-01' }] },
  ));
});

test('course summary derives current and historical records', () => {
  const summary = deriveCourseSummary([
    { id: '1', courseName: 'ESL Level 1', status: 'completed', endDate: '2026-06-01' },
    { id: '2', courseName: 'OSHA 30', status: 'cancelled', endDate: '2026-06-20', outcomeReason: 'Cancelled halfway' },
    { id: '3', courseName: 'Forklift', courseLocation: 'Flemington', teacher: 'Ana Rivera', status: 'active', startDate: '2026-07-01' },
  ]);

  assert.equal(summary.currentCourse.courseName, 'Forklift');
  assert.deepEqual(summary.currentCourses.map((record) => record.courseName), ['Forklift']);
  assert.equal(summary.currentCourse.courseLocation, 'Flemington');
  assert.equal(summary.currentCourse.teacher, 'Ana Rivera');
  assert.equal(summary.latestCompletedCourse.courseName, 'ESL Level 1');
  assert.equal(summary.latestEndedCourse.courseName, 'OSHA 30');
  assert.deepEqual(courseRecordPayloadFromRow(summary.currentCourse).statusLabel, 'Current');
});
