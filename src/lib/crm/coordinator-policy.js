export const ROLE_KEYS = Object.freeze({
  ADMIN: 'admin',
  SENIOR_COORDINATOR: 'senior_coordinator',
  ACCOUNT_MANAGER: 'account_manager',
  SALES_MANAGER: 'sales_manager',
});

export function userHasRole(user = {}, roleKey) {
  const roleKeys = Array.isArray(user?.roleKeys) ? user.roleKeys : [];
  return user?.primaryRoleKey === roleKey || roleKeys.includes(roleKey);
}

export function isSeniorCoordinatorSession(session = {}) {
  return userHasRole(session.user, ROLE_KEYS.SENIOR_COORDINATOR);
}

export function isRegularCoordinatorSession(session = {}) {
  const roleKeys = Array.isArray(session?.user?.roleKeys) ? session.user.roleKeys : [];
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
