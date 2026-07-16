import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTaskScopePreview,
  buildTeamMonitorPageModel,
  buildTeamMonitorSummary,
  buildTeamMonitorViewModel,
  canUseTeamMonitor,
  filterTeamMonitorRows,
} from './team-monitor.js';

const employees = [
  { id: 'u-admin', name: 'Admin Owner', roleKeys: ['admin'] },
  { id: 'u-one', name: 'Sofia', roleKeys: ['account_coordinator'] },
  { id: 'u-two', name: 'Mateo', roleKeys: ['account_coordinator'] },
];

test('team monitor access is limited to admin roles', () => {
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'admin' }), true);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'senior_coordinator' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'account_coordinator' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'sales_manager' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'account_coordinator', canAccessAllBusinessUnits: true }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'senior_coordinator', canAccessAllBusinessUnits: true }), false);
});

test('team monitor view model summarizes existing CRM tasks without new entities', () => {
  const viewModel = buildTeamMonitorViewModel({
    employees,
    currentUser: { id: 'u-admin', primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [
      {
        id: 't-1',
        title: 'Call Acme',
        ownerUserId: 'u-one',
        status: 'open',
        dueAt: '2026-07-08T15:00:00Z',
        updatedAt: '2026-07-08T14:00:00Z',
      },
      {
        id: 't-2',
        title: 'Overdue estimate',
        ownerUserId: 'u-two',
        status: 'open',
        dueAt: '2026-07-07T15:00:00Z',
      },
      {
        id: 't-3',
        title: 'Completed upload',
        ownerUserId: 'u-one',
        status: 'completed',
        completed: true,
        completedAt: '2026-07-08T13:00:00Z',
        dueAt: '2026-07-08T10:00:00Z',
      },
    ],
    contacts: [
      {
        id: 'c-1',
        workflowKey: 'ait_usa',
        status: 'Enrolled',
        assignedTo: 'u-one',
        enrollmentStatusChangedAt: '2026-07-08T12:00:00Z',
        courseRecords: [{ id: 'cr-1', status: 'active', startDate: '2026-07-08' }],
      },
      {
        id: 'c-2',
        workflowKey: 'ait_usa',
        status: 'Dropped / Quit',
        assignedTo: 'u-two',
        courseRecords: [{ id: 'cr-2', status: 'cancelled', endDate: '2026-07-07' }],
      },
      {
        id: 'c-3',
        workflowKey: 'ait_usa',
        status: 'Follow Up',
        assignedTo: 'u-one',
        leadCreatedAt: '2026-07-08T12:00:00Z',
      },
      {
        id: 'c-4',
        workflowKey: 'ait_usa',
        status: 'Retargeting',
        assignedTo: 'u-one',
        leadCreatedAt: '2026-07-08T12:00:00Z',
      },
    ],
  });

  assert.equal(viewModel.summary.onlineNow, 1);
  assert.equal(viewModel.summary.dueToday, 1);
  assert.equal(viewModel.summary.overdue, 1);
  assert.equal(viewModel.summary.enrollmentsToday, 1);
  assert.equal(viewModel.summary.enrollmentsThisWeek, 1);
  assert.equal(viewModel.summary.cancellationsThisWeek, 1);
  assert.equal(viewModel.summary.assignedContacts, 4);
  assert.equal(viewModel.canUseTeamMonitor, true);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-two').signal, 'Behind');
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').progressDone, 1);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').enrollmentsThisWeekCount, 1);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').assignedContactCount, 3);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-two').cancellationsThisWeekCount, 1);
});

