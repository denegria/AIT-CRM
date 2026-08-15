import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  businessUnits,
  contacts,
  roles,
  userRoles,
  users,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  assertCanAssignUser,
  assertCanAccessContactLead,
  canAccessBusinessUnit,
  canAccessContact,
  isRegularCoordinatorSession,
} from '@/lib/crm/access.js';
import { isAssignableEmployee } from '@/lib/crm/assignable-employees.js';
import {
  isClosedLifecycleStatus,
  requireLifecycleStatus,
  WORKFLOW_KEYS,
  workflowKeyForBusinessUnit,
} from '@/lib/crm/lifecycle.js';
import {
  startAitUsaOpportunity,
  toStartedOpportunityContactPayload,
} from '@/lib/crm/ait-usa-opportunities.js';
import { isUuid } from '@/lib/crm/validation.js';

function jsonError(error, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function resolveStartOpportunityOwner(db, session, requestedOwnerId, businessUnitId) {
  const assignedUserId = isRegularCoordinatorSession(session)
    ? session.user.id
    : String(requestedOwnerId || '').trim() || null;
  if (!assignedUserId) return null;
  if (!isUuid(assignedUserId)) throw Object.assign(new Error('Assigned user must be a valid user id.'), { status: 400 });
  assertCanAssignUser(session, assignedUserId);

  const [assignedUser] = await db
    .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
    .from(users)
    .where(and(
      eq(users.id, assignedUserId),
      eq(users.organizationId, session.user.organizationId),
    ))
    .limit(1);
  if (!assignedUser || assignedUser.isActive === false) {
    throw Object.assign(new Error('Selected assignee is not active in this organization.'), { status: 400 });
  }

  const [roleRows, membershipRows] = await Promise.all([
    db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(
        eq(userRoles.userId, assignedUserId),
        eq(roles.organizationId, session.user.organizationId),
      )),
    db
      .select({ businessUnitId: businessUnitMemberships.businessUnitId })
      .from(businessUnitMemberships)
      .where(eq(businessUnitMemberships.userId, assignedUserId)),
  ]);
  const roleKeys = roleRows.map((row) => row.key).filter(Boolean);
  if (!isAssignableEmployee({ ...assignedUser, roleKeys })) {
    throw Object.assign(new Error('Selected assignee is not assignable to CRM Opportunities.'), { status: 400 });
  }
  if (roleKeys.includes('admin') || membershipRows.some((row) => row.businessUnitId === businessUnitId)) {
    return assignedUserId;
  }
  throw Object.assign(new Error('Selected assignee does not belong to this Opportunity business unit.'), { status: 400 });
}

export async function POST(
  request,
  { params },
  {
    requirePermissionForRequest = requirePermission,
    getDbForRequest = getDb,
    startOpportunityForRequest = startAitUsaOpportunity,
  } = {},
) {
  const { error, session } = await requirePermissionForRequest(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id: contactId } = await params;
  if (!isUuid(contactId)) return jsonError('A valid contact id is required.');
  const body = await request.json().catch(() => ({}));
  const businessUnitId = String(body.businessUnitId || '').trim();
  if (!isUuid(businessUnitId)) return jsonError('A valid business unit id is required.');
  if (!String(body.status || '').trim()) return jsonError('An initial Opportunity status is required.');

  const db = getDbForRequest();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.organizationId, session.user.organizationId),
    ))
    .limit(1);
  if (!contact) return jsonError('Contact not found.', 404);
  if (!canAccessContact(session, contact)) return jsonError('Insufficient business-unit access.', 403);
  try {
    assertCanAccessContactLead(session, null, contact);
  } catch (accessError) {
    return jsonError(accessError.message, accessError.status || 403);
  }
  if (contact.primaryBusinessUnitId !== businessUnitId) {
    return jsonError('Opportunity business unit must match the Contact business unit.', 409);
  }
  if (!canAccessBusinessUnit(session, businessUnitId)) {
    return jsonError('Insufficient business-unit access.', 403);
  }

  const [businessUnit] = await db
    .select({ id: businessUnits.id, name: businessUnits.name, label: businessUnits.label })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
      eq(businessUnits.isActive, true),
    ))
    .limit(1);
  if (!businessUnit) return jsonError('Business unit not found.', 404);
  if (workflowKeyForBusinessUnit(businessUnit) !== WORKFLOW_KEYS.AIT_USA) {
    return jsonError('Start opportunity is available only for AIT USA Contacts.');
  }

  let status;
  try {
    status = requireLifecycleStatus(body.status, { businessUnit });
  } catch (statusError) {
    return jsonError(statusError.message);
  }
  const reason = String(body.reason || '').trim();
  if (isClosedLifecycleStatus(status, { businessUnit }) && !reason) {
    return jsonError('A reason is required to start an Opportunity in a closed status.');
  }

  let assignedUserId;
  try {
    assignedUserId = await resolveStartOpportunityOwner(db, session, body.assignedTo, businessUnitId);
  } catch (assignmentError) {
    return jsonError(assignmentError.message, assignmentError.status || 400);
  }

  const result = await startOpportunityForRequest({
    db,
    organizationId: session.user.organizationId,
    businessUnit,
    contact,
    actorUserId: session.user.id,
    assignedUserId,
    status,
    reason: reason || null,
  });
  if (result.status === 'ambiguous') {
    return jsonError('This Contact has multiple active Opportunities. Review and resolve the conflict before editing status.', 409);
  }
  if (result.status === 'exact') {
    return jsonError('This Contact already has an active Opportunity.', 409);
  }

  return NextResponse.json({
    contact: toStartedOpportunityContactPayload(contact, result.opportunity, businessUnit),
    opportunity: {
      id: result.opportunity.id,
      status: result.opportunity.status,
      currentStage: result.opportunity.currentStage,
      assignedTo: result.opportunity.assignedUserId || '',
    },
  }, { status: 201 });
}
