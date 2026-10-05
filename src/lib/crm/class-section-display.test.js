import assert from 'node:assert/strict';
import test from 'node:test';
import { classSectionDisplayLabel } from './class-section-display.js';

test('class picker label makes day, local time, teacher, location and stable key legible', () => {
  assert.equal(classSectionDisplayLabel({
    courseName: 'English', scheduleDays: ['Monday', 'Wednesday', 'Friday'],
    startTime: '09:30', endTime: '10:30', teacher: 'Ms. Rivera',
    courseLocation: 'Bound Brook', modality: 'in_person', sectionKey: 'BB-ENG-1', status: 'active',
  }), 'English · M/W/F 9:30–10:30 AM · Ms. Rivera · Bound Brook · #BB-ENG-1');
});

test('class picker label distinguishes incomplete and inactive legacy sections', () => {
  assert.match(classSectionDisplayLabel({ courseName: 'English', sectionKey: 'old', status: 'inactive' }),
    /Schedule TBD · Teacher TBD · Location TBD · #old · Inactive/);
  assert.match(classSectionDisplayLabel({ courseName: 'English', scheduleDays: ['Tuesday', 'Thursday'],
    startTime: '11:30', endTime: '12:30', modality: 'online' }), /Tu\/Th 11:30 AM–12:30 PM · Teacher TBD · Online/);
});
