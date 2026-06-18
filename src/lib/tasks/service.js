import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import {
  activityEvents,
  contacts,
  leadStatusHistory,
  leads,
  notes,
  taskEvents,
  tasks,
} from '@/db/schema.js';
import { TASK_EVENT_TYPES, TASK_STATUSES } from './constants.js';
import { createCrmError } from '@/lib/crm/errors.js';

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function activityMessageFor(eventType, task) {
  const title = task.title || 'Task';
  if (eventType === TASK_EVENT_TYPES.CREATED) return `Created task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.UPDATED) return `Updated task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.ASSIGNED) return `Assigned task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.COMPLETED) return `Completed task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.SNOOZED) return `Snoozed task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.CANCELED) return `Canceled task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.STARTED) return `Updated task ${title}.`;
  if (eventType === TASK_EVENT_TYPES.DUE_DATE_CHANGED) return `Updated due date for task ${title}.`;
  return `Updated task ${title}.`;
}

function taskEventValues({
  organizationId,
  actorUserId,
  task,
  previousTask = null,
  eventType,
  message,
  metadataJson = {},
}) {
  return {
    taskId: task.id,
    organizationId,
    businessUnitId: task.businessUnitId,
    eventType,
    fromStatus: previousTask?.status || null,
    toStatus: task.status || null,
    fromOwnerUserId: previousTask?.ownerUserId || null,
    toOwnerUserId: task.ownerUserId || null,
    fromDueAt: previousTask?.dueAt || null,
    toDueAt: task.dueAt || null,
    actorUserId,
    message,
    metadataJson,
    occurredAt: new Date(),
  };
}

function activityEventValues({
  organizationId,
  actorUserId,
  task,
  eventType,
  message,
  metadataJson = {},
}) {
  return {
    organizationId,
    businessUnitId: task.businessUnitId,
    contactId: task.contactId || null,
    leadId: task.leadId || null,
    workOrderId: task.workOrderId || null,
    eventType: `task.${eventType}`,
    message: message || activityMessageFor(eventType, task),
    metadataJson,
    actorUserId,
    occurredAt: new Date(),
  };
}

function followUpActivityEventValues({
  organizationId,
  actorUserId,
  task,
  eventType,
  message,
  metadataJson = {},
  occurredAt,
}) {
  return {
    organizationId,
    businessUnitId: task.businessUnitId,
    contactId: task.contactId || null,
    leadId: task.leadId || null,
    workOrderId: task.workOrderId || null,
    eventType,
    message,
    metadataJson,
    actorUserId,
    occurredAt,
  };
}

export function toTaskPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    businessUnitId: row.businessUnitId,
    contactId: row.contactId || '',
    leadId: row.leadId || '',
    workOrderId: row.workOrderId || '',
    taskType: row.taskType,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString?.() || row.dueAt || null,
    snoozedUntil: row.snoozedUntil?.toISOString?.() || row.snoozedUntil || null,
    completedAt: row.completedAt?.toISOString?.() || row.completedAt || null,
    canceledAt: row.canceledAt?.toISOString?.() || row.canceledAt || null,
    ownerUserId: row.ownerUserId || '',
    createdByUserId: row.createdByUserId || '',
    sourceType: row.sourceType || '',
    sourceId: row.sourceId || '',
    sourceLabel: row.sourceLabel || '',
    metadataJson: row.metadataJson || {},
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || null,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || null,
  };
}

export async function listTasks({
  db,
  organizationId,
  businessUnitIds = null,
  filters = {},
}) {
  const conditions = [eq(tasks.organizationId, organizationId)];
  if (Array.isArray(businessUnitIds)) {
    if (!businessUnitIds.length) return [];
    conditions.push(inArray(tasks.businessUnitId, businessUnitIds));
  }
  if (filters.businessUnitId) conditions.push(eq(tasks.businessUnitId, filters.businessUnitId));
  if (filters.contactId) conditions.push(eq(tasks.contactId, filters.contactId));
  if (filters.leadId) conditions.push(eq(tasks.leadId, filters.leadId));
  if (filters.workOrderId) conditions.push(eq(tasks.workOrderId, filters.workOrderId));
  if (filters.ownerUserId) conditions.push(eq(tasks.ownerUserId, filters.ownerUserId));
  if (filters.unassigned) conditions.push(isNull(tasks.ownerUserId));
  if (filters.status) conditions.push(eq(tasks.status, filters.status));
  if (filters.taskType) conditions.push(eq(tasks.taskType, filters.taskType));
  if (filters.dueBefore) conditions.push(lte(tasks.dueAt, filters.dueBefore));

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
}

