import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessContactLead,
  canArchiveContactsDirectly,
  canManageCoordinatorAssignments,
  canUseCoordinatorRoute,
  canUseRegularCoordinatorRoute,
  coordinatorUiPolicyForUser,
  filterContactsForSession,
  isRegularCoordinatorSession,
  isSeniorCoordinatorSession,
} from './coordinator-policy.js';

function session(roleKeys, id = 'user-1') {
  return {
    user: {
      id,
      roleKeys,
      primaryRoleKey: roleKeys[0],
      businessUnitIds: ['bu-1'],
      canAccessAllBusinessUnits: roleKeys.includes('admin'),
    },
  };
}

test('senior coordinator is not treated as a regular owner-scoped coordinator', () => {
  const senior = session(['senior_coordinator']);
  assert.equal(isSeniorCoordinatorSession(senior), true);
  assert.equal(isRegularCoordinatorSession(senior), false);
  assert.equal(canManageCoordinatorAssignments(senior), true);
  assert.equal(canArchiveContactsDirectly(senior), true);
});

test('regular coordinator is owner scoped and cannot use direct archive or reassignment powers', () => {
  const regular = session(['account_manager']);
  assert.equal(isRegularCoordinatorSession(regular), true);
  assert.equal(canManageCoordinatorAssignments(regular), false);
  assert.equal(canArchiveContactsDirectly(regular), false);
  assert.equal(canAccessContactLead(regular, { assignedUserId: 'user-1' }), true);
  assert.equal(canAccessContactLead(regular, { assignedUserId: 'user-2' }), false);
  assert.equal(canAccessContactLead(regular, { assignedUserId: null }), false);
});

test('regular coordinator UI policy locks owner-scoped surfaces to the current user', () => {
  const policy = coordinatorUiPolicyForUser({
    id: 'coordinator-1',
    primaryRoleKey: 'account_manager',
    roleKeys: [],
  });

  assert.equal(policy.isRegularCoordinator, true);
  assert.equal(policy.ownerScoped, true);
  assert.equal(policy.canManageCoordinatorAssignments, false);
  assert.equal(policy.canArchiveContactsDirectly, false);
  assert.equal(policy.lockedOwnerUserId, 'coordinator-1');
});

test('senior coordinator UI policy keeps broad coordinator controls available', () => {
  const policy = coordinatorUiPolicyForUser({
    id: 'senior-1',
    primaryRoleKey: 'senior_coordinator',
    roleKeys: ['account_manager', 'senior_coordinator'],
  });

  assert.equal(policy.isRegularCoordinator, false);
  assert.equal(policy.ownerScoped, false);
  assert.equal(policy.canManageCoordinatorAssignments, true);
  assert.equal(policy.canArchiveContactsDirectly, true);
  assert.equal(policy.lockedOwnerUserId, '');
});

test('regular coordinator route policy allows only personal CRM workspace routes', () => {
  assert.equal(canUseRegularCoordinatorRoute('/'), true);
  assert.equal(canUseRegularCoordinatorRoute('/contacts'), true);
  assert.equal(canUseRegularCoordinatorRoute('/contacts/contact-1'), true);
  assert.equal(canUseRegularCoordinatorRoute('/clients/client-1?tab=financials'), true);
  assert.equal(canUseRegularCoordinatorRoute('/pipeline'), true);
  assert.equal(canUseRegularCoordinatorRoute('/tasks'), true);

  assert.equal(canUseRegularCoordinatorRoute('/work-orders'), false);
  assert.equal(canUseRegularCoordinatorRoute('/work-orders/work-order-1'), false);
  assert.equal(canUseRegularCoordinatorRoute('/financials'), false);
  assert.equal(canUseRegularCoordinatorRoute('/reports'), false);
  assert.equal(canUseRegularCoordinatorRoute('/settings'), false);
});

test('senior coordinator route policy keeps broad workspace routes available', () => {
  assert.equal(canUseCoordinatorRoute(session(['account_manager']).user, '/work-orders'), false);
  assert.equal(canUseCoordinatorRoute(session(['account_manager']).user, '/financials'), false);
  assert.equal(canUseCoordinatorRoute(session(['senior_coordinator']).user, '/work-orders'), true);
  assert.equal(canUseCoordinatorRoute(session(['admin']).user, '/settings'), true);
});

test('regular coordinator contact list keeps only contacts whose latest lead is assigned to them', () => {
  const contacts = [{ id: 'contact-1' }, { id: 'contact-2' }, { id: 'contact-3' }];
  const leads = [
    { contactId: 'contact-1', assignedUserId: 'user-1', createdAt: '2026-01-01T00:00:00Z' },
    { contactId: 'contact-2', assignedUserId: 'user-1', createdAt: '2026-01-01T00:00:00Z' },
    { contactId: 'contact-2', assignedUserId: 'user-2', createdAt: '2026-02-01T00:00:00Z' },
    { contactId: 'contact-3', assignedUserId: null, createdAt: '2026-03-01T00:00:00Z' },
  ];

  assert.deepEqual(
    filterContactsForSession(contacts, leads, session(['account_manager'])).map((contact) => contact.id),
    ['contact-1'],
  );
  assert.deepEqual(
    filterContactsForSession(contacts, leads, session(['senior_coordinator'])).map((contact) => contact.id),
    ['contact-1', 'contact-2', 'contact-3'],
  );
});
