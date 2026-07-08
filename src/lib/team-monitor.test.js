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

test('team monitor access is limited to admin and senior coordinator roles', () => {
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'admin' }), true);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'senior_coordinator' }), true);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'account_manager' }), false);
  assert.equal(canUseTeamMonitor({ primaryRoleKey: 'sales_manager' }), false);
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
  });

  assert.equal(viewModel.summary.onlineNow, 1);
  assert.equal(viewModel.summary.dueToday, 1);
  assert.equal(viewModel.summary.overdue, 1);
  assert.equal(viewModel.canUseTeamMonitor, true);
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-two').signal, 'Behind');
  assert.equal(viewModel.roster.find((employee) => employee.id === 'u-one').progressDone, 1);
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