test('dashboard task preview scopes my, team, and all employee tasks', () => {
  const tasks = [
    { id: 'mine', title: 'Mine', ownerUserId: 'u-admin', status: 'open', dueAt: '2026-07-08T15:00:00Z' },
    { id: 'team', title: 'Team', ownerUserId: 'u-one', status: 'open', dueAt: '2026-07-08T15:00:00Z' },
    { id: 'unassigned', title: 'Unassigned', status: 'open', dueAt: '2026-07-08T15:00:00Z' },
  ];

  assert.deepEqual(
    buildTaskScopePreview({ tasks, employees, currentUser: { id: 'u-admin' }, scope: 'mine', today: '2026-07-08' }).map((task) => task.id),
    ['mine'],
  );
  assert.deepEqual(
    buildTaskScopePreview({ tasks, employees, currentUser: { id: 'u-admin' }, scope: 'team', today: '2026-07-08' }).map((task) => task.id),
    ['mine', 'team'],
  );
  assert.deepEqual(
    buildTaskScopePreview({ tasks, employees, currentUser: { id: 'u-admin' }, scope: 'all', filter: 'unassigned', today: '2026-07-08' }).map((task) => task.id),
    ['unassigned'],
  );
});

test('team monitor page metrics reconcile employee rows with the explicit unassigned bucket', () => {
  const viewModel = buildTeamMonitorPageModel({
    employees: employees.slice(1),
    currentUser: { id: 'u-admin', primaryRoleKey: 'admin' },
    period: 'today',
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [
      { id: 'completed', ownerUserId: 'u-one', status: 'completed', completedAt: '2026-07-08T10:00:00Z' },
      { id: 'due', ownerUserId: 'u-one', status: 'open', dueAt: '2026-07-08T19:00:00Z' },
      { id: 'overdue', ownerUserId: 'u-two', status: 'open', dueAt: '2026-07-07T19:00:00Z' },
      { id: 'unassigned', status: 'open', dueAt: '2026-07-09T19:00:00Z' },
      { id: 'outside-roster', ownerUserId: 'u-other', status: 'open', dueAt: '2026-07-09T19:00:00Z' },
      { id: 'next-follow-up', ownerUserId: 'u-one', contactId: 'active-covered', taskType: 'follow_up', status: 'open', dueAt: '2026-07-09T19:00:00Z' },
    ],
    contacts: [
      { id: 'active-covered', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-one', lastStructuredFollowUpAt: '2026-07-08T09:00:00Z' },
      { id: 'active-missing', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-one' },
      { id: 'active-unassigned', workflowKey: 'ait_usa', status: 'Follow Up' },
      { id: 'enrolled', workflowKey: 'ait_usa', status: 'Enrolled', assignedTo: 'u-one', enrollmentStatusChangedAt: '2026-07-08T12:00:00Z' },
      { id: 'cancelled', workflowKey: 'ait_usa', status: 'Dropped / Quit', assignedTo: 'u-two', droppedStatusChangedAt: '2026-07-08T12:30:00Z' },
    ],
  });

  const sofia = viewModel.roster.find((employee) => employee.id === 'u-one');
  assert.equal(viewModel.summary.completedTasks, 1);
  assert.equal(viewModel.summary.dueToday, 1);
  assert.equal(viewModel.summary.overdue, 1);
  assert.equal(viewModel.summary.unassignedOpenTasks, 1);
  assert.equal(viewModel.summary.openTasks, 5);
  assert.equal(viewModel.summary.taskProgressTotal, 6);
  assert.equal(viewModel.summary.assignedContacts, 4);
  assert.equal(viewModel.summary.activeAssignedContacts, 2);
  assert.equal(viewModel.summary.unassignedActiveContacts, 1);
  assert.equal(viewModel.summary.contactsWithoutNextFollowUp, 2);
  assert.equal(viewModel.summary.recentStructuredFollowUps, 1);
  assert.equal(viewModel.summary.enrollments, 1);
  assert.equal(viewModel.summary.cancellations, 1);
  assert.equal(viewModel.unassigned.unattributedTasks, 1);
  assert.equal(sofia.contactsWithoutNextFollowUp, 1);
  assert.equal(sofia.taskProgressTotal, 3);
  assert.equal(sofia.contactHref, '/contacts?owner=u-one');
  assert.equal(sofia.signal, 'Needs attention');
  assert.equal(viewModel.reconciliation.openTasks, 5);
  assert.equal(viewModel.reconciliation.completedTasks, viewModel.summary.completedTasks);
});

test('team monitor period changes completed, follow-up, and enrollment measures without changing current due state', () => {
  const args = {
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [
      { id: 'today-completed', ownerUserId: 'u-one', status: 'completed', completedAt: '2026-07-08T10:00:00Z' },
      { id: 'monday-completed', ownerUserId: 'u-one', status: 'completed', completedAt: '2026-07-06T10:00:00Z' },
      { id: 'due', ownerUserId: 'u-one', status: 'open', dueAt: '2026-07-08T20:00:00Z' },
    ],
    contacts: [
      { id: 'follow-up', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-one', lastStructuredFollowUpAt: '2026-07-06T12:00:00Z' },
      { id: 'enrolled', workflowKey: 'ait_usa', status: 'Enrolled', assignedTo: 'u-one', enrollmentStatusChangedAt: '2026-07-06T10:00:00Z' },
    ],
  };
  const todayModel = buildTeamMonitorPageModel({ ...args, period: 'today' });
  const weekModel = buildTeamMonitorPageModel({ ...args, period: 'week' });

  assert.equal(todayModel.summary.completedTasks, 1);
  assert.equal(weekModel.summary.completedTasks, 2);
  assert.equal(todayModel.summary.recentStructuredFollowUps, 0);
  assert.equal(weekModel.summary.recentStructuredFollowUps, 1);
  assert.equal(todayModel.summary.enrollments, 0);
  assert.equal(weekModel.summary.enrollments, 1);
  assert.equal(todayModel.summary.dueToday, 1);
  assert.equal(weekModel.summary.dueToday, 1);
});

test('team monitor counts only explicit structured follow-up outcomes in the selected period', () => {
  const args = {
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    contacts: [
      { id: 'generic-touch', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-one', lastFollowUpTouch: '2026-07-08T10:00:00Z' },
      { id: 'monday-outcome', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-one', lastStructuredFollowUpAt: '2026-07-06T23:59:59Z' },
      { id: 'today-outcome', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: 'u-two', lastStructuredFollowUpAt: '2026-07-08T00:00:00Z' },
    ],
  };

  assert.equal(buildTeamMonitorPageModel({ ...args, period: 'today' }).summary.recentStructuredFollowUps, 1);
  assert.equal(buildTeamMonitorPageModel({ ...args, period: 'week' }).summary.recentStructuredFollowUps, 2);
});

test('team monitor completed counts require explicit completion timestamps in both monitor models', () => {
  const args = {
    employees: employees.slice(1),
    currentUser: { id: 'u-admin', primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [
      { id: 'updated-only', ownerUserId: 'u-one', status: 'completed', updatedAt: '2026-07-08T10:00:00Z' },
      { id: 'date-only', ownerUserId: 'u-one', status: 'completed', completedDate: '2026-07-08T11:00:00Z' },
      { id: 'outside-week', ownerUserId: 'u-two', status: 'completed', completedAt: '2026-07-05T23:59:59Z' },
    ],
  };

  const todayModel = buildTeamMonitorPageModel({ ...args, period: 'today' });
  const weekModel = buildTeamMonitorPageModel({ ...args, period: 'week' });
  const legacyModel = buildTeamMonitorViewModel(args);

  assert.equal(todayModel.summary.completedTasks, 1);
  assert.equal(weekModel.summary.completedTasks, 1);
  assert.equal(legacyModel.roster.find((employee) => employee.id === 'u-one').progressDone, 1);
});

test('filtered team monitor summary reconciles displayed rows with the unassigned bucket', () => {
  const model = buildTeamMonitorPageModel({
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [
      { id: 'sofia-overdue', ownerUserId: 'u-one', status: 'open', dueAt: '2026-07-07T10:00:00Z' },
      { id: 'mateo-completed', ownerUserId: 'u-two', status: 'completed', completedAt: '2026-07-08T10:00:00Z' },
      { id: 'unassigned', status: 'open', dueAt: '2026-07-08T10:00:00Z' },
    ],
  });
  const visibleRows = filterTeamMonitorRows({ roster: model.roster, unassigned: model.unassigned, attention: 'attention' });
  const visibleRoster = visibleRows.filter((employee) => !employee.isUnassignedBucket);
  const visibleUnassigned = visibleRows.find((employee) => employee.isUnassignedBucket);
  const summary = buildTeamMonitorSummary({ roster: visibleRoster, unassigned: visibleUnassigned });

  assert.equal(visibleRoster.length, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.completedTasks, 0);
  assert.equal(summary.unassignedOpenTasks, 1);
  assert.equal(model.summary.completedTasks, 1);
});

test('attention filters never append an empty or contradictory unassigned bucket', () => {
  const model = buildTeamMonitorPageModel({
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [{ id: 'sofia-overdue', ownerUserId: 'u-one', status: 'open', dueAt: '2026-07-07T10:00:00Z' }],
  });

  const attentionRows = filterTeamMonitorRows({ roster: model.roster, unassigned: model.unassigned, attention: 'attention' });
  const noWorkRows = filterTeamMonitorRows({ roster: model.roster, unassigned: model.unassigned, attention: 'no-work' });

  assert.deepEqual(attentionRows.map((row) => row.id), ['u-one']);
  assert.deepEqual(noWorkRows.map((row) => row.id), ['u-two']);
  assert.equal(attentionRows.some((row) => row.isUnassignedBucket), false);
  assert.equal(noWorkRows.some((row) => row.isUnassignedBucket), false);
});

test('unattributed allowed-division tasks reconcile without exposing or treating an outside owner as unassigned', () => {
  const model = buildTeamMonitorPageModel({
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    tasks: [{
      id: 'outside-owner', status: 'open', taskType: 'follow_up', dueAt: '2026-07-08T10:00:00Z',
      ownerUserId: '', unattributedOwner: true,
    }],
  });

  assert.equal(model.unassigned.unassignedOpenTasks, 0);
  assert.equal(model.unassigned.unattributedTasks, 1);
  assert.equal(model.unassigned.dueToday, 1);
  assert.equal(model.reconciliation.openTasks, 1);
});

test('unattributed contact ownership stays opaque and is not counted as unassigned', () => {
  const model = buildTeamMonitorPageModel({
    employees: employees.slice(1),
    currentUser: { primaryRoleKey: 'admin' },
    contacts: [{
      id: 'outside-owner-contact', workflowKey: 'ait_usa', status: 'Follow Up', assignedTo: '', unattributedOwner: true,
    }],
  });

  assert.equal(model.unassigned.unattributedContacts, 1);
  assert.equal(model.unassigned.activeAssignedContacts, 1);
  assert.equal(model.summary.unattributedContacts, 1);
  assert.equal(model.summary.activeAssignedContacts, 1);
});

test('weekly owner metrics require enrolled contact status and explicit movement dates', () => {
  const viewModel = buildTeamMonitorViewModel({
    employees,
    currentUser: { id: 'u-admin', primaryRoleKey: 'admin' },
    today: '2026-07-08',
    now: new Date('2026-07-08T18:00:00Z').getTime(),
    contacts: [
      {
        id: 'old-enrolled',
        workflowKey: 'ait_usa',
        status: 'Enrolled',
        assignedTo: 'u-one',
        lastEdited: '2026-07-08T12:00:00Z',
        leadCreatedAt: '2026-07-08T12:00:00Z',
      },
      {
        id: 'old-dropped',
        workflowKey: 'ait_usa',
        status: 'Dropped / Quit',
        assignedTo: 'u-two',
        lastEdited: '2026-07-08T12:00:00Z',
        leadCreatedAt: '2026-07-08T12:00:00Z',
        courseRecords: [{ id: 'no-end-date', status: 'cancelled', updatedAt: '2026-07-08T12:00:00Z' }],
      },
      {
        id: 'course-only',
        workflowKey: 'ait_usa',
        status: 'Follow Up',
        assignedTo: 'u-one',
        enrollmentStatusChangedAt: '2026-07-08T12:00:00Z',
        courseRecords: [{ id: 'active-course', status: 'active', startDate: '2026-07-08' }],
      },
    ],
  });

  assert.equal(viewModel.summary.enrollmentsThisWeek, 0);
  assert.equal(viewModel.summary.cancellationsThisWeek, 0);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').enrolledTotalCount, 1);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').enrollmentsThisWeekCount, 0);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-two').cancellationsThisWeekCount, 0);
});
