import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnits,
  contacts,
  leads,
  tasks,
  users,
  workOrders,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessBusinessUnit,
  resolveBusinessUnitId,
  resolveContactById,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  buildTaskTransition,
  normalizeTaskPriority,
  normalizeTaskStatus,
  normalizeTaskType,
  parseTaskStatusFilter,
  parseTaskTypeFilter,
  parseTaskDateTime,
} from '@/lib/tasks/policy.js';
import {
  compactTaskPatch,
  createTaskWithEvents,
  listTasks,
  toTaskPayload,
  updateTaskWithEvents,
} from '@/lib/tasks/service.js';

function stringParam(value) {
  return String(value || '').trim();
}

function optionalUuid(value, fieldName) {
  const id = stringParam(value);
  if (!id) return null;
  if (!isUuid(id)) throw createCrmError(`${fieldName} must be a valid id.`);
  return id;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function endOfToday() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function resolveOrganizationUserId(db, session, value, fieldName = 'ownerUserId') {
  const id = optionalUuid(value, fieldName);
  if (!id) return null;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, session.user.organizationId)))
    .limit(1);

  if (!user) throw createCrmError('Task owner not found.', 404);
  return user.id;
}

async function resolveLatestLeadForContact(db, organizationId, contactId) {
  if (!contactId) return null;
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
}

async function resolveLeadById(db, session, leadId) {
  if (!leadId) return null;
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, session.user.organizationId)))
    .limit(1);

  if (!lead) throw createCrmError('Lead not found.', 404);
  if (!canAccessBusinessUnit(session, lead.businessUnitId)) {
    throw createCrmError('Insufficient business-unit access for this lead.', 403);
  }
  return lead;
}

async function resolveWorkOrderById(db, session, workOrderId) {
  if (!workOrderId) return null;
  const [workOrder] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, session.user.organizationId)))
    .limit(1);

  if (!workOrder) throw createCrmError('Work order not found.', 404);
  if (!canAccessBusinessUnit(session, workOrder.businessUnitId)) {
    throw createCrmError('Insufficient business-unit access for this work order.', 403);
  }
  return workOrder;
}

function assertConsistentBusinessUnit(currentId, nextId, message) {
  if (currentId && nextId && currentId !== nextId) {
    throw createCrmError(message);
  }
  return currentId || nextId || null;
}

async function resolveTaskLinks(db, session, body) {
  const requestedBusinessUnitId = stringParam(body.businessUnitId);
  const contactId = optionalUuid(body.contactId, 'contactId');
  const requestedLeadId = optionalUuid(body.leadId, 'leadId');
  const workOrderId = optionalUuid(body.workOrderId, 'workOrderId');

  const contact = await resolveContactById({
    db,
    session,
    contactsTable: contacts,
    contactId,
  });
  const explicitLead = await resolveLeadById(db, session, requestedLeadId);
  const latestContactLead = contact && !explicitLead
    ? await resolveLatestLeadForContact(db, session.user.organizationId, contact.id)
    : null;
  const lead = explicitLead || latestContactLead;
  const workOrder = await resolveWorkOrderById(db, session, workOrderId);

  if (contact && lead?.contactId && lead.contactId !== contact.id) {
    throw createCrmError('Task lead must belong to the selected contact.');
  }
  if (contact && workOrder?.contactId && workOrder.contactId !== contact.id) {
    throw createCrmError('Task work order must belong to the selected contact.');
  }
  if (lead && workOrder?.leadId && workOrder.leadId !== lead.id) {
    throw createCrmError('Task work order must belong to the selected lead.');
  }

  let businessUnitId = null;
  businessUnitId = assertConsistentBusinessUnit(
    businessUnitId,
    contact?.primaryBusinessUnitId || null,
    'Task division must match the selected contact.',
  );
  businessUnitId = assertConsistentBusinessUnit(
    businessUnitId,
    lead?.businessUnitId || null,
    'Task division must match the selected lead.',
  );
  businessUnitId = assertConsistentBusinessUnit(
    businessUnitId,
    workOrder?.businessUnitId || null,
    'Task division must match the selected work order.',
  );

  if (requestedBusinessUnitId) {
    const resolved = await resolveBusinessUnitId({
      db,
      session,
      businessUnitsTable: businessUnits,
      requestedId: requestedBusinessUnitId,
    });
    businessUnitId = assertConsistentBusinessUnit(
      businessUnitId,
      resolved,
      'Task division must match the linked records.',
    );
  }

  if (!businessUnitId) {
    businessUnitId = await resolveBusinessUnitId({
      db,
      session,
      businessUnitsTable: businessUnits,
      requestedId: '',
    });
  }
  if (!businessUnitId) throw createCrmError('No business units available for this organization.');

  return {
    businessUnitId,
    contactId: contact?.id || null,
    leadId: lead?.id || null,
    workOrderId: workOrder?.id || null,
  };
}

