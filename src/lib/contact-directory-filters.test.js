import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCourseFilterOptions,
  contactMatchesLeadDateScope,
  contactFilterQuery,
  contactFilterStateFromParams,
  contactMatchesStatusOwnerCourse,
  courseForContactDirectoryFilter,
  courseTagsForDirectoryRow,
  pipelineFilterQuery,
  pipelineFilterStateFromParams,
} from './contact-directory-filters.js';

test('contact filter params parse status, course, date, owner, and facet state', () => {
  const params = new URLSearchParams('status=Course+Completed&course=Forklift&leadDateScope=custom&leadDateFrom=2026-01-01&leadDateTo=2026-06-30&owner=user-1&facet=usa_course_completed');

  assert.deepEqual(contactFilterStateFromParams(params), {
    statusFilter: 'Course Completed',
    ownerFilter: 'user-1',
    directoryFacet: 'usa_course_completed',
    leadDateScope: 'custom',
    leadDateFrom: '2026-01-01',
    leadDateTo: '2026-06-30',
    courseFilter: 'Forklift',
  });
  assert.equal(
    contactFilterQuery(contactFilterStateFromParams(params)),
    'leadDateScope=custom&leadDateFrom=2026-01-01&leadDateTo=2026-06-30&status=Course+Completed&owner=user-1&facet=usa_course_completed&course=Forklift',
  );
});

test('contact filter query omits default filters', () => {
  assert.equal(contactFilterQuery(), '');
  assert.equal(
    contactFilterQuery({ statusFilter: 'Enrolled', courseFilter: 'OSHA' }),
    'status=Enrolled&course=OSHA',
  );
});

test('lead date scopes support current year, all leads, and custom time frames', () => {
  const now = new Date('2026-06-24T00:00:00.000Z');
  const rows = [
    { id: 'current', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2026-02-01T12:00:00.000Z' },
    { id: 'prior', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2025-11-20T12:00:00.000Z' },
    { id: 'terminal', workflowKey: 'ait_usa', status: 'Dropped / Quit', leadCreatedAt: '2026-04-10T12:00:00.000Z' },
    { id: 'undated', workflowKey: 'default', status: 'New Lead' },
  ];

  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, { now }))
      .map((contact) => contact.id),
    ['current', 'undated'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, { leadDateScope: 'all', now }))
      .map((contact) => contact.id),
    ['current', 'prior', 'terminal', 'undated'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, {
        leadDateScope: 'custom',
        leadDateFrom: '2025-10-01',
        leadDateTo: '2026-03-01',
        now,
      }))
      .map((contact) => contact.id),
    ['current', 'prior'],
  );
});

test('pipeline filter params preserve date, owner, source, bucket, search, and compact state', () => {
  const params = new URLSearchParams('leadDateScope=custom&leadDateFrom=2026-02-01&leadDateTo=2026-05-30&workflow=needs_first_outreach&owner=unassigned&source=Website&activity=recent_7&q=anna&compact=0');

  assert.deepEqual(pipelineFilterStateFromParams(params), {
    workflowFilter: 'needs_first_outreach',
    ownerFilter: 'unassigned',
    sourceFilter: 'Website',
    activityFilter: 'recent_7',
    search: 'anna',
    leadDateScope: 'custom',
    leadDateFrom: '2026-02-01',
    leadDateTo: '2026-05-30',
    compactMode: false,
  });
  assert.equal(
    pipelineFilterQuery(pipelineFilterStateFromParams(params)),
    'leadDateScope=custom&leadDateFrom=2026-02-01&leadDateTo=2026-05-30&workflow=needs_first_outreach&owner=unassigned&source=Website&activity=recent_7&q=anna&compact=0',
  );
});

test('status and course filters compose across AIT USA course outcomes', () => {
  const contacts = [
    {
      id: 'enrolled-osha',
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      assignedTo: 'user-1',
      enrollmentSignals: { course: { current: 'OSHA', enrolled: 'OSHA' } },
    },
    {
      id: 'completed-forklift',
      workflowKey: 'ait_usa',
      status: 'Course Completed',
      assignedTo: 'user-1',
      enrollmentSignals: { course: { completed: 'Forklift', ended: 'Forklift' } },
    },
    {
      id: 'quit-english',
      workflowKey: 'ait_usa',
      status: 'Dropped / Quit',
      assignedTo: 'user-2',
      enrollmentSignals: { course: { ended: 'English', outcome: 'dropped' } },
    },
  ];

  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'Enrolled', courseFilter: 'OSHA' }))
      .map((contact) => contact.id),
    ['enrolled-osha'],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'Course Completed', courseFilter: 'Forklift' }))
      .map((contact) => contact.id),
    ['completed-forklift'],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'Dropped / Quit', courseFilter: 'English' }))
      .map((contact) => contact.id),
    ['quit-english'],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { courseFilter: 'English', ownerFilter: 'user-2' }))
      .map((contact) => contact.id),
    ['quit-english'],
  );
});

test('status filter uses AIT USA lifecycle aliases for raw status and currentStage rows', () => {
  const contacts = [
    {
      id: 'quit-status',
      workflowKey: 'ait_usa',
      status: 'quit course',
      enrollmentSignals: { course: { ended: 'English', outcome: 'quit_mid_course' } },
    },
    {
      id: 'withdrawn-stage',
      workflowKey: 'ait_usa',
      status: 'Follow Up',
      currentStage: 'withdrawn',
      enrollmentSignals: { course: { ended: 'English', outcome: 'withdrawn' } },
    },
    {
      id: 'completed-alias-stage',
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      currentStage: 'completed previous student',
      enrollmentSignals: { course: { completed: 'Forklift', ended: 'Forklift', outcome: 'completed' } },
    },
  ];

  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'Dropped / Quit', courseFilter: 'English' }))
      .map((contact) => contact.id),
    ['quit-status', 'withdrawn-stage'],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'quit course', courseFilter: 'English' }))
      .map((contact) => contact.id),
    ['quit-status', 'withdrawn-stage'],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { statusFilter: 'Course Completed', courseFilter: 'Forklift' }))
      .map((contact) => contact.id),
    ['completed-alias-stage'],
  );
});

test('course options and tags use MIS-210 enrollment metadata selectors', () => {
  const rows = [
    {
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      enrollmentSignals: { course: { current: 'OSHA', enrolled: 'OSHA' } },
    },
    {
      workflowKey: 'ait_usa',
      status: 'Dropped / Quit',
      enrollmentSignals: { course: { current: 'ESL', ended: 'English', outcome: 'quit_mid_course' } },
    },
    {
      workflowKey: 'ait_usa',
      status: 'Course Completed',
      enrollmentSignals: { course: { completed: 'Forklift', ended: 'Forklift', outcome: 'completed' } },
    },
  ];

  assert.equal(courseForContactDirectoryFilter(rows[0]), 'OSHA');
  assert.equal(courseForContactDirectoryFilter(rows[1]), 'English');
  assert.equal(courseForContactDirectoryFilter(rows[2]), 'Forklift');
  assert.deepEqual(
    buildCourseFilterOptions(rows).map((option) => [option.label, option.count]),
    [['English', 1], ['Forklift', 1], ['OSHA', 1]],
  );
  assert.deepEqual(courseTagsForDirectoryRow(rows[0]), ['OSHA']);
  assert.deepEqual(courseTagsForDirectoryRow(rows[1]), ['English', 'Quit Mid Course']);
  assert.deepEqual(courseTagsForDirectoryRow(rows[2]), ['Forklift']);
});
