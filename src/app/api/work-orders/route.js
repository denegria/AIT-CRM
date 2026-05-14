import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { activityEvents, businessUnits, contacts, leads, workOrders } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

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

function canAccessBusinessUnit(session, businessUnitId) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    session.user.businessUnitIds.includes(businessUnitId)
  );
}

function canAccessContact(session, contact) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    !contact.primaryBusinessUnitId ||
    session.user.businessUnitIds.includes(contact.primaryBusinessUnitId)
  );
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
    dueDate: toDateOnly(row.deliveryDate),
    description: row.description || '',
    estimatedCost: Number(row.estimatedCost || 0),
  };
}

function businessUnitError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function businessUnitErrorResponse(error) {
  if (!error?.status) throw error;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

async function resolveBusinessUnitId(db, session, requestedId) {
  if (requestedId) {
    if (!isUuid(requestedId)) {
      throw businessUnitError('A valid business unit id is required.');
    }
    const [row] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, requestedId), eq(businessUnits.organizationId, session.user.organizationId)))
      .limit(1);

    if (!row) throw businessUnitError('Business unit not found.');
    if (canAccessBusinessUnit(session, requestedId)) return requestedId;
    throw businessUnitError('Insufficient business-unit access.', 403);
  }

  if (!session.user.canAccessAllBusinessUnits && session.user.businessUnitIds.length) {
    return session.user.businessUnitIds[0];
  }

  const [row] = await db
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, session.user.organizationId))
    .orderBy(businessUnits.name)
    .limit(1);

  if (!row?.id) throw businessUnitError('No business units available for this organization.');
  return row.id;
}

async function resolveContact(db, session, contactId) {
  if (!contactId) return null;
  if (!isUuid(contactId)) {
    throw businessUnitError('A valid contact id is required.');
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, session.user.organizationId)))
    .limit(1);

  if (!contact) throw businessUnitError('Contact not found.', 404);
  if (!canAccessContact(session, contact)) {
    throw businessUnitError('Insufficient business-unit access for this contact.', 403);
  }
  return contact;
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

async function resolveCreateBusinessUnitId(db, session, body, contact) {
  const requestedId = String(body.businessUnitId || '').trim();
  if (contact?.primaryBusinessUnitId) {
    if (requestedId && requestedId !== contact.primaryBusinessUnitId) {
      throw businessUnitError('Work order division must match the selected contact.');
    }
    return resolveBusinessUnitId(db, session, contact.primaryBusinessUnitId);
  }
  return resolveBusinessUnitId(db, session, requestedId);
}

function canAccessWorkOrder(session, workOrder) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    session.user.businessUnitIds.includes(workOrder.businessUnitId)
  );
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.WORK_ORDERS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Work order title is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await resolveContact(db, session, String(body.contactId || '').trim());
    const businessUnitId = await resolveCreateBusinessUnitId(db, session, body, contact);
    const leadId = await resolveLeadId(db, contact?.id || null);

    const [workOrder] = await db
      .insert(workOrders)
      .values({
        organizationId: session.user.organizationId,
        businessUnitId,
        contactId: contact?.id || null,
        leadId,
        workOrderNumber: String(body.number || '').trim() || null,
        title,
        status: String(body.status || 'Pending').trim() || 'Pending',
        priority: String(body.priority || 'Medium').trim() || 'Medium',
        assignedUserId: isUuid(body.assignedTo) ? body.assignedTo : null,
        deliveryDate: parseDeliveryDate(body.dueDate),
        description: String(body.description || '').trim() || null,
        estimatedCost: parseEstimatedCost(body.estimatedCost),
      })
      .returning();

    await db.insert(activityEvents).values({
      organizationId: session.user.organizationId,
      businessUnitId: workOrder.businessUnitId,
      contactId: workOrder.contactId,
      leadId: workOrder.leadId,
      workOrderId: workOrder.id,
      eventType: 'work_order.created',
      message: `Created work order ${workOrder.workOrderNumber || workOrder.id}.`,
      actorUserId: session.user.id,
      occurredAt: new Date(),
    });

    return NextResponse.json({ workOrder: toWorkOrderPayload(workOrder, contact) }, { status: 201 });
  } catch (err) {
    return businessUnitErrorResponse(err);
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
    const contact = await resolveContact(db, session, requestedContactId);
    const requestedBusinessUnitId = Object.prototype.hasOwnProperty.call(body, 'businessUnitId')
      ? String(body.businessUnitId || '').trim()
      : existing.businessUnitId;

    let businessUnitId = existing.businessUnitId;
    if (contact?.primaryBusinessUnitId) {
      if (requestedBusinessUnitId && requestedBusinessUnitId !== contact.primaryBusinessUnitId) {
        throw businessUnitError('Work order division must match the selected contact.');
      }
      businessUnitId = await resolveBusinessUnitId(db, session, contact.primaryBusinessUnitId);
    } else if (Object.prototype.hasOwnProperty.call(body, 'businessUnitId')) {
      businessUnitId = await resolveBusinessUnitId(db, session, requestedBusinessUnitId);
    }

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
    if (Object.prototype.hasOwnProperty.call(body, 'assignedTo')) patch.assignedUserId = isUuid(body.assignedTo) ? body.assignedTo : null;
    if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) patch.deliveryDate = parseDeliveryDate(body.dueDate);
    if (Object.prototype.hasOwnProperty.call(body, 'description')) patch.description = String(body.description || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(body, 'estimatedCost')) patch.estimatedCost = parseEstimatedCost(body.estimatedCost);
    patch.leadId = await resolveLeadId(db, patch.contactId ?? existing.contactId);

    const [workOrder] = await db
      .update(workOrders)
      .set(patch)
      .where(eq(workOrders.id, id))
      .returning();

    await db.insert(activityEvents).values({
      organizationId: session.user.organizationId,
      businessUnitId: workOrder.businessUnitId,
      contactId: workOrder.contactId,
      leadId: workOrder.leadId,
      workOrderId: workOrder.id,
      eventType: 'work_order.updated',
      message: `Updated work order ${workOrder.workOrderNumber || workOrder.id}.`,
      actorUserId: session.user.id,
      occurredAt: new Date(),
    });

    return NextResponse.json({ workOrder: toWorkOrderPayload(workOrder, contact) });
  } catch (err) {
    return businessUnitErrorResponse(err);
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

  await db
    .delete(workOrders)
    .where(eq(workOrders.id, id));

  await db.insert(activityEvents).values({
    organizationId: session.user.organizationId,
    businessUnitId: existing.businessUnitId,
    contactId: existing.contactId,
    leadId: existing.leadId,
    workOrderId: null,
    eventType: 'work_order.deleted',
    message: `Deleted work order ${existing.workOrderNumber || existing.id}.`,
    actorUserId: session.user.id,
    occurredAt: new Date(),
  });

  return NextResponse.json({ ok: true, id });
}
