import {
  ROLE_KEYS,
  isRegularCoordinatorRoleKey,
  roleKeysForUser,
  userHasRole,
} from '../roles.js';

export { ROLE_KEYS, roleKeysForUser, userHasRole };

export function isSeniorCoordinatorSession(session = {}) {
  return userHasRole(session.user, ROLE_KEYS.SENIOR_COORDINATOR);
}

export function isRegularCoordinatorSession(session = {}) {
  const roleKeys = roleKeysForUser(session?.user);
  if (!roleKeys.some(isRegularCoordinatorRoleKey)) return false;
  return ![
    ROLE_KEYS.ADMIN,
    ROLE_KEYS.SENIOR_COORDINATOR,
    ROLE_KEYS.SALES_MANAGER,
  ].some((roleKey) => userHasRole(session?.user, roleKey));
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
  return roleKeys.some(isRegularCoordinatorRoleKey) || roleKeys.includes(ROLE_KEYS.DESIGNER);
}

export function isWorkOrdersBusinessUnit(unit = {}) {
  return /ait\s*signs/i.test(String(unit?.name || unit?.businessUnitName || '').trim());
}

export function workOrderBusinessUnitIdsForUser(user = {}) {
  if (user?.canAccessAllBusinessUnits) return null;

  const memberships = Array.isArray(user?.businessUnitMemberships)
    ? user.businessUnitMemberships
    : [];
  if (memberships.length) {
    return [
      ...new Set(
        memberships
          .filter(isWorkOrdersBusinessUnit)
          .map((unit) => unit.id || unit.businessUnitId)
          .filter(Boolean),
      ),
    ];
  }

  const businessUnitIds = Array.isArray(user?.businessUnitIds) ? user.businessUnitIds.filter(Boolean) : [];
  const namesById = user?.businessUnitNamesById && typeof user.businessUnitNamesById === 'object'
    ? user.businessUnitNamesById
    : {};
  const namedIds = businessUnitIds.filter((id) => isWorkOrdersBusinessUnit({ name: namesById[id] }));
  if (Object.keys(namesById).length) return namedIds;

  return businessUnitIds;
}

export function canUseWorkOrdersWorkspace(user = {}) {
  const allowedIds = workOrderBusinessUnitIdsForUser(user);
  return allowedIds === null || allowedIds.length > 0;
}

export function canUseWorkOrderBusinessUnit(session = {}, businessUnitId = '') {
  if (!businessUnitId) return false;
  const allowedIds = workOrderBusinessUnitIdsForUser(session?.user);
  return allowedIds === null || allowedIds.includes(businessUnitId);
}

export function canUseWorkOrdersForBusinessUnit(user = {}, businessUnit = {}) {
  if (!businessUnit?.id || !isWorkOrdersBusinessUnit(businessUnit)) return false;
  const allowedIds = workOrderBusinessUnitIdsForUser(user);
  return allowedIds === null || allowedIds.includes(businessUnit.id);
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
  if (!canUseWorkOrderBusinessUnit(session, businessUnitId)) return false;
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
  const normalizedPath = String(pathname || '/').split(/[?#]/)[0] || '/';
  if (normalizedPath === '/work-orders' || normalizedPath.startsWith('/work-orders/')) {
    return canUseWorkOrdersWorkspace(user);
  }
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
