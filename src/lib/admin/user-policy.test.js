import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeBusinessUnitIds,
  normalizeManagedRoleKey,
  requiresBusinessUnitMembership,
  toRoleOption,
  validateUserAccessDraft,
} from './user-policy.js';
import { buildMembershipRows } from './user-access-values.js';

test('managed role input only accepts first-party role keys', () => {
  assert.equal(normalizeManagedRoleKey('admin'), 'admin');
  assert.equal(normalizeManagedRoleKey('owner'), '');
  assert.equal(normalizeManagedRoleKey('senior_coordinator'), 'senior_coordinator');
  assert.equal(normalizeManagedRoleKey(' account_coordinator '), 'account_coordinator');
  assert.equal(normalizeManagedRoleKey(' account_manager '), 'account_coordinator');
});

test('account coordinator role displays with the employee-facing label', () => {
  assert.deepEqual(toRoleOption('account_coordinator'), {
    key: 'account_coordinator',
    label: 'Account Coordinator',
  });
  assert.deepEqual(toRoleOption('account_manager'), {
    key: 'account_coordinator',
    label: 'Account Coordinator',
  });
});

test('senior coordinator role is managed and division-scoped', () => {
  assert.deepEqual(toRoleOption('senior_coordinator'), {
    key: 'senior_coordinator',
    label: 'Senior Coordinator',
  });
  assert.equal(requiresBusinessUnitMembership('senior_coordinator'), true);
});

test('non-admin role drafts require explicit business-unit memberships', () => {
  assert.equal(requiresBusinessUnitMembership('admin'), false);
  assert.equal(requiresBusinessUnitMembership('designer'), true);
  assert.deepEqual(
    validateUserAccessDraft({
      email: 'designer@ait.local',
      name: 'Designer',
      roleKey: 'designer',
      businessUnitIds: [],
    }),
    { ok: false, error: 'At least one active division is required for non-admin users.', status: 400 },
  );
  assert.deepEqual(
    validateUserAccessDraft({
      email: 'admin@ait.local',
      name: 'Admin',
      roleKey: 'admin',
      businessUnitIds: [],
    }),
    { ok: true, error: '', status: 200 },
  );
});

test('new managed users require a usable initial password', () => {
  assert.deepEqual(
    validateUserAccessDraft({
      email: 'new.user@ait.local',
      name: 'New User',
      password: '',
      roleKey: 'admin',
      businessUnitIds: [],
      requirePassword: true,
    }),
    { ok: false, error: 'Initial password is required.', status: 400 },
  );
  assert.deepEqual(
    validateUserAccessDraft({
      email: 'new.user@ait.local',
      name: 'New User',
      password: 'short',
      roleKey: 'admin',
      businessUnitIds: [],
      requirePassword: true,
    }),
    { ok: false, error: 'Password must be at least 8 characters.', status: 400 },
  );
  assert.deepEqual(
    validateUserAccessDraft({
      email: 'new.user@ait.local',
      name: 'New User',
      password: 'temporary-123',
      roleKey: 'admin',
      businessUnitIds: [],
      requirePassword: true,
    }),
    { ok: true, error: '', status: 200 },
  );
});

test('membership mechanics preserve explicit action-layer inputs', () => {
  assert.deepEqual(normalizeBusinessUnitIds(['bu-1', ' ', 'bu-1', 'bu-2']), ['bu-1', 'bu-2']);
  assert.deepEqual(
    buildMembershipRows({
      userId: 'user-1',
      roleId: 'role-1',
      businessUnitIds: ['bu-2', 'bu-1'],
    }),
    [
      { userId: 'user-1', roleId: 'role-1', businessUnitId: 'bu-2', isPrimary: true },
      { userId: 'user-1', roleId: 'role-1', businessUnitId: 'bu-1', isPrimary: false },
    ],
  );
  assert.deepEqual(
    buildMembershipRows({ userId: 'admin-1', roleId: 'role-admin', businessUnitIds: [] }),
    [],
  );
});
