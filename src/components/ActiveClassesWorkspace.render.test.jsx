import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActiveClassesWorkspace from './ActiveClassesWorkspace.js';

function renderSelectedClass(section) {
  return renderToStaticMarkup(createElement(ActiveClassesWorkspace, {
    styles: {},
    initialState: {
      today: '2026-10-07',
      date: '2026-10-07',
      classes: [section],
      selectedClassId: section.id,
      hasActiveSchedules: true,
      workspace: { class: section, selectedDate: '2026-10-07', sessions: [], roster: [] },
    },
  }));
}

test('a selected class renders heterogeneous weekday times without crashing the workspace', () => {
  const html = renderSelectedClass({
    id: 'class-1', courseName: 'English', location: 'Bound Brook', teacher: 'QA Teacher',
    scheduleDays: ['Tuesday', 'Thursday', 'Saturday'],
    scheduleSlots: [
      { days: ['Tuesday', 'Thursday'], startTime: '18:00', endTime: '21:00' },
      { days: ['Saturday'], startTime: '09:00', endTime: '12:00' },
    ],
    startTime: '18:00', endTime: '21:00', studentCount: 3,
  });
  assert.match(html, /Tue \/ Thu/);
  assert.match(html, /Sat/);
  assert.match(html, /6:00 PM/);
  assert.match(html, /9:00 AM/);
});

test('a selected legacy class without stored times renders a safe summary', () => {
  const html = renderSelectedClass({
    id: 'class-2', courseName: 'Legacy English', location: 'Bound Brook',
    scheduleDays: ['Wednesday'], studentCount: 2,
  });
  assert.match(html, /Wed · Time not set/);
});
