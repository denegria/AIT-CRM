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
