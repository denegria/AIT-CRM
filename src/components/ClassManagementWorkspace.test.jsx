import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClassManagementWorkspace from './ClassManagementWorkspace.js';

const section = { id: 'section-1', sectionKey: 'ENG-1', courseName: 'English', teacher: 'Ana',
  courseLocation: 'Bound Brook', modality: 'in_person', scheduleDays: ['Monday'],
  startTime: '09:00', endTime: '10:00', status: 'active', rosterCount: 3, revision: 1,
  upcoming: [{ revision: 2, effectiveDate: '2026-11-01', status: 'inactive', teacher: 'Ana', courseLocation: 'Bound Brook' }] };

function render(capabilities, extra = {}) {
  return renderToStaticMarkup(createElement(ClassManagementWorkspace, {
    businessUnitId: 'usa', today: '2026-10-05', initialState: {
      sections: [section], capabilities, open: true, ...extra,
    },
  }));
}

test('rendered manager form shows effective-date preview, roster conflict and disabled save', () => {
  const html = render({ canManage: true }, { selectedId: 'section-1', form: { ...section, effectiveDate: '2026-11-01', status: 'inactive' }, preview: { effectiveDate: '2026-11-01',
    activeEnrollmentsSpanningDate: 3, upcomingDates: [], willBlockDeactivation: true } });
  assert.match(html, /type="date"/);
  assert.match(html, /Scheduled changes/);
  assert.match(html, /3 active enrollments span this date/);
  assert.match(html, /End or transition spanning enrollments/);
  assert.match(html, /<button type="submit"[^>]*disabled=""[^>]*>Save class change<\/button>/);
});

test('rendered regular coordinator has catalog but no management controls or future schedule', () => {
  const html = render({ canManage: false }, { error: 'Catalog unavailable.' });
  assert.match(html, /English · ENG-1/);
  assert.match(html, /role="alert"[^>]*>Catalog unavailable/);
  assert.doesNotMatch(html, /type="date"/);
  assert.doesNotMatch(html, /Scheduled changes|2026-11-01|Save class change/);
});
