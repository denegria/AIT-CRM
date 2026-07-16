import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { createCrmError } from './errors.js';
import { isUuid } from './validation.js';
export {
  ROLE_KEYS,
  canAccessContactLead,
  canAccessWorkOrder,
  canArchiveContactsDirectly,
  canManageCoordinatorAssignments,
  canUseTeamMonitorWorkspace,
  canUseWorkOrderBusinessUnit,
  divisionWideContactBusinessUnitIdsForUser,
  filterTeamMonitorEmployees,
  filterTeamMonitorContacts,
  filterContactsForSession,
  isRegularCoordinatorSession,
  isWorkOrderSelfScopedSession,
  isSeniorCoordinatorSession,
  latestLeadByContactId,
  userHasRole,
  workOrderBusinessUnitIdsForUser,
} from './coordinator-policy.js';
import {
  canAccessContactLead,
  canAccessWorkOrder,
  canUseWorkOrderBusinessUnit,
  divisionWideContactBusinessUnitIdsForUser,
  isRegularCoordinatorSession,
  isWorkOrderSelfScopedSession,
  workOrderBusinessUnitIdsForUser,
} from './coordinator-policy.js';

export function canAccessBusinessUnit(session, businessUnitId) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    session.user.businessUnitIds.includes(businessUnitId)
  );
}

export function canAccessContact(session, contact) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    !contact.primaryBusinessUnitId ||
    session.user.businessUnitIds.includes(contact.primaryBusinessUnitId)
  );
}

export function businessUnitScope(column, session) {
  if (session.user.canAccessAllBusinessUnits) return undefined;
  if (!session.user.businessUnitIds.length) return sql`false`;
  return inArray(column, session.user.businessUnitIds);
}

export function scopedOrgWhere(table, session) {
  return eq(table.organizationId, session.user.organizationId);
}

export function scopedBusinessUnitWhere(table, session) {
  const orgScope = scopedOrgWhere(table, session);
  const buScope = businessUnitScope(table.businessUnitId, session);
  return buScope ? and(orgScope, buScope) : orgScope;
}

export function scopedContactWhere(table, session) {
  const orgScope = and(scopedOrgWhere(table, session), isNull(table.archivedAt));
  if (session.user.canAccessAllBusinessUnits) return orgScope;
  if (!session.user.businessUnitIds.length) {
    return and(orgScope, isNull(table.primaryBusinessUnitId));
  }
  return and(
    orgScope,
    or(
      isNull(table.primaryBusinessUnitId),
      inArray(table.primaryBusinessUnitId, session.user.businessUnitIds),
    ),
  );
}

export function scopedTeamMonitorContactWhere(table, session) {
  const orgScope = and(scopedOrgWhere(table, session), isNull(table.archivedAt));
  if (session.user.canAccessAllBusinessUnits) return orgScope;
  if (!session.user.businessUnitIds.length) return and(orgScope, sql`false`);
  return and(orgScope, inArray(table.primaryBusinessUnitId, session.user.businessUnitIds));
}

export function contactLeadAccessWhere(contactTable, leadTable, session) {
  if (!isRegularCoordinatorSession(session)) return undefined;
  const ownerScope = eq(leadTable.assignedUserId, session.user.id);
  const divisionWideIds = divisionWideContactBusinessUnitIdsForUser(session.user);
  if (divisionWideIds === null) return undefined;
  if (!divisionWideIds.length) return ownerScope;
  return or(
    ownerScope,
    inArray(contactTable.primaryBusinessUnitId, divisionWideIds),
    inArray(leadTable.businessUnitId, divisionWideIds),
  );
}

export function scopedTaskWhere(table, session) {
  const orgScope = scopedBusinessUnitWhere(table, session);
  if (!isRegularCoordinatorSession(session)) return orgScope;
  return and(orgScope, eq(table.ownerUserId, session.user.id));
}

export function scopedWorkOrderWhere(table, session) {
  if (!isWorkOrderSelfScopedSession(session)) return scopedBusinessUnitWhere(table, session);

  const orgScope = scopedOrgWhere(table, session);
  const allowedWorkOrderBusinessUnitIds = workOrderBusinessUnitIdsForUser(session.user);
  if (Array.isArray(allowedWorkOrderBusinessUnitIds) && !allowedWorkOrderBusinessUnitIds.length) {
    return sql`false`;
  }

  const businessUnitScope = Array.isArray(allowedWorkOrderBusinessUnitIds)
    ? inArray(table.businessUnitId, allowedWorkOrderBusinessUnitIds)
    : undefined;

  return and(
    orgScope,
    businessUnitScope,
    eq(table.assignedUserId, session.user.id),
  );
}

export function assertCanAccessContactLead(session, lead = null, contact = null) {
  if (!canAccessContactLead(session, lead, contact)) {
    throw createCrmError('Regular coordinators can only access assigned contacts or shared AIT Signs contacts.', 403);
  }
}

export function assertCanAssignWorkOrderUser(session, userId, message = 'This user can only manage work orders assigned to them.') {
  if (isWorkOrderSelfScopedSession(session) && userId !== session.user.id) {
    throw createCrmError(message, 403);
  }
}

export function assertCanUseWorkOrderBusinessUnit(session, businessUnitId, message = 'This account can only use AIT Signs work orders assigned to them.') {
  if (isWorkOrderSelfScopedSession(session) && !canUseWorkOrderBusinessUnit(session, businessUnitId)) {
    throw createCrmError(message, 403);
  }
}

export function assertCanAssignUser(session, userId, message = 'Regular coordinators cannot assign work to other users.') {
  if (isRegularCoordinatorSession(session) && userId !== session.user.id) {
    throw createCrmError(message, 403);
  }
}

export async function resolveBusinessUnitId({
  db,
  session,
  businessUnitsTable,
  requestedId,
}) {
  if (requestedId) {
    if (!isUuid(requestedId)) {
      throw createCrmError('A valid business unit id is required.');
    }

    const [row] = await db
      .select({ id: businessUnitsTable.id })
      .from(businessUnitsTable)
      .where(and(eq(businessUnitsTable.id, requestedId), eq(businessUnitsTable.organizationId, session.user.organizationId)))
      .limit(1);

    if (!row) {
      throw createCrmError('Business unit not found.');
    }

    if (canAccessBusinessUnit(session, requestedId)) {
      return row.id;
    }

    throw createCrmError('Insufficient business-unit access.', 403);
  }

  if (!session.user.canAccessAllBusinessUnits && session.user.businessUnitIds.length) {
    return session.user.primaryBusinessUnitId || session.user.businessUnitIds[0];
  }

  const [row] = await db
    .select({ id: businessUnitsTable.id })
    .from(businessUnitsTable)
    .where(eq(businessUnitsTable.organizationId, session.user.organizationId))
    .orderBy(businessUnitsTable.name)
    .limit(1);

  return row?.id || null;
}

export async function resolveOptionalBusinessUnitId(args) {
  if (!args.requestedId) return null;
  return resolveBusinessUnitId(args);
}

export async function resolveContactById({
  db,
  session,
  contactsTable,
  contactId,
}) {
  if (!contactId) return null;
  if (!isUuid(contactId)) {
    throw createCrmError('A valid contact id is required.');
  }

  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.organizationId, session.user.organizationId)))
    .limit(1);

  if (!contact) {
    throw createCrmError('Contact not found.', 404);
  }

  if (!canAccessContact(session, contact)) {
    throw createCrmError('Insufficient business-unit access for this contact.', 403);
  }

  return contact;
}
