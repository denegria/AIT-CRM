export const ROLE_KEYS = Object.freeze({
  ADMIN: 'admin',
  SENIOR_COORDINATOR: 'senior_coordinator',
  ACCOUNT_MANAGER: 'account_manager',
  SALES_MANAGER: 'sales_manager',
});

export function roleKeysForUser(user = {}) {
  return [
    user?.primaryRoleKey,
    ...(Array.isArray(user?.roleKeys) ? user.roleKeys : []),
  ].filter(Boolean);
}

export function userHasRole(user = {}, roleKey) {
  return roleKeysForUser(user).includes(roleKey);
}

export function isSeniorCoordinatorSession(session = {}) {
  return userHasRole(session.user, ROLE_KEYS.SENIOR_COORDINATOR);
}

export function isRegularCoordinatorSession(session = {}) {
  const roleKeys = roleKeysForUser(session?.user);
  if (!roleKeys.includes(ROLE_KEYS.ACCOUNT_MANAGER)) return false;
  return ![
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
    ROLE_KEYS.SALES_MANAGER,
  ].some((roleKey) => roleKeys.includes(roleKey));
}

export function canManageCoordinatorAssignments(session = {}) {
  return !isRegularCoordinatorSession(session);
}

export function canArchiveContactsDirectly(session = {}) {
  return !isRegularCoordinatorSession(session);
}

export function isWorkOrderSelfScopedSession(session = {}) {
  const roleKeys = roleKeysForUser(session?.user);
  if ([
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
    ROLE_KEYS.SALES_MANAGER,
  ].some((roleKey) => roleKeys.includes(roleKey))) {
    return false;
  }
  return roleKeys.includes(ROLE_KEYS.ACCOUNT_MANAGER) || roleKeys.includes('designer');
}

export function canManageWorkOrderAssignments(session = {}) {
  return !isWorkOrderSelfScopedSession(session);
}

export function canAccessWorkOrder(session = {}, workOrder = {}) {
  const businessUnitId = workOrder?.businessUnitId || '';
  const canAccessBusinessUnit = Boolean(
    session.user?.canAccessAllBusinessUnits ||
    (businessUnitId && Array.isArray(session.user?.businessUnitIds) && session.user.businessUnitIds.includes(businessUnitId))
  );
  if (!canAccessBusinessUnit) return false;
  if (!isWorkOrderSelfScopedSession(session)) return true;
  return Boolean(workOrder?.assignedUserId && workOrder.assignedUserId === session.user?.id);
}

export function coordinatorUiPolicyForUser(user = {}) {
  const session = { user };
  const isRegularCoordinator = isRegularCoordinatorSession(session);
  const workOrdersOwnerScoped = isWorkOrderSelfScopedSession(session);
  return {
    isRegularCoordinator,
    ownerScoped: isRegularCoordinator,
    workOrdersOwnerScoped,
    canManageCoordinatorAssignments: canManageCoordinatorAssignments(session),
    canManageWorkOrderAssignments: canManageWorkOrderAssignments(session),
    canArchiveContactsDirectly: canArchiveContactsDirectly(session),
    lockedOwnerUserId: isRegularCoordinator ? user?.id || '' : '',
    lockedWorkOrderOwnerUserId: workOrdersOwnerScoped ? user?.id || '' : '',
  };
}

const REGULAR_COORDINATOR_ROUTE_PREFIXES = Object.freeze([
  '/',
  '/clients',
  '/contacts',
  '/pipeline',
  '/tasks',
  '/work-orders',
]);

export function canUseRegularCoordinatorRoute(pathname = '') {
  const normalizedPath = String(pathname || '/').split(/[?#]/)[0] || '/';
  return REGULAR_COORDINATOR_ROUTE_PREFIXES.some((routePrefix) => {
    if (routePrefix === '/') return normalizedPath === '/';
    return normalizedPath === routePrefix || normalizedPath.startsWith(`${routePrefix}/`);
  });
}

export function canUseCoordinatorRoute(user = {}, pathname = '') {
  const policy = coordinatorUiPolicyForUser(user);
  return !policy.isRegularCoordinator || canUseRegularCoordinatorRoute(pathname);
}

function timeValue(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function latestLeadByContactId(leadRows = []) {
  const lookup = new Map();
  for (const lead of leadRows) {
    if (!lead?.contactId) continue;
    const existing = lookup.get(lead.contactId);
    if (!existing || timeValue(lead.createdAt) > timeValue(existing.createdAt)) {
      lookup.set(lead.contactId, lead);
    }
  }
  return lookup;
}

export function canAccessContactLead(session, lead = null) {
  if (!isRegularCoordinatorSession(session)) return true;
  return Boolean(lead?.assignedUserId && lead.assignedUserId === session.user.id);
}

export function filterContactsForSession(contactRows = [], leadRows = [], session) {
  if (!isRegularCoordinatorSession(session)) return contactRows;
  const latestLeadLookup = latestLeadByContactId(leadRows);
  return contactRows.filter((contact) => canAccessContactLead(session, latestLeadLookup.get(contact.id)));
}
