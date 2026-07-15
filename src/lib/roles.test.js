import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_COORDINATOR_ROLE_KEY,
  LEGACY_ACCOUNT_MANAGER_ROLE_KEY,
  INVITE_ROLE_KEYS,
  MANAGED_ROLE_KEYS,
  canonicalRoleKey,
  canonicalRoleKeys,
  compatibleRoleLookupKeys,
  isRegularCoordinatorRoleKey,
  normalizeRoleKey,
  preferredRoleRowForKey,
  roleKeyMatches,
  roleKeysForUser,
  roleLabel,
} from './roles.js';

test('account coordinator is the canonical regular coordinator role key', () => {
  assert.equal(ACCOUNT_COORDINATOR_ROLE_KEY, 'account_coordinator');
  assert.equal(canonicalRoleKey('account_coordinator'), 'account_coordinator');
  assert.equal(canonicalRoleKey('account_manager'), 'account_coordinator');
  assert.equal(roleKeyMatches('account_manager', 'account_coordinator'), true);
  assert.equal(roleLabel('account_manager'), 'Account Coordinator');
  assert.equal(roleLabel('account_coordinator'), 'Account Coordinator');
});

test('managed and invite role lists publish canonical keys only', () => {
  assert.equal(MANAGED_ROLE_KEYS.includes(ACCOUNT_COORDINATOR_ROLE_KEY), true);
  assert.equal(MANAGED_ROLE_KEYS.includes(LEGACY_ACCOUNT_MANAGER_ROLE_KEY), false);
  assert.equal(INVITE_ROLE_KEYS.includes(ACCOUNT_COORDINATOR_ROLE_KEY), true);
  assert.equal(INVITE_ROLE_KEYS.includes(LEGACY_ACCOUNT_MANAGER_ROLE_KEY), false);
});

test('role normalization accepts legacy account manager inputs as account coordinator', () => {
  assert.equal(normalizeRoleKey(' account_manager ', MANAGED_ROLE_KEYS), 'account_coordinator');
  assert.equal(normalizeRoleKey('account_coordinator', MANAGED_ROLE_KEYS), 'account_coordinator');
  assert.equal(normalizeRoleKey('account_manager', MANAGED_ROLE_KEYS, { allowLegacy: false }), '');
  assert.equal(normalizeRoleKey('owner', MANAGED_ROLE_KEYS), '');
});

test('user role payload helpers dedupe canonical and legacy regular coordinator keys', () => {
  assert.deepEqual(
    canonicalRoleKeys(['account_manager', 'account_coordinator', 'senior_coordinator']),
    ['account_coordinator', 'senior_coordinator'],
  );
  assert.deepEqual(
    roleKeysForUser({ primaryRoleKey: 'account_manager', roleKeys: ['account_coordinator'] }),
    ['account_coordinator'],
  );
  assert.equal(isRegularCoordinatorRoleKey('account_manager'), true);
  assert.equal(isRegularCoordinatorRoleKey('senior_coordinator'), false);
});

test('role row lookup prefers canonical rows and falls back to legacy during rollout', () => {
  assert.deepEqual(compatibleRoleLookupKeys('account_coordinator'), ['account_coordinator', 'account_manager']);
  assert.deepEqual(compatibleRoleLookupKeys('designer'), ['designer']);
  assert.deepEqual(
    preferredRoleRowForKey([
      { id: 'legacy-role', key: 'account_manager' },
      { id: 'canonical-role', key: 'account_coordinator' },
    ], 'account_manager'),
    { id: 'canonical-role', key: 'account_coordinator' },
  );
  assert.deepEqual(
    preferredRoleRowForKey([{ id: 'legacy-role', key: 'account_manager' }], 'account_coordinator'),
    { id: 'legacy-role', key: 'account_manager' },
  );
});
