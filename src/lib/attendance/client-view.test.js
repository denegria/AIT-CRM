import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCalendarDays,
  attendanceCounts,
  classRailHeading,
  classTitle,
  formatLongDate,
  formatScheduleDays,
  formatTimeRange,
  initials,
  marksFromRoster,
  serializeMarks,
  todayInNewYork,
} from './client-view.js';

test('attendance dates and class labels stay timezone-safe and readable', () => {
  assert.equal(todayInNewYork(new Date('2026-07-18T03:30:00Z')), '2026-07-17');
  assert.equal(addCalendarDays('2026-07-17', -1), '2026-07-16');
  assert.equal(formatLongDate('2026-07-17'), 'Friday, July 17, 2026');
  assert.equal(formatTimeRange('20:30', '21:30'), '8:30 PM–9:30 PM');
  assert.equal(formatScheduleDays(['Monday', 'Wednesday', 'Friday']), 'Mon / Wed / Fri');
  assert.equal(classTitle({ courseName: 'English 1', location: 'Plainfield' }), 'English 1 — Plainfield');
  assert.equal(classTitle({ courseName: 'English 1', modality: 'online' }), 'English 1 — Online');
  assert.equal(classRailHeading('2026-07-17', '2026-07-17'), 'Today’s classes');
});

test('quick-mark snapshots preserve unmarked as the absence of a record', () => {
  const roster = [
    { enrollmentId: 'a', name: 'Aiden Smith', mark: { status: 'present', note: '' } },
    { enrollmentId: 'b', name: 'Bella Hernandez', mark: null },
    { enrollmentId: 'c', name: 'Cameron Jones', mark: { status: 'absent', note: 'Sick' } },
  ];
  const marks = marksFromRoster(roster);
  assert.deepEqual(attendanceCounts(roster, marks), { present: 1, absent: 1, unmarked: 1 });
  assert.deepEqual(serializeMarks(roster, marks), [
    { enrollmentId: 'a', status: 'present', note: '' },
    { enrollmentId: 'c', status: 'absent', note: 'Sick' },
  ]);
  assert.equal(initials('Aiden Smith'), 'AS');
});
