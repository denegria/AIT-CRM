import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  businessUnits,
  contacts,
  leads,
  taskEvents,
  tasks,
  users,
  workOrders,
} from '@/db/schema.js';
import {
  canAccessWorkOrder,
} from '@/lib/crm/access.js';
import { createCrmError } from '@/lib/crm/errors.js';
import { toTaskPayload } from './service.js';
import { canReadTaskDetail } from './detail-policy.js';

function toDateString(value) {
  return value?.toISOString?.() || value || null;
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function notFoundTaskError() {
  return createCrmError('Task not found.', 404);
}

async function selectOneById(db, table, organizationId, id, selection = undefined) {
  if (!id) return null;
  const query = selection ? db.select(selection) : db.select();
  const [row] = await query
    .from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, organizationId)))
    .limit(1);
  return row || null;
}

async function loadTaskEvents(db, organizationId, taskId) {
  const rows = await db
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.organizationId, organizationId), eq(taskEvents.taskId, taskId)))
    .orderBy(desc(taskEvents.occurredAt), desc(taskEvents.createdAt));

  const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter(Boolean))];
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.organizationId, organizationId), inArray(users.id, actorIds)))
    : [];
  const actorsById = new Map(actorRows.map((user) => [user.id, user]));

  return rows.map((row) => {
    const actor = row.actorUserId ? actorsById.get(row.actorUserId) : null;
    return {
      id: row.id,
      eventType: row.eventType,
      message: row.message || '',
      fromStatus: row.fromStatus || '',
      toStatus: row.toStatus || '',
      fromOwnerUserId: row.fromOwnerUserId || '',
      toOwnerUserId: row.toOwnerUserId || '',
      fromDueAt: toDateString(row.fromDueAt),
      toDueAt: toDateString(row.toDueAt),
      actorUserId: row.actorUserId || '',
      actor: actor ? { id: actor.id, name: actor.name, email: actor.email || '' } : null,
      metadataJson: row.metadataJson || {},
      occurredAt: toDateString(row.occurredAt),
      createdAt: toDateString(row.createdAt),
    };
  });
}

export async function loadTaskDetail({ db, organizationId, session, taskId }) {
  const task = await selectOneById(db, tasks, organizationId, taskId);
  if (!task || !canReadTaskDetail(session, task)) {
    throw notFoundTaskError();
  }

  const [businessUnit, owner, creator, contact, lead, workOrder, events] = await Promise.all([
    selectOneById(db, businessUnits, organizationId, task.businessUnitId, {
      id: businessUnits.id,
      name: businessUnits.name,
      label: businessUnits.label,
      color: businessUnits.color,
    }),
    selectOneById(db, users, organizationId, task.ownerUserId, {
      id: users.id,
      name: users.name,
      email: users.email,
    }),
    selectOneById(db, users, organizationId, task.createdByUserId, {
      id: users.id,
      name: users.name,
      email: users.email,
    }),
    selectOneById(db, contacts, organizationId, task.contactId, {
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      sourceLabel: contacts.sourceLabel,
      archivedAt: contacts.archivedAt,
    }),
    selectOneById(db, leads, organizationId, task.leadId, {
      id: leads.id,
      contactId: leads.contactId,
      status: leads.status,
      currentStage: leads.currentStage,
      sourceType: leads.sourceType,
      sourceName: leads.sourceName,
      assignedUserId: leads.assignedUserId,
    }),
    selectOneById(db, workOrders, organizationId, task.workOrderId, {
      id: workOrders.id,
      workOrderNumber: workOrders.workOrderNumber,
      title: workOrders.title,
      status: workOrders.status,
      assignedUserId: workOrders.assignedUserId,
      businessUnitId: workOrders.businessUnitId,
    }),
    loadTaskEvents(db, organizationId, task.id),
  ]);

  const canOpenWorkOrder = workOrder ? canAccessWorkOrder(session, workOrder) : false;

  return {
    task: toTaskPayload(task, { session }),
    context: {
      businessUnit: businessUnit ? compactRecord(businessUnit) : null,
      owner: owner ? compactRecord(owner) : null,
      createdBy: creator ? compactRecord(creator) : null,
      contact: contact ? {
        ...compactRecord(contact),
        archivedAt: toDateString(contact.archivedAt),
      } : null,
      lead: lead ? compactRecord(lead) : null,
      workOrder: workOrder ? {
        ...compactRecord(workOrder),
        canOpen: canOpenWorkOrder,
      } : null,
    },
    events,
  };
}
