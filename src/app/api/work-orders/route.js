import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnitMemberships,
  businessUnits,
  contacts,
  estimates,
  leads,
  roles,
  userRoles,
  users,
  workOrders,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessBusinessUnit,
  canAccessWorkOrder,
  assertCanUseWorkOrderBusinessUnit,
  assertCanAssignWorkOrderUser,
  resolveBusinessUnitId,
  resolveContactById,
} from '@/lib/crm/access.js';
import { isAssignableEmployee } from '@/lib/crm/assignable-employees.js';
import { isWorkOrderSelfScopedSession } from '@/lib/crm/coordinator-policy.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createWorkOrderWithActivity,
  deleteWorkOrderWithActivity,
  updateWorkOrderWithActivity,
} from '@/lib/crm/write-helpers.js';

function toDateOnly(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseEstimatedCost(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseDeliveryDate(value) {
  if (!value) return null;
  const dateString = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? dateString : null;
}

function toWorkOrderPayload(row, contact = null) {
  return {
    id: row.id,
    number: row.workOrderNumber || '',
    title: row.title || row.status || 'Work Order',
    client: contact?.name || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    priority: row.priority || 'Medium',
    status: row.status || 'Pending',
    assignedTo: row.assignedUserId || '',
    estimateId: row.estimateId || '',
    dueDate: toDateOnly(row.deliveryDate),
    description: row.description || '',
    estimatedCost: Number(row.estimatedCost || 0),
  };
}

async function resolveLeadId(db, contactId) {
  if (!contactId) return null;
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.contactId, contactId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead?.id || null;
}

async function resolveEstimateId(db, session, estimateId, { businessUnitId, contact } = {}) {
  const requestedId = String(estimateId || '').trim();
  if (!requestedId) return null;
  if (!isUuid(requestedId)) throw createCrmError('A valid estimate id is required.');

  const [estimate] = await db
    .select()
    .from(estimates)
    .where(and(
      eq(estimates.id, requestedId),
      eq(estimates.organizationId, session.user.organizationId),
    ))
    .limit(1);

  if (!estimate) throw createCrmError('Estimate not found.', 404);
  if (!canAccessBusinessUnit(session, estimate.businessUnitId)) {
    throw createCrmError('Insufficient business-unit access for this estimate.', 403);
  }
  if (businessUnitId && estimate.businessUnitId !== businessUnitId) {
    throw createCrmError('Estimate division must match the work order division.');
  }
  if (contact?.id && estimate.contactId && estimate.contactId !== contact.id) {
    throw createCrmError('Estimate must belong to the selected contact.');
  }
  return estimate.id;
}

async function resolveAssignedUserId(db, session, assignedTo, businessUnitId) {
  const assignedUserId = String(assignedTo || (isWorkOrderSelfScopedSession(session) ? session.user.id : '')).trim();
  if (!assignedUserId) return null;
  if (!isUuid(assignedUserId)) throw createCrmError('A valid assignee is required.');
  assertCanAssignWorkOrderUser(session, assignedUserId);

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
    .from(users)
    .where(and(
      eq(users.id, assignedUserId),
      eq(users.organizationId, session.user.organizationId),
    ))
    .limit(1);

  if (!user || user.isActive === false) throw createCrmError('Selected assignee is not active in this organization.');

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
  if (!isAssignableEmployee({ ...user, roleKeys })) {
    throw createCrmError('Selected assignee is not assignable to work orders.');
  }
  if (roleKeys.includes('admin')) return assignedUserId;
  if (businessUnitId && membershipRows.some((row) => row.businessUnitId === businessUnitId)) return assignedUserId;
  throw createCrmError('Selected assignee does not belong to this work order division.');
}

async function resolveCreateBusinessUnitId(db, session, body, contact) {
  const requestedId = String(body.businessUnitId || '').trim();
  if (contact?.primaryBusinessUnitId) {
    if (requestedId && requestedId !== contact.primaryBusinessUnitId) {
      throw createCrmError('Work order division must match the selected contact.');
    }
    return resolveBusinessUnitId({ db, session, businessUnitsTable: businessUnits, requestedId: contact.primaryBusinessUnitId });
  }
  const businessUnitId = await resolveBusinessUnitId({ db, session, businessUnitsTable: businessUnits, requestedId });
  if (!businessUnitId) {
    throw createCrmError('No business units available for this organization.');
  }
  return businessUnitId;
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.WORK_ORDERS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Work order title is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: String(body.contactId || '').trim(),
    });
    const businessUnitId = await resolveCreateBusinessUnitId(db, session, body, contact);
    assertCanUseWorkOrderBusinessUnit(session, businessUnitId);
    const leadId = await resolveLeadId(db, contact?.id || null);
    const estimateId = await resolveEstimateId(db, session, body.estimateId, { businessUnitId, contact });
    const assignedUserId = await resolveAssignedUserId(db, session, body.assignedTo, businessUnitId);

    const { workOrder } = await createWorkOrderWithActivity({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      workOrderValues: {
        businessUnitId,
        contactId: contact?.id || null,
        leadId,
        estimateId,
        workOrderNumber: String(body.number || '').trim() || null,
        title,
        status: String(body.status || 'Pending').trim() || 'Pending',
        priority: String(body.priority || 'Medium').trim() || 'Medium',
        assignedUserId,
        deliveryDate: parseDeliveryDate(body.dueDate),
        description: String(body.description || '').trim() || null,
        estimatedCost: parseEstimatedCost(body.estimatedCost),
      },
    });

    return NextResponse.json({ workOrder: toWorkOrderPayload(workOrder, contact) }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.WORK_ORDERS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid work order id is required.' }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, session.user.organizationId)))
    .limit(1);

  if (!existing) return NextResponse.json({ error: 'Work order not found.' }, { status: 404 });
  if (!canAccessWorkOrder(session, existing)) {
    return NextResponse.json({ error: 'Insufficient business-unit access.' }, { status: 403 });
  }

  try {
    const contactProvided = Object.prototype.hasOwnProperty.call(body, 'contactId');
    const requestedContactId = contactProvided ? String(body.contactId || '').trim() : existing.contactId || '';
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: requestedContactId,
    });
    const requestedBusinessUnitId = Object.prototype.hasOwnProperty.call(body, 'businessUnitId')
      ? String(body.businessUnitId || '').trim()
      : existing.businessUnitId;

    let businessUnitId = existing.businessUnitId;
    if (contact?.primaryBusinessUnitId) {
      if (requestedBusinessUnitId && requestedBusinessUnitId !== contact.primaryBusinessUnitId) {
        throw createCrmError('Work order division must match the selected contact.');
      }
      businessUnitId = await resolveBusinessUnitId({ db, session, businessUnitsTable: businessUnits, requestedId: contact.primaryBusinessUnitId });
    } else if (Object.prototype.hasOwnProperty.call(body, 'businessUnitId')) {
      businessUnitId = await resolveBusinessUnitId({ db, session, businessUnitsTable: businessUnits, requestedId: requestedBusinessUnitId });
      if (!businessUnitId) {
        throw createCrmError('No business units available for this organization.');
      }
    }
    assertCanUseWorkOrderBusinessUnit(session, businessUnitId);

    const patch = { updatedAt: new Date(), businessUnitId };
    if (contactProvided) patch.contactId = contact?.id || null;
    if (Object.prototype.hasOwnProperty.call(body, 'number')) patch.workOrderNumber = String(body.number || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      const title = String(body.title || '').trim();
      if (!title) return NextResponse.json({ error: 'Work order title is required.' }, { status: 400 });
      patch.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) patch.status = String(body.status || '').trim() || 'Pending';
    if (Object.prototype.hasOwnProperty.call(body, 'priority')) patch.priority = String(body.priority || '').trim() || 'Medium';
    if (Object.prototype.hasOwnProperty.call(body, 'assignedTo')) {
      patch.assignedUserId = await resolveAssignedUserId(db, session, body.assignedTo, businessUnitId);
    } else if (businessUnitId !== existing.businessUnitId && existing.assignedUserId) {
      patch.assignedUserId = await resolveAssignedUserId(db, session, existing.assignedUserId, businessUnitId);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'estimateId')) {
      patch.estimateId = await resolveEstimateId(db, session, body.estimateId, { businessUnitId, contact });
    } else if ((businessUnitId !== existing.businessUnitId || contactProvided) && existing.estimateId) {
      patch.estimateId = await resolveEstimateId(db, session, existing.estimateId, { businessUnitId, contact });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) patch.deliveryDate = parseDeliveryDate(body.dueDate);
    if (Object.prototype.hasOwnProperty.call(body, 'description')) patch.description = String(body.description || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(body, 'estimatedCost')) patch.estimatedCost = parseEstimatedCost(body.estimatedCost);
    patch.leadId = await resolveLeadId(db, patch.contactId ?? existing.contactId);

    const { workOrder } = await updateWorkOrderWithActivity({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      workOrderId: id,
      workOrderPatch: patch,
    });

    return NextResponse.json({ workOrder: toWorkOrderPayload(workOrder, contact) });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.WORK_ORDERS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid work order id is required.' }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, session.user.organizationId)))
    .limit(1);

  if (!existing) return NextResponse.json({ error: 'Work order not found.' }, { status: 404 });
  if (!canAccessWorkOrder(session, existing)) {
    return NextResponse.json({ error: 'Insufficient business-unit access.' }, { status: 403 });
  }

  await deleteWorkOrderWithActivity({
    db,
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
    existingWorkOrder: existing,
  });

  return NextResponse.json({ ok: true, id });
}