function taskBodyPayload(body) {
  const payload = {};
  for (const key of ['title', 'description', 'taskType', 'priority', 'snoozedUntil']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key];
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dueAt')) payload.dueAt = body.dueAt;
  if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) payload.dueAt = body.dueDate;
  return payload;
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(request.url);

  try {
    const requestedBusinessUnitId = stringParam(searchParams.get('businessUnitId'));
    let businessUnitIds = session.user.canAccessAllBusinessUnits
      ? null
      : session.user.businessUnitIds;

    const filters = {
      contactId: optionalUuid(searchParams.get('contactId'), 'contactId'),
      leadId: optionalUuid(searchParams.get('leadId'), 'leadId'),
      workOrderId: optionalUuid(searchParams.get('workOrderId'), 'workOrderId'),
      ownerUserId: optionalUuid(searchParams.get('ownerUserId'), 'ownerUserId'),
      unassigned: parseBoolean(searchParams.get('unassigned')),
      status: stringParam(searchParams.get('status')),
      taskType: stringParam(searchParams.get('taskType')),
    };

    if (requestedBusinessUnitId) {
      filters.businessUnitId = await resolveBusinessUnitId({
        db,
        session,
        businessUnitsTable: businessUnits,
        requestedId: requestedBusinessUnitId,
      });
      businessUnitIds = [filters.businessUnitId];
    }
    if (filters.status) filters.status = parseTaskStatusFilter(filters.status);
    if (filters.taskType) filters.taskType = parseTaskTypeFilter(filters.taskType);

    const due = stringParam(searchParams.get('due'));
    if (due === 'overdue') filters.dueBefore = new Date();
    if (due === 'today') filters.dueBefore = endOfToday();

    const rows = await listTasks({
      db,
      organizationId: session.user.organizationId,
      businessUnitIds,
      filters,
    });
    return NextResponse.json({ tasks: rows.map(toTaskPayload) });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const title = stringParam(body.title);
  if (!title) {
    return NextResponse.json({ error: 'Task title is required.' }, { status: 400 });
  }

  const db = getDb();
  try {
    const links = await resolveTaskLinks(db, session, body);
    const ownerUserId = await resolveOrganizationUserId(
      db,
      session,
      body.ownerUserId || body.assignedTo,
    );
    const dueAt = parseTaskDateTime(body.dueAt || body.dueDate, 'dueAt');

    const { task } = await createTaskWithEvents({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      taskValues: {
        ...links,
        title,
        description: stringParam(body.description) || null,
        taskType: normalizeTaskType(body.taskType),
        status: normalizeTaskStatus(body.status),
        priority: normalizeTaskPriority(body.priority),
        dueAt,
        ownerUserId,
        sourceType: stringParam(body.sourceType) || 'manual',
        sourceId: stringParam(body.sourceId) || null,
        sourceLabel: stringParam(body.sourceLabel) || null,
        metadataJson: body.metadataJson && typeof body.metadataJson === 'object'
          ? body.metadataJson
          : {},
      },
      eventMessage: 'Created task.',
    });

    return NextResponse.json({ task: toTaskPayload(task) }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = stringParam(body.id);
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid task id is required.' }, { status: 400 });
  }

  const db = getDb();
  try {
    const [existingTask] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, session.user.organizationId)))
      .limit(1);

    if (!existingTask) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    if (!canAccessBusinessUnit(session, existingTask.businessUnitId)) {
      return NextResponse.json({ error: 'Insufficient business-unit access.' }, { status: 403 });
    }

    const ownerInput = Object.prototype.hasOwnProperty.call(body, 'ownerUserId')
      ? body.ownerUserId
      : body.assignedTo;
    const ownerUserId = Object.prototype.hasOwnProperty.call(body, 'ownerUserId') ||
      Object.prototype.hasOwnProperty.call(body, 'assignedTo')
        ? await resolveOrganizationUserId(db, session, ownerInput)
        : undefined;

    const transition = buildTaskTransition({
      task: existingTask,
      action: body.action || 'update',
      payload: {
        ...taskBodyPayload(body),
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      },
    });

    const { task } = await updateTaskWithEvents({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      existingTask,
      taskPatch: compactTaskPatch(transition.patch),
      eventType: transition.eventType,
      eventMessage: transition.message,
    });

    return NextResponse.json({ task: toTaskPayload(task) });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
