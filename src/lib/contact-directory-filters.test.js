import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCourseFilterOptions,
  buildLocationFilterOptions,
  buildSourceFilterOptions,
  contactMatchesLocation,
  contactMatchesLeadDateScope,
  contactLeadDatePanelSummary,
  contactLeadDateScopeLabel,
  contactFilterQuery,
  contactFilterStateFromParams,
  contactMatchesSource,
  contactMatchesStatusOwnerCourse,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  DEFAULT_CONTACT_LOCATION_FILTER,
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_QUARTER,
  courseForContactDirectoryFilter,
  courseTagsForDirectoryRow,
  effectiveLeadDateScopeForDirectory,
  pipelineFilterQuery,
  pipelineFilterStateFromParams,
} from './contact-directory-filters.js';

test('contact filter params parse status, source, course, date, owner, and facet state', () => {
  const params = new URLSearchParams('status=Course+Completed&source=WordPress+Website+Form&course=Forklift&location=Plainfield&leadDateScope=custom&leadDateFrom=2026-01-01&leadDateTo=2026-06-30&owner=user-1&facet=usa_course_completed');

  assert.deepEqual(contactFilterStateFromParams(params), {
    statusFilter: 'Course Completed',
    ownerFilter: 'user-1',
    directoryFacet: 'usa_course_completed',
    leadDateScope: 'custom',
    leadDateFrom: '2026-01-01',
    leadDateTo: '2026-06-30',
    courseFilter: 'Forklift',
    sourceFilter: 'WordPress Website Form',
    locationFilter: 'Plainfield',
  });
  assert.equal(
    contactFilterQuery({ ...contactFilterStateFromParams(params), includeLeadDateScope: true }),
    'leadDateScope=custom&leadDateFrom=2026-01-01&leadDateTo=2026-06-30&owner=user-1&status=Course+Completed&source=WordPress+Website+Form&facet=usa_course_completed&course=Forklift&location=Plainfield',
  );
});

test('contact filter query omits default filters', () => {
  assert.equal(contactFilterQuery(), '');
  assert.equal(
    contactFilterQuery({ statusFilter: 'Enrolled', sourceFilter: 'Website', courseFilter: 'OSHA', locationFilter: 'Online' }),
    'status=Enrolled&source=Website&course=OSHA&location=Online',
  );
});

test('owner filters can preserve explicit current-year lead date scope', () => {
  assert.equal(
    contactFilterQuery({ leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE, includeLeadDateScope: true }),
    'leadDateScope=current',
  );
  assert.equal(
    pipelineFilterQuery({ leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE, includeLeadDateScope: true }),
    'leadDateScope=current',
  );
  assert.equal(
    contactFilterQuery({ ownerFilter: 'user-1', leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE }),
    'owner=user-1',
  );
  assert.equal(
    pipelineFilterQuery({ ownerFilter: 'user-1', leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE }),
    'owner=user-1',
  );
  assert.equal(
    contactFilterQuery({ ownerFilter: 'user-1', leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE, includeLeadDateScope: true }),
    'leadDateScope=current&owner=user-1',
  );
  assert.equal(
    pipelineFilterQuery({ ownerFilter: 'user-1', leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE, includeLeadDateScope: true }),
    'leadDateScope=current&owner=user-1',
  );
  assert.equal(
    contactFilterStateFromParams(new URLSearchParams('leadDateScope=current&owner=user-1')).leadDateScope,
    DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  );
});

test('directory date scope defaults to no date limit until a date filter is explicit', () => {
  const now = new Date('2026-06-24T00:00:00.000Z');
  const rows = [
    { id: 'current', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2026-02-01T12:00:00.000Z' },
    { id: 'prior', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2025-11-20T12:00:00.000Z' },
  ];

  assert.equal(
    effectiveLeadDateScopeForDirectory({
      leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
      hasExplicitLeadDateFilter: false,
    }),
    CONTACT_LEAD_DATE_SCOPE_ALL,
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, {
        leadDateScope: effectiveLeadDateScopeForDirectory({
          leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
          hasExplicitLeadDateFilter: false,
        }),
        now,
      }))
      .map((contact) => contact.id),
    ['current', 'prior'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, {
        leadDateScope: effectiveLeadDateScopeForDirectory({
          leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
          hasExplicitLeadDateFilter: true,
        }),
        now,
      }))
      .map((contact) => contact.id),
    ['current'],
  );
});

