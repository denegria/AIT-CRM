import assert from 'node:assert/strict';
import test from 'node:test';
import { taskMutationAccessDecision } from './access-policy.js';

function session(roleKey, overrides = {}) {
  return {
    user: {
      id: `${roleKey}-user`,
      primaryRoleKey: roleKey,
      roleKeys: [roleKey],
      businessUnitIds: ['bu-usa'],
      canAccessAllBusinessUnits: roleKey === 'admin',
      ...overrides,
    },
  };
}

function task(ownerUserId, businessUnitId = 'bu-usa') {
  return { id: 'task-1', ownerUserId, businessUnitId, status: 'open' };
}

test('assigned in-scope regular coordinator may complete only their own task', () => {
  const regular = session('account_coordinator');
  assert.deepEqual(taskMutationAccessDecision({
    session: regular,
    task: task(regular.user.id),
    action: 'complete',
  }), { allowed: true, status: 200, error: '' });

  const restricted = taskMutationAccessDecision({
    session: regular,
    task: task('other-employee'),
    action: 'complete',
  });
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.status, 403);
  assert.match(restricted.error, /assigned to them/);
});

test('regular coordinator completion fails for out-of-scope and unassigned tasks', () => {
  const regular = session('account_coordinator');
  const outOfScope = taskMutationAccessDecision({
    session: regular,
    task: task(regular.user.id, 'bu-signs'),
    action: 'complete',
  });
  assert.equal(outOfScope.allowed, false);
  assert.equal(outOfScope.error, 'Insufficient business-unit access.');

  const unassigned = taskMutationAccessDecision({
    session: regular,
    task: task(null),
    action: 'complete',
  });
  assert.equal(unassigned.allowed, false);
  assert.match(unassigned.error, /assigned to them/);
});

test('existing privileged task scope remains available to senior coordinators and admins', () => {
  const senior = session('senior_coordinator');
  const admin = session('admin');

  assert.equal(taskMutationAccessDecision({
    session: senior,
    task: task('other-employee'),
    action: 'complete',
  }).allowed, true);
  assert.equal(taskMutationAccessDecision({
    session: admin,
    task: task('other-employee', 'bu-signs'),
    action: 'complete',
  }).allowed, true);
});

test('owner mismatch still follows the route existing cancellation exception only', () => {
  const regular = session('account_coordinator');
  assert.equal(taskMutationAccessDecision({
    session: regular,
    task: task('other-employee'),
    action: 'request_removal',
  }).allowed, true);
  assert.equal(taskMutationAccessDecision({
    session: regular,
    task: task('other-employee'),
    action: 'update',
  }).allowed, false);
});
