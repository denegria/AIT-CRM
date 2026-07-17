import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertScheduledSessionDate,
  attendanceSnapshotsEqual,
  canLinkAttendanceContacts,
  canManageSubmittedAttendance,
  deriveAttendanceState,
  enrollmentEligibleOnDate,
  isAitUsaBusinessUnit,
  isAttendanceEmployee,
  normalizeAttendanceMarks,
  normalizeExpectedRevision,
  parseSessionDate,
  scheduledDatesForWeek,
  todayInAttendanceTimeZone,
  weekBounds,
  weekdayForSessionDate,
} from './policy.js';

function user(primaryRoleKey, extra = {}) {
  return { primaryRoleKey, roleKeys: [primaryRoleKey], ...extra };
}

test('attendance role allowlist excludes other crm:write roles', () => {
  assert.equal(isAttendanceEmployee(user('account_coordinator')), true);
  assert.equal(isAttendanceEmployee(user('senior_coordinator')), true);
  assert.equal(isAttendanceEmployee(user('admin')), true);
  assert.equal(isAttendanceEmployee(user('sales_manager')), false);
  assert.equal(isAttendanceEmployee(user('designer')), false);
  assert.equal(canManageSubmittedAttendance(user('account_coordinator')), false);
  assert.equal(canManageSubmittedAttendance(user('senior_coordinator')), true);
  assert.equal(canLinkAttendanceContacts(user('account_coordinator')), false);
  assert.equal(canLinkAttendanceContacts(user('admin')), true);
});

test('attendance recognizes the canonical AIT USA Institute business unit', () => {
  assert.equal(isAitUsaBusinessUnit('AIT USA Institute'), true);
  assert.equal(isAitUsaBusinessUnit('AIT USA'), true);
  assert.equal(isAitUsaBusinessUnit('AIT Signs'), false);
});

test('session dates are strict calendar dates with deterministic weekdays', () => {
  assert.equal(parseSessionDate('2026-07-17').dateText, '2026-07-17');
  assert.equal(weekdayForSessionDate('2026-07-17'), 'Friday');
  assert.deepEqual(weekBounds('2026-07-17'), { start: '2026-07-13', end: '2026-07-19' });
  assert.throws(() => parseSessionDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => parseSessionDate('07\/17\/2026'), /YYYY-MM-DD/);
  assert.equal(todayInAttendanceTimeZone(new Date('2026-07-18T03:30:00Z')), '2026-07-17');
});

test('scheduled occurrences and mutation dates follow canonical weekdays', () => {
  assert.deepEqual(
    scheduledDatesForWeek(['Monday', 'Wednesday', 'Friday'], '2026-07-17'),
    ['2026-07-13', '2026-07-15', '2026-07-17'],
  );
  assert.equal(assertScheduledSessionDate({ scheduleDaysJson: ['Friday'] }, '2026-07-17'), '2026-07-17');
  assert.deepEqual(
    scheduledDatesForWeek(['LUN', 'MAR', 'MIE', 'JUE'], '2026-07-17'),
    ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'],
  );
  assert.deepEqual(
    scheduledDatesForWeek(['MONDAY TO THURSDAY'], '2026-07-17'),
    ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'],
  );
  assert.equal(assertScheduledSessionDate({ scheduleDaysJson: ['VIERNES'] }, '2026-07-17'), '2026-07-17');
  assert.throws(
    () => assertScheduledSessionDate({ scheduleDaysJson: ['Monday'] }, '2026-07-17'),
    /not a scheduled Friday meeting/,
  );
});

test('attendance marks normalize to a complete deterministic snapshot', () => {
  assert.deepEqual(normalizeAttendanceMarks([
    { enrollmentId: 'b', status: 'ABSENT', note: ' Sick ' },
    { enrollmentId: 'a', status: 'present' },
  ]), [
    { enrollmentId: 'a', status: 'present', note: null },
    { enrollmentId: 'b', status: 'absent', note: 'Sick' },
  ]);
  assert.equal(attendanceSnapshotsEqual(
    [{ enrollmentId: 'b', status: 'absent', note: 'Sick' }, { enrollmentId: 'a', status: 'present' }],
    [{ enrollmentId: 'a', status: 'present' }, { enrollmentId: 'b', status: 'absent', note: 'Sick' }],
  ), true);
  assert.throws(() => normalizeAttendanceMarks([
    { enrollmentId: 'a', status: 'present' },
    { enrollmentId: 'a', status: 'absent' },
  ]), /Duplicate attendance mark/);
  assert.throws(() => normalizeAttendanceMarks([{ enrollmentId: 'a', status: 'late' }]), /present or absent/);
});

test('state and eligibility keep note-only sessions distinct from attendance', () => {
  assert.equal(deriveAttendanceState({ status: 'open', sessionNote: 'Guest speaker' }, 0), 'not_started');
  assert.equal(deriveAttendanceState({ status: 'open' }, 1), 'in_progress');
  assert.equal(deriveAttendanceState({ status: 'submitted' }, 0), 'submitted');
  assert.equal(enrollmentEligibleOnDate({ status: 'active', startDate: '2026-07-01' }, '2026-07-17'), true);
  assert.equal(enrollmentEligibleOnDate({ status: 'active', endDate: '2026-07-16' }, '2026-07-17'), false);
  assert.equal(enrollmentEligibleOnDate({ status: 'dropped' }, '2026-07-17'), false);
  assert.equal(normalizeExpectedRevision(0), 0);
  assert.throws(() => normalizeExpectedRevision(-1), /non-negative integer/);
});
