import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadTaskDetail } from './detail-policy.js';

function session(overrides = {}) {
  return {
    user: {
      id: 'user-1',
      canAccessAllBusinessUnits: false,
      businessUnitIds: ['bu-1'],
      primaryRoleKey: 'account_coordinator',
      roleKeys: ['account_coordinator'],
      ...overrides,
    },
  };
}

test('task detail access follows business-unit scope', () => {
  assert.equal(canReadTaskDetail(session(), {
    id: 'task-1',
    businessUnitId: 'bu-1',
    ownerUserId: 'user-1',
  }), true);

  assert.equal(canReadTaskDetail(session(), {
    id: 'task-2',
    businessUnitId: 'bu-2',
    ownerUserId: 'user-1',
  }), false);

  assert.equal(canReadTaskDetail(session({ canAccessAllBusinessUnits: true, businessUnitIds: [] }), {
    id: 'task-3',
    businessUnitId: 'bu-2',
    ownerUserId: 'user-1',
  }), true);
});

test('regular coordinator task detail is owner-scoped', () => {
  assert.equal(canReadTaskDetail(session(), {
    id: 'task-owned',
    businessUnitId: 'bu-1',
    ownerUserId: 'user-1',
  }), true);

  assert.equal(canReadTaskDetail(session(), {
    id: 'task-other',
    businessUnitId: 'bu-1',
    ownerUserId: 'user-2',
  }), false);

  assert.equal(canReadTaskDetail(session({
    primaryRoleKey: 'senior_coordinator',
    roleKeys: ['senior_coordinator'],
  }), {
    id: 'task-other',
    businessUnitId: 'bu-1',
    ownerUserId: 'user-2',
  }), true);
});
