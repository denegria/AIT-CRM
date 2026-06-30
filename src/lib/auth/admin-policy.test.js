import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminOnlyError,
  assertAdminSession,
  sessionHasAdminRole,
  userHasAdminRole,
} from './admin-policy.js';

test('recognizes administrator role from primary role or role list', () => {
  assert.equal(userHasAdminRole({ primaryRoleKey: 'admin', roleKeys: ['account_manager'] }), true);
  assert.equal(userHasAdminRole({ primaryRoleKey: 'account_manager', roleKeys: ['admin'] }), true);
  assert.equal(sessionHasAdminRole({ user: { primaryRoleKey: 'sales_manager', roleKeys: ['sales_manager'] } }), false);
});

test('rejects non-admin CRM writers with a 403 policy error', () => {
  const session = {
    user: {
      primaryRoleKey: 'account_manager',
      roleKeys: ['account_manager'],
      permissions: ['crm:read', 'crm:write'],
    },
  };

  assert.throws(
    () => assertAdminSession(session),
    (error) => error.status === 403 && error.message === 'Administrator access is required.',
  );
});

test('returns explicit 403 errors for admin-only route guards', () => {
  const error = adminOnlyError('SMS campaign management requires administrator access.');
  assert.equal(error.status, 403);
  assert.equal(error.message, 'SMS campaign management requires administrator access.');
});
