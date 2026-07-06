import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courseMetadataPatchFromPayload,
  courseMetadataPatchToDrizzleValues,
  courseMetadataSummary,
  normalizeCourseOutcome,
  validateCourseMetadataForStatus,
} from './course-metadata.js';

test('course metadata payload normalizes outcome aliases and preserves clears', () => {
  const patch = courseMetadataPatchFromPayload({
    courseMetadata: {
      currentCourse: ' ESL Level 2 ',
      completedCourse: '',
      courseOutcome: 'Quit Mid Course',
    },
  }, { allowClear: true });

  assert.deepEqual(patch, {
    currentCourse: 'ESL Level 2',
    completedCourse: '',
    courseOutcome: 'dropped_quit',
  });
  assert.deepEqual(courseMetadataPatchToDrizzleValues(patch), {
    currentCourse: 'ESL Level 2',
    completedCourse: null,
    courseOutcome: 'dropped_quit',
  });
});

test('course outcome normalization maps supported staff language', () => {
  assert.equal(normalizeCourseOutcome('completed'), 'completed');
  assert.equal(normalizeCourseOutcome('Dropped / Quit'), 'dropped_quit');
  assert.equal(normalizeCourseOutcome('withdrawn'), 'dropped_quit');
  assert.equal(normalizeCourseOutcome('transfer'), 'transferred');
  assert.equal(normalizeCourseOutcome('not sure'), 'unknown');
});

test('course metadata validation prevents unsupported status and outcome combinations', () => {
  assert.throws(
    () => validateCourseMetadataForStatus({
      workflowKey: 'ait_usa',
      status: 'Dropped / Quit',
      courseMetadata: { endedCourse: 'Tax Prep', courseOutcome: 'completed' },
    }),
    /Dropped \/ Quit contacts cannot use Completed/,
  );

  assert.throws(
    () => validateCourseMetadataForStatus({
      workflowKey: 'ait_usa',
      status: 'Course Completed',
      courseMetadata: { completedCourse: 'Forklift', courseOutcome: 'dropped_quit' },
    }),
    /Course Completed contacts can only use Completed or Unknown/,
  );

  assert.throws(
    () => validateCourseMetadataForStatus({
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      courseMetadata: { currentCourse: 'ESL', courseOutcome: 'transferred' },
    }),
    /Enrolled contacts cannot have a terminal course outcome/,
  );

  assert.doesNotThrow(() => validateCourseMetadataForStatus({
    workflowKey: 'ait_usa',
    status: 'Dropped / Quit',
    courseMetadata: { endedCourse: 'Tax Prep', courseOutcome: 'dropped_quit' },
  }));
});

test('course metadata summary renders staff-readable audit text', () => {
  assert.equal(
    courseMetadataSummary({
      currentCourse: 'ESL Level 2',
      courseOutcome: 'dropped_quit',
    }),
    'Current course: ESL Level 2; Course outcome: Dropped / Quit',
  );
});
