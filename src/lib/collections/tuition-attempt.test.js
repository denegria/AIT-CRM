import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTuitionAttempt } from './tuition-attempt.js';

test('uncertain tuition create retries reuse the same key, while changed intent gets a new key', () => {
  let generated = 0;
  const key = () => `tuition:charge:attempt-${++generated}`;
  const charge = { studentContactId: 'student-1', enrollmentId: 'enroll-1', servicePeriodStart: '2026-10-05' };
  const first = nextTuitionAttempt(null, 'ait-usa', charge, key);
  assert.equal(nextTuitionAttempt(first, 'ait-usa', { ...charge }, key), first);
  assert.equal(generated, 1);
  assert.notEqual(nextTuitionAttempt(first, 'ait-usa', { ...charge, servicePeriodStart: '2026-11-02' }, key).key, first.key);
  assert.notEqual(nextTuitionAttempt(first, 'other-unit', charge, key).key, first.key);
});
