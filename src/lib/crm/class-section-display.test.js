import assert from 'node:assert/strict';
import test from 'node:test';
import { classSectionDisplayLabel, classSectionScheduleLabel } from './class-section-display.js';

test('enrollment row schedule handles populated and legacy sections without implying a schedule for an unlinked record', () => {
  assert.equal(classSectionScheduleLabel({ scheduleSlots: [
    { days: ['Tuesday', 'Thursday'], startTime: '18:00', endTime: '21:00' },
    { days: ['Saturday'], startTime: '09:00', endTime: '12:00' },
  ] }), 'Tue / Thu · 6:00 PM–9:00 PM; Sat · 9:00 AM–12:00 PM');
  assert.equal(classSectionScheduleLabel({ scheduleDays: ['Monday'], startTime: '09:00', endTime: '10:00' }),
    'Mon · 9:00 AM–10:00 AM');
  assert.equal(classSectionScheduleLabel(null), '');
});

test('class picker label makes day, local time, teacher, location and stable key legible', () => {
  assert.equal(classSectionDisplayLabel({
    courseName: 'English', scheduleDays: ['Monday', 'Wednesday', 'Friday'],
    startTime: '09:30', endTime: '10:30', teacher: 'Ms. Rivera',
    courseLocation: 'Bound Brook', modality: 'in_person', sectionKey: 'BB-ENG-1', status: 'active',
  }), 'English · Mon / Wed / Fri · 9:30 AM–10:30 AM · Ms. Rivera · Bound Brook · #BB-ENG-1');
});

test('class picker label distinguishes incomplete and inactive legacy sections', () => {
  assert.match(classSectionDisplayLabel({ courseName: 'English', sectionKey: 'old', status: 'inactive' }),
    /Class schedule not set · Teacher TBD · Location TBD · #old · Inactive/);
  assert.match(classSectionDisplayLabel({ courseName: 'English', scheduleDays: ['Tuesday', 'Thursday'],
    startTime: '11:30', endTime: '12:30', modality: 'online' }), /Tue \/ Thu · 11:30 AM–12:30 PM · Teacher TBD · Online/);
});

test('class picker label shows heterogeneous time groups in one class', () => {
  const label = classSectionDisplayLabel({ courseName: 'English', scheduleSlots: [
    { days: ['Tuesday', 'Thursday'], startTime: '18:00', endTime: '21:00' },
    { days: ['Saturday'], startTime: '09:00', endTime: '12:00' },
  ], courseLocation: 'Bound Brook', teacher: 'Ana' });
  assert.match(label, /Tue \/ Thu · 6:00 PM–9:00 PM; Sat · 9:00 AM–12:00 PM/);
});

test('imported noncanonical days remain flagged even when attendance can interpret them', () => {
  assert.match(classSectionDisplayLabel({ courseName: 'English', scheduleDays: ['VIERNES'],
    startTime: '18:00', endTime: '21:00' }), /Schedule needs review/);
});