export async function createTaskWithEvents({
  db,
  organizationId,
  actorUserId,
  taskValues,
  eventMessage = 'Created task.',
  metadataJson = {},
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        organizationId,
        createdByUserId: actorUserId,
        ...taskValues,
      })
      .returning();

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task,
      eventType: TASK_EVENT_TYPES.CREATED,
      message: eventMessage,
      metadataJson,
    }));

    await tx.insert(activityEvents).values(activityEventValues({
      organizationId,
      actorUserId,
      task,
      eventType: TASK_EVENT_TYPES.CREATED,
      message: eventMessage,
      metadataJson,
    }));

    return { task };
  });
}

export async function updateTaskWithEvents({
  db,
  organizationId,
  actorUserId,
  existingTask,
  taskPatch,
  eventType,
  eventMessage,
  metadataJson = {},
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(tasks)
      .set(taskPatch)
      .where(and(eq(tasks.id, existingTask.id), eq(tasks.organizationId, organizationId)))
      .returning();

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task,
      previousTask: existingTask,
      eventType,
      message: eventMessage,
      metadataJson,
    }));

    await tx.insert(activityEvents).values(activityEventValues({
      organizationId,
      actorUserId,
      task,
      eventType,
      message: eventMessage,
      metadataJson,
    }));

    return { task };
  });
}

export async function completeRecurringTaskWithNextTask({
  db,
  organizationId,
  actorUserId,
  existingTask,
  taskPatch,
  nextDueAt,
  nextTaskMetadataJson = {},
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(tasks)
      .set(taskPatch)
      .where(and(
        eq(tasks.id, existingTask.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, existingTask.status),
      ))
      .returning();

    if (!task) {
      throw createCrmError('Task was already updated. Refresh the queue and try again.', 409);
    }

    if ([TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELED].includes(existingTask.status)) {
      throw createCrmError('Completed or canceled tasks must be reopened before further changes.');
    }

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task,
      previousTask: existingTask,
      eventType: TASK_EVENT_TYPES.COMPLETED,
      message: 'Completed recurring task.',
      metadataJson: { nextDueAt: nextDueAt.toISOString() },
    }));

    await tx.insert(activityEvents).values(activityEventValues({
      organizationId,
      actorUserId,
      task,
      eventType: TASK_EVENT_TYPES.COMPLETED,
      message: 'Completed recurring task.',
      metadataJson: { nextDueAt: nextDueAt.toISOString() },
    }));

    const [nextTask] = await tx
      .insert(tasks)
      .values({
        organizationId,
        businessUnitId: existingTask.businessUnitId,
        contactId: existingTask.contactId || null,
        leadId: existingTask.leadId || null,
        workOrderId: existingTask.workOrderId || null,
        title: existingTask.title,
        description: existingTask.description || null,
        taskType: existingTask.taskType,
        status: TASK_STATUSES.OPEN,
        priority: existingTask.priority,
        dueAt: nextDueAt,
        ownerUserId: existingTask.ownerUserId,
        createdByUserId: actorUserId,
        sourceType: 'manual',
        sourceId: existingTask.id,
        sourceLabel: 'Recurring task',
        metadataJson: nextTaskMetadataJson,
      })
      .returning();

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task: nextTask,
      eventType: TASK_EVENT_TYPES.CREATED,
      message: 'Created next recurring task.',
      metadataJson: { createdFromTaskId: existingTask.id },
    }));

    await tx.insert(activityEvents).values(activityEventValues({
      organizationId,
      actorUserId,
      task: nextTask,
      eventType: TASK_EVENT_TYPES.CREATED,
      message: 'Created next recurring task.',
      metadataJson: { createdFromTaskId: existingTask.id },
    }));

    return { task, nextTask };
  });
}

