import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessContactLead,
  canAccessWorkOrder,
  canArchiveContactsDirectly,
  canManageCoordinatorAssignments,
  canManageWorkOrderAssignments,
  canUseCoordinatorRoute,
  canUseWorkOrderBusinessUnit,
  canUseWorkOrdersWorkspace,
  canUseRegularCoordinatorRoute,
  coordinatorUiPolicyForUser,
  filterContactsForSession,
  isRegularCoordinatorSession,
  isSeniorCoordinatorSession,
  isWorkOrderSelfScopedSession,
} from './coordinator-policy.js';

function session(roleKeys, id = 'user-1') {
  return {
    user: {
      id,
      roleKeys,
      primaryRoleKey: roleKeys[0],
      businessUnitIds: ['bu-1'],
      businessUnitMemberships: [{ id: 'bu-1', name: 'AIT Signs', isPrimary: true }],
      businessUnitNamesById: { 'bu-1': 'AIT Signs' },
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
  assert.equal(canManageWorkOrderAssignments(regular), false);
  assert.equal(canArchiveContactsDirectly(regular), false);
  assert.equal(canAccessContactLead(regular, { assignedUserId: 'user-1' }), true);
  assert.equal(canAccessContactLead(regular, { assignedUserId: 'user-2' }), false);
  assert.equal(canAccessContactLead(regular, { assignedUserId: null }), false);
});

test('work order self-scope applies to employee roles but not senior coordinator roles', () => {
  const regular = session(['account_manager']);
  const designer = session(['designer']);
  const senior = session(['senior_coordinator']);
  const admin = session(['admin']);

  assert.equal(isWorkOrderSelfScopedSession(regular), true);
  assert.equal(isWorkOrderSelfScopedSession(designer), true);
  assert.equal(isWorkOrderSelfScopedSession(senior), false);
  assert.equal(isWorkOrderSelfScopedSession(admin), false);
  assert.equal(canManageWorkOrderAssignments(regular), false);
  assert.equal(canManageWorkOrderAssignments(designer), false);
  assert.equal(canManageWorkOrderAssignments(senior), true);
  assert.equal(canManageWorkOrderAssignments(admin), true);
});

test('work order access is assigned-user scoped for employee roles', () => {
  const regular = session(['account_manager']);
  const designer = session(['designer']);
  const senior = session(['senior_coordinator']);

  assert.equal(canAccessWorkOrder(regular, { businessUnitId: 'bu-1', assignedUserId: 'user-1' }), true);
  assert.equal(canAccessWorkOrder(regular, { businessUnitId: 'bu-1', assignedUserId: 'user-2' }), false);
  assert.equal(canAccessWorkOrder(designer, { businessUnitId: 'bu-1', assignedUserId: 'user-1' }), true);
  assert.equal(canAccessWorkOrder(designer, { businessUnitId: 'bu-1', assignedUserId: 'user-2' }), false);
  assert.equal(canAccessWorkOrder(senior, { businessUnitId: 'bu-1', assignedUserId: 'user-2' }), true);
});

test('ait usa-only employees cannot use the work orders workspace or data scope', () => {
  const aitUsaOnly = session(['account_manager']);
  aitUsaOnly.user.businessUnitIds = ['bu-usa'];
  aitUsaOnly.user.businessUnitMemberships = [{ id: 'bu-usa', name: 'AIT USA Institute', isPrimary: true }];
  aitUsaOnly.user.businessUnitNamesById = { 'bu-usa': 'AIT USA Institute' };

  assert.equal(canUseWorkOrdersWorkspace(aitUsaOnly.user), false);
  assert.equal(canUseWorkOrderBusinessUnit(aitUsaOnly, 'bu-usa'), false);
  assert.equal(canUseCoordinatorRoute(aitUsaOnly.user, '/work-orders'), false);
  assert.equal(canAccessWorkOrder(aitUsaOnly, { businessUnitId: 'bu-usa', assignedUserId: 'user-1' }), false);
});

test('mixed ait signs and ait usa employees keep signs-only work order access', () => {
  const mixed = session(['account_manager']);
  mixed.user.businessUnitIds = ['bu-usa', 'bu-signs'];
  mixed.user.businessUnitMemberships = [
    { id: 'bu-usa', name: 'AIT USA Institute', isPrimary: true },
    { id: 'bu-signs', name: 'AIT Signs', isPrimary: false },
  ];
  mixed.user.businessUnitNamesById = { 'bu-usa': 'AIT USA Institute', 'bu-signs': 'AIT Signs' };

  assert.equal(canUseWorkOrdersWorkspace(mixed.user), true);
  assert.equal(canUseWorkOrderBusinessUnit(mixed, 'bu-signs'), true);
  assert.equal(canUseWorkOrderBusinessUnit(mixed, 'bu-usa'), false);
  assert.equal(canUseCoordinatorRoute(mixed.user, '/work-orders'), true);
  assert.equal(canAccessWorkOrder(mixed, { businessUnitId: 'bu-signs', assignedUserId: 'user-1' }), true);
  assert.equal(canAccessWorkOrder(mixed, { businessUnitId: 'bu-usa', assignedUserId: 'user-1' }), false);
});

test('regular coordinator UI policy locks owner-scoped surfaces to the current user', () => {
  const policy = coordinatorUiPolicyForUser({
    id: 'coordinator-1',
    primaryRoleKey: 'account_manager',
    roleKeys: [],
  });

  assert.equal(policy.isRegularCoordinator, true);
  assert.equal(policy.ownerScoped, true);
  assert.equal(policy.workOrdersOwnerScoped, true);
  assert.equal(policy.canManageCoordinatorAssignments, false);
  assert.equal(policy.canManageWorkOrderAssignments, false);
  assert.equal(policy.canArchiveContactsDirectly, false);
  assert.equal(policy.lockedOwnerUserId, 'coordinator-1');
  assert.equal(policy.lockedWorkOrderOwnerUserId, 'coordinator-1');
});

test('senior coordinator UI policy keeps broad coordinator controls available', () => {
  const policy = coordinatorUiPolicyForUser({
    id: 'senior-1',
    primaryRoleKey: 'senior_coordinator',
    roleKeys: ['account_manager', 'senior_coordinator'],
  });

  assert.equal(policy.isRegularCoordinator, false);
  assert.equal(policy.ownerScoped, false);
  assert.equal(policy.workOrdersOwnerScoped, false);
  assert.equal(policy.canManageCoordinatorAssignments, true);
  assert.equal(policy.canManageWorkOrderAssignments, true);
  assert.equal(policy.canArchiveContactsDirectly, true);
  assert.equal(policy.lockedOwnerUserId, '');
  assert.equal(policy.lockedWorkOrderOwnerUserId, '');
});

test('regular coordinator route policy allows only personal CRM workspace routes', () => {
  assert.equal(canUseRegularCoordinatorRoute('/'), true);
  assert.equal(canUseRegularCoordinatorRoute('/contacts'), true);
  assert.equal(canUseRegularCoordinatorRoute('/contacts/contact-1'), true);
  assert.equal(canUseRegularCoordinatorRoute('/clients/client-1?tab=financials'), true);
  assert.equal(canUseRegularCoordinatorRoute('/pipeline'), true);
  assert.equal(canUseRegularCoordinatorRoute('/tasks'), true);
  assert.equal(canUseRegularCoordinatorRoute('/work-orders'), true);
  assert.equal(canUseRegularCoordinatorRoute('/work-orders/work-order-1'), true);

  assert.equal(canUseRegularCoordinatorRoute('/financials'), false);
  assert.equal(canUseRegularCoordinatorRoute('/reports'), false);
  assert.equal(canUseRegularCoordinatorRoute('/settings'), false);
});

test('senior coordinator route policy keeps broad workspace routes available', () => {
  assert.equal(canUseCoordinatorRoute(session(['account_manager']).user, '/work-orders'), true);
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