test('lead date scopes support quarter, current year, all leads, and custom time frames', () => {
  const now = new Date('2026-06-24T00:00:00.000Z');
  const rows = [
    { id: 'current', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2026-02-01T12:00:00.000Z' },
    { id: 'quarter', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2026-05-01T12:00:00.000Z' },
    { id: 'prior', workflowKey: 'ait_usa', status: 'New Lead', leadCreatedAt: '2025-11-20T12:00:00.000Z' },
    { id: 'terminal', workflowKey: 'ait_usa', status: 'Dropped / Quit', leadCreatedAt: '2026-04-10T12:00:00.000Z' },
    { id: 'undated', workflowKey: 'default', status: 'New Lead' },
  ];

  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, { now }))
      .map((contact) => contact.id),
    ['current', 'quarter', 'undated'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, { leadDateScope: CONTACT_LEAD_DATE_SCOPE_QUARTER, now }))
      .map((contact) => contact.id),
    ['quarter', 'terminal'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLeadDateScope(contact, { leadDateScope: 'all', now }))
      .map((contact) => contact.id),
    ['current', 'quarter', 'prior', 'terminal', 'undated'],
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
  assert.equal(
    contactFilterQuery({ leadDateScope: CONTACT_LEAD_DATE_SCOPE_QUARTER, includeLeadDateScope: true }),
    'leadDateScope=quarter',
  );
});

test('lead date display helpers keep preset and custom copy consistent', () => {
  assert.equal(contactLeadDateScopeLabel(DEFAULT_CONTACT_LEAD_DATE_SCOPE), 'Current Year');
  assert.equal(contactLeadDateScopeLabel(CONTACT_LEAD_DATE_SCOPE_QUARTER), 'This Quarter');
  assert.equal(
    contactLeadDateScopeLabel('custom', '2026-01-01', '2026-06-30'),
    '2026-01-01 to 2026-06-30',
  );

  assert.deepEqual(contactLeadDatePanelSummary(DEFAULT_CONTACT_LEAD_DATE_SCOPE), {
    mode: 'preset',
    label: 'Timeframe',
    value: 'Year-to-date',
    detail: 'Dates are applied automatically for the current calendar year.',
  });
  assert.deepEqual(contactLeadDatePanelSummary(CONTACT_LEAD_DATE_SCOPE_QUARTER), {
    mode: 'preset',
    label: 'Timeframe',
    value: 'Quarter-to-date',
    detail: 'Dates are applied automatically for the current quarter.',
  });
  assert.deepEqual(contactLeadDatePanelSummary('custom', '2026-01-01', '2026-06-30'), {
    mode: 'custom',
    label: 'Custom range',
    value: '2026-01-01 to 2026-06-30',
    detail: 'Selected dates are applied to the contact list.',
  });
});

test('pipeline filter params preserve date, owner, status, source, course, activity, search, and compact state', () => {
  const params = new URLSearchParams('leadDateScope=custom&leadDateFrom=2026-02-01&leadDateTo=2026-05-30&workflow=new_leads&owner=unassigned&status=New+Lead&source=Website&course=OSHA&location=Flemington&activity=recent_7&q=anna&compact=0');

  assert.deepEqual(pipelineFilterStateFromParams(params), {
    workflowFilter: 'all',
    statusFilter: 'New Lead',
    ownerFilter: 'unassigned',
    sourceFilter: 'Website',
    courseFilter: 'OSHA',
    locationFilter: 'Flemington',
    activityFilter: 'recent_7',
    search: 'anna',
    leadDateScope: 'custom',
    leadDateFrom: '2026-02-01',
    leadDateTo: '2026-05-30',
    compactMode: false,
  });
  assert.equal(
    pipelineFilterQuery({ ...pipelineFilterStateFromParams(params), includeLeadDateScope: true }),
    'leadDateScope=custom&leadDateFrom=2026-02-01&leadDateTo=2026-05-30&owner=unassigned&status=New+Lead&source=Website&course=OSHA&location=Flemington&activity=recent_7&q=anna&compact=0',
  );
});

