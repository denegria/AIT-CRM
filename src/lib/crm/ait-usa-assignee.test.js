import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aitUsaAssigneeOptionLabel,
  isEligibleAitUsaAssignee,
} from './ait-usa-assignee.js';

const businessUnitId = 'ait-usa';

test('AIT USA owner eligibility includes an acting Senior Coordinator only in their business unit', () => {
  const lili = {
    id: 'lili',
    label: 'Lili',
    roleKeys: ['senior_coordinator'],
    businessUnitIds: [businessUnitId],
  };
  assert.equal(isEligibleAitUsaAssignee({ owner: lili, businessUnitId, actorUserId: 'lili' }), true);
  assert.equal(isEligibleAitUsaAssignee({ owner: lili, businessUnitId, actorUserId: 'other-senior' }), false);
  assert.equal(isEligibleAitUsaAssignee({ owner: lili, businessUnitId: 'other-unit', actorUserId: 'lili' }), false);
  assert.equal(aitUsaAssigneeOptionLabel(lili, 'lili'), 'Lili (You)');
});

test('AIT USA owner eligibility preserves regular Coordinators and excludes elevated non-self targets', () => {
  const regular = {
    id: 'regular',
    roleKeys: ['account_coordinator'],
    businessUnitIds: [businessUnitId],
  };
  const admin = {
    id: 'admin',
    roleKeys: ['admin'],
    businessUnitIds: [businessUnitId],
  };
  assert.equal(isEligibleAitUsaAssignee({ owner: regular, businessUnitId, actorUserId: 'senior' }), true);
  assert.equal(isEligibleAitUsaAssignee({ owner: admin, businessUnitId, actorUserId: 'admin' }), false);
});
