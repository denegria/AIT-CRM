import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCanManageAitUsaAssignments,
  canManageAitUsaAssignments,
  isEligibleAitUsaAssigneeRole,
  isEligibleAitUsaCoordinatorRole,
} from './ait-usa-assignment-policy.js';

function session(roleKeys) {
  return { user: { primaryRoleKey: roleKeys[0], roleKeys } };
}

test('only Senior Coordinators and administrators manage AIT USA assignments', () => {
  assert.equal(canManageAitUsaAssignments(session(['senior_coordinator'])), true);
  assert.equal(canManageAitUsaAssignments(session(['admin'])), true);
  assert.equal(canManageAitUsaAssignments(session(['account_coordinator'])), false);
  assert.throws(
    () => assertCanManageAitUsaAssignments(session(['account_coordinator'])),
    /Only Senior Coordinators or administrators/,
  );
});

test('AIT USA assignees must have the regular Coordinator role', () => {
  assert.equal(isEligibleAitUsaCoordinatorRole(['account_coordinator']), true);
  assert.equal(isEligibleAitUsaCoordinatorRole(['account_manager']), true);
  assert.equal(isEligibleAitUsaCoordinatorRole(['senior_coordinator']), false);
  assert.equal(isEligibleAitUsaCoordinatorRole(['admin']), false);
  assert.equal(isEligibleAitUsaCoordinatorRole(['account_coordinator', 'senior_coordinator']), false);
});

test('an AIT USA Senior Coordinator is eligible only when assigning themself', () => {
  assert.equal(isEligibleAitUsaAssigneeRole({
    roleKeys: ['senior_coordinator'],
    assigneeUserId: 'senior-1',
    actorUserId: 'senior-1',
  }), true);
  assert.equal(isEligibleAitUsaAssigneeRole({
    roleKeys: ['senior_coordinator'],
    assigneeUserId: 'senior-2',
    actorUserId: 'senior-1',
  }), false);
  assert.equal(isEligibleAitUsaAssigneeRole({
    roleKeys: ['admin'],
    assigneeUserId: 'admin-1',
    actorUserId: 'admin-1',
  }), false);
  assert.equal(isEligibleAitUsaAssigneeRole({
    roleKeys: ['account_coordinator'],
    assigneeUserId: 'coordinator-2',
    actorUserId: 'senior-1',
  }), true);
});