test('learning location filters use only the approved catalog and ignore student geography', () => {
  const rows = [
    { id: 'plainfield', address: 'Plainfield' },
    { id: 'piscataway', locationPreference: 'Piscataway' },
    { id: 'online', enrollmentSignals: { inquiry: { location: 'Online' } } },
    { id: 'madrid-online', address: 'Online', locationPreference: 'Madrid, Spain' },
    { id: 'legacy-newark', address: 'Newark', locationPreference: 'Newark' },
  ];

  assert.deepEqual(
    buildLocationFilterOptions(rows).map((option) => [option.label, option.count]),
    [
      ['Bound Brook', 0],
      ['Plainfield', 1],
      ['Piscataway', 0],
      ['Flemington', 0],
      ['Online', 1],
    ],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLocation(contact, { locationFilter: 'Piscataway' }))
      .map((contact) => contact.id),
    [],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLocation(contact, { locationFilter: 'Madrid, Spain' }))
      .map((contact) => contact.id),
    ['plainfield', 'piscataway', 'online', 'madrid-online', 'legacy-newark'],
  );
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesLocation(contact, { locationFilter: DEFAULT_CONTACT_LOCATION_FILTER }))
      .map((contact) => contact.id),
    ['plainfield', 'piscataway', 'online', 'madrid-online', 'legacy-newark'],
  );
  assert.equal(contactFilterStateFromParams(new URLSearchParams('location=Madrid%2C+Spain')).locationFilter, DEFAULT_CONTACT_LOCATION_FILTER);
  assert.equal(pipelineFilterStateFromParams(new URLSearchParams('location=Newark')).locationFilter, DEFAULT_CONTACT_LOCATION_FILTER);
  assert.equal(contactFilterQuery({ locationFilter: 'Newark' }), '');
  assert.equal(pipelineFilterQuery({ locationFilter: 'Madrid, Spain' }), '');
});

test('contact source filter options use directory source labels', () => {
  const contacts = [
    { id: 'wordpress', source: 'WordPress Website Form' },
    { id: 'workbook', sourceCategory: 'Workbook Import', source: 'work_order' },
    { id: 'wordpress-2', source: 'WordPress Website Form' },
  ];

  assert.deepEqual(
    buildSourceFilterOptions(contacts).map((option) => [option.label, option.count]),
    [['WordPress Website Form', 2], ['Workbook Import', 1]],
  );
  assert.deepEqual(
    contacts
      .filter((contact) => contactMatchesSource(contact, { sourceFilter: 'WordPress Website Form' }))
      .map((contact) => contact.id),
    ['wordpress', 'wordpress-2'],
  );
});

test('status and course filters compose across AIT USA course outcomes', () => {
  const contacts = [
    {
      id: 'enrolled-osha',
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      assignedTo: 'user-1',
      enrollmentSignals: { course: { current: 'OSHA' } },
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
      enrollmentSignals: { course: { current: 'OSHA' } },
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

test('course filters prefer course records and match historical courses', () => {
  const rows = [
    {
      id: 'repeat-student',
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      assignedTo: 'user-1',
      courseRecords: [
        { id: '3', courseName: 'Forklift', status: 'active', statusLabel: 'Current', startDate: '2026-07-01' },
        { id: '2', courseName: 'OSHA 30', status: 'cancelled', statusLabel: 'Cancelled', endDate: '2026-06-15', outcomeReason: 'cancelled halfway' },
        { id: '1', courseName: 'ESL Level 1', status: 'completed', statusLabel: 'Completed', endDate: '2026-05-01' },
      ],
      enrollmentSignals: { course: { current: 'Legacy Course' } },
    },
  ];

  assert.equal(courseForContactDirectoryFilter(rows[0]), 'Forklift');
  assert.deepEqual(courseTagsForDirectoryRow(rows[0]), ['Forklift']);
  assert.deepEqual(
    rows
      .filter((contact) => contactMatchesStatusOwnerCourse(contact, { courseFilter: 'OSHA 30' }))
      .map((contact) => contact.id),
    ['repeat-student'],
  );
  assert.deepEqual(
    buildCourseFilterOptions(rows).map((option) => [option.label, option.count]),
    [['ESL Level 1', 1], ['Forklift', 1], ['OSHA 30', 1]],
  );
});

test('course filter does not treat Wix form service or program interest as course metadata', () => {
  const rows = [
    {
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      programInterest: 'Wix Contact Form - English Interest',
      enrollmentSignals: {
        inquiry: { programInterest: 'ESL' },
      },
    },
    {
      workflowKey: 'ait_usa',
      status: 'Course Completed',
      enrollmentSignals: {
        inquiry: { service: 'Website English Form' },
      },
    },
    {
      workflowKey: 'ait_usa',
      status: 'Enrolled',
      enrollmentSignals: {
        course: { current: 'OSHA 30' },
        inquiry: { programInterest: 'Wix OSHA Form' },
      },
    },
  ];

  assert.equal(courseForContactDirectoryFilter(rows[0]), '');
  assert.equal(courseForContactDirectoryFilter(rows[1]), '');
  assert.equal(courseForContactDirectoryFilter(rows[2]), 'OSHA 30');
  assert.deepEqual(
    buildCourseFilterOptions(rows).map((option) => [option.label, option.count]),
    [['OSHA 30', 1]],
  );
});