export async function completeFollowUpTaskWithActivity({
  db,
  organizationId,
  actorUserId,
  existingTask,
  taskPatch,
  followUpActivity,
  taskEventMetadata = {},
  contactPatch = null,
  leadPatch = null,
  leadStatusChange = null,
  profileActivity = null,
  nextTaskValues = null,
  nextTaskEventMetadata = {},
}) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(tasks)
      .set(taskPatch)
      .where(and(
        eq(tasks.id, existingTask.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, existingTask.status),
      ))
      .returning();

    if (!task) {
      throw createCrmError('Task was already updated. Refresh the queue and try again.', 409);
    }

    if ([TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELED].includes(existingTask.status)) {
      throw createCrmError('Completed or canceled tasks must be reopened before further changes.');
    }

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task,
      previousTask: existingTask,
      eventType: TASK_EVENT_TYPES.COMPLETED,
      message: 'Completed follow-up task.',
      metadataJson: taskEventMetadata,
    }));

    await tx.insert(activityEvents).values(followUpActivityEventValues({
      organizationId,
      actorUserId,
      task,
      eventType: followUpActivity.eventType,
      message: followUpActivity.message,
      metadataJson: followUpActivity.metadataJson,
      occurredAt: followUpActivity.occurredAt || new Date(),
    }));

    await tx.insert(notes).values({
      organizationId,
      businessUnitId: task.businessUnitId,
      contactId: task.contactId || null,
      leadId: task.leadId || null,
      workOrderId: task.workOrderId || null,
      body: followUpActivity.noteBody || followUpActivity.message,
      authorUserId: actorUserId,
    });

    if (contactPatch && task.contactId) {
      await tx
        .update(contacts)
        .set(contactPatch)
        .where(and(eq(contacts.id, task.contactId), eq(contacts.organizationId, organizationId)));
    }

    let lead = null;
    if (leadPatch && task.leadId) {
      [lead] = await tx
        .update(leads)
        .set(leadPatch)
        .where(and(eq(leads.id, task.leadId), eq(leads.organizationId, organizationId)))
        .returning();

      if (lead && leadStatusChange?.changed) {
        await tx.insert(leadStatusHistory).values({
          organizationId,
          businessUnitId: lead.businessUnitId,
          contactId: lead.contactId,
          leadId: lead.id,
          fromStatus: leadStatusChange.fromStatus,
          toStatus: leadStatusChange.toStatus,
          actorUserId,
          reason: leadStatusChange.reason || null,
          occurredAt: new Date(),
        });
      }

      if (lead && profileActivity) {
        await tx.insert(activityEvents).values({
          organizationId,
          businessUnitId: lead.businessUnitId,
          contactId: lead.contactId,
          leadId: lead.id,
          workOrderId: task.workOrderId || null,
          eventType: profileActivity.eventType || 'lead_profile.updated',
          message: profileActivity.message || 'Updated lead profile.',
          metadataJson: profileActivity.metadataJson || {},
          actorUserId,
          occurredAt: profileActivity.occurredAt || new Date(),
        });
      }
    }

    let nextTask = null;
    if (nextTaskValues) {
      [nextTask] = await tx
        .insert(tasks)
        .values({
          organizationId,
          businessUnitId: task.businessUnitId,
          contactId: task.contactId,
          leadId: task.leadId,
          workOrderId: task.workOrderId,
          ownerUserId: task.ownerUserId,
          priority: task.priority,
          taskType: task.taskType,
          createdByUserId: actorUserId,
          ...nextTaskValues,
        })
        .returning();

      await tx.insert(taskEvents).values(taskEventValues({
        organizationId,
        actorUserId,
        task: nextTask,
        eventType: TASK_EVENT_TYPES.CREATED,
        message: 'Created next follow-up task.',
        metadataJson: nextTaskEventMetadata,
      }));
    }

    return { task, lead, nextTask };
  });
}

export function compactTaskPatch(patch) {
  return compactObject(patch);
}
