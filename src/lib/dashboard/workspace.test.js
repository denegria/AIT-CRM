import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardContactFilter, dashboardContactHref, dashboardTaskScope } from './workspace.js';

test('personal contact card queries and links share exact directory filters', () => {
  assert.deepEqual(dashboardContactFilter('myNewLeads', 'user-1'), {
    leadDateScope: 'current', status: 'New Lead', owner: 'user-1',
  });
  assert.deepEqual(dashboardContactFilter('myNeedsNextFollowUp', 'user-1'), {
    leadDateScope: 'all', facet: 'needs_next_follow_up', owner: 'user-1',
  });
  const url = new URL(dashboardContactHref('myNeedsNextFollowUp', 'user-1'), 'https://crm.test');
  assert.deepEqual(Object.fromEntries(url.searchParams), dashboardContactFilter('myNeedsNextFollowUp', 'user-1'));
  assert.throws(() => dashboardContactFilter('myNewLeads'), /require an owner/);
});

test('task workspace separates own urgent work from authorized division attention', () => {
  const tasks = [
    { id: 'mine-overdue', ownerUserId: 'user-1', businessUnitId: 'usa', dueDate: '2026-09-23', status: 'open' },
    { id: 'mine-today', ownerUserId: 'user-1', businessUnitId: 'usa', dueDate: '2026-09-25', status: 'open' },
    { id: 'other-overdue', ownerUserId: 'user-2', businessUnitId: 'usa', dueDate: '2026-09-24', status: 'open' },
    { id: 'unassigned', ownerUserId: '', businessUnitId: 'usa', dueDate: '2026-09-27', status: 'open' },
    { id: 'unassigned-overdue', ownerUserId: '', businessUnitId: 'usa', dueDate: '2026-09-22', status: 'open' },
    { id: 'other-division', ownerUserId: 'user-1', businessUnitId: 'signs', dueDate: '2026-09-22', status: 'open' },
    { id: 'closed', ownerUserId: 'user-1', businessUnitId: 'usa', dueDate: '2026-09-20', status: 'completed' },
  ];
  const scope = dashboardTaskScope(tasks, 'user-1', 'usa', '2026-09-25');
  assert.deepEqual(scope.personalOverdue.map((task) => task.id), ['mine-overdue']);
  assert.deepEqual(scope.personalToday.map((task) => task.id), ['mine-today']);
  assert.deepEqual(scope.urgentTasks.map((task) => task.id), ['mine-overdue', 'mine-today']);
  assert.deepEqual(scope.teamOverdue.map((task) => task.id), ['mine-overdue', 'other-overdue', 'unassigned-overdue']);
  assert.deepEqual(scope.teamUnassigned.map((task) => task.id), ['unassigned', 'unassigned-overdue']);
  assert.deepEqual(scope.teamOtherOwnedOverdue.map((task) => task.id), ['other-overdue']);
});
