import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAssignableEmployees,
  isAssignableEmployee,
  looksLikeNonEmployeeAccount,
} from './assignable-employees.js';

test('assignable employee policy excludes staging test and automation accounts', () => {
  const users = [
    { id: 'user-1', name: 'Sofia Lopez', email: 'sofia@aitusa.com', roleKeys: ['account_manager'] },
    { id: 'user-2', name: 'Meeting Account Manager', email: 'meeting.account.manager@aitcrm.app', roleKeys: ['account_manager'] },
    { id: 'user-3', name: 'Sentry Client', email: 'sentry.client@aitcrm.app', roleKeys: ['account_manager'] },
    { id: 'user-4', name: 'Inactive Employee', email: 'inactive@aitusa.com', roleKeys: ['designer'], isActive: false },
    { id: 'user-5', name: 'Jessica Vega', email: 'jessica@aitusa.com', roleKeys: ['designer'] },
  ];

  assert.deepEqual(
    filterAssignableEmployees(users).map((user) => user.id),
    ['user-1', 'user-5'],
  );
});

test('assignable employee policy requires first-party employee roles when roles are provided', () => {
  assert.equal(isAssignableEmployee({
    id: 'user-1',
    name: 'Real Employee',
    email: 'employee@aitusa.com',
    roleKeys: ['account_manager'],
  }), true);
  assert.equal(isAssignableEmployee({
    id: 'user-2',
    name: 'External Client',
    email: 'client@customer.com',
    roleKeys: ['external_client'],
  }), false);
});

test('test account detector keeps normal names with common words assignable', () => {
  assert.equal(looksLikeNonEmployeeAccount({ name: 'Jessica Meeting', email: 'jessica@aitusa.com' }), false);
  assert.equal(looksLikeNonEmployeeAccount({ name: 'QA User', email: 'qa.user@aitcrm.app' }), true);
});
