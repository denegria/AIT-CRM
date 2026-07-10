import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTaskScopePreview,
  buildTeamMonitorViewModel,
  canUseTeamMonitor,
} from './team-monitor.js';

const employees = [
  { id: 'u-admin', name: 'Admin Owner', roleKeys: ['admin'] },
  { id: 'u-one', name: 'Sofia', roleKeys: ['account_manager'] },
  { id: 'u-two', name: 'Mateo', roleKeys: ['account_manager'] },
];

test('team monitor access is limited to admin roles', () => {
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'admin' }), true);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'senior_coordinator' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'account_manager' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'sales_manager' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'account_manager', canAccessAllBusinessUnits: true }), false);
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
