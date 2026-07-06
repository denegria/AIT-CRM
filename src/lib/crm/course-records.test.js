import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courseRecordInputFromPayload,
  courseRecordPayloadFromRow,
  courseRecordStatusLabel,
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
    status: 'Dropped / Quit',
    startDate: '',
    endDate: '2026-07-06',
    outcomeReason: ' cancelled halfway ',
  }, { allowClear: true }), {
    courseName: 'OSHA 30',
    status: 'dropped',
    startDate: null,
    endDate: '2026-07-06',
    outcomeReason: 'cancelled halfway',
  });
});

test('course record validation enforces one current course for v1', () => {
  assert.throws(
    () => validateCourseRecordInput(
      { courseName: 'Forklift', status: 'active', startDate: '2026-07-01' },
      { existingRecords: [{ id: 'old', status: 'active' }] },
    ),
    /already has a current course/,
  );

  assert.throws(
    () => validateCourseRecordInput(
      { courseName: 'Forklift', status: 'active' },
      { existingRecords: [{ id: 'old', status: 'completed' }] },
    ),
    /Start date is required/,
  );

  assert.doesNotThrow(() => validateCourseRecordInput(
    { courseName: 'Forklift', status: 'active', startDate: '2026-07-01' },
    { existingRecords: [{ id: 'old', status: 'completed' }] },
  ));
});

test('course summary derives current and historical records', () => {
  const summary = deriveCourseSummary([
    { id: '1', courseName: 'ESL Level 1', status: 'completed', endDate: '2026-06-01' },
    { id: '2', courseName: 'OSHA 30', status: 'cancelled', endDate: '2026-06-20', outcomeReason: 'Cancelled halfway' },
    { id: '3', courseName: 'Forklift', status: 'active', startDate: '2026-07-01' },
  ]);

  assert.equal(summary.currentCourse.courseName, 'Forklift');
  assert.equal(summary.latestCompletedCourse.courseName, 'ESL Level 1');
  assert.equal(summary.latestEndedCourse.courseName, 'OSHA 30');
  assert.deepEqual(courseRecordPayloadFromRow(summary.currentCourse).statusLabel, 'Current');
});
