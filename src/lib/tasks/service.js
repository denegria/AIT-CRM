import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  activityEvents,
  contacts,
  leadStatusHistory,
  leads,
  notes,
  taskEvents,
  tasks,
} from '../../db/schema.js';
import { TASK_EVENT_TYPES, TASK_SOURCE_TYPES, TASK_STATUSES, TASK_TYPES } from './constants.js';
import { taskCancellationDecision } from './cancellation-policy.js';
import { createCrmError } from '../crm/errors.js';
import { INBOUND_LEAD_SOURCE_TYPES } from '../crm/lead-provenance.js';
import {
  AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL,
  planAutomatedInboundFollowUpReconciliation,
} from './integrity-policy.js';
import {
  createFollowUpSelectionError,
  FOLLOW_UP_SELECTION_ERROR_CODES,
} from './follow-up-selection.js';
import { supersedeOpenTaskRemovalApprovalInTransaction } from './removal-approvals.js';

export { AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL, isEligibleAutomatedInboundFollowUpTask } from './integrity-policy.js';

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function currentInboundLeadProvenanceCondition() {
  const sourceTypes = sql.join(INBOUND_LEAD_SOURCE_TYPES.map((sourceType) => sql`${sourceType}`), sql`, `);
  return sql`exists (
    select 1 from ${leads}
    where ${leads.id} = ${tasks.leadId}
      and ${leads.organizationId} = ${tasks.organizationId}
      and ${leads.businessUnitId} = ${tasks.businessUnitId}
      and ${leads.contactId} = ${tasks.contactId}
      and lower(${leads.sourceType}) in (${sourceTypes})
  )`;
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

/**
 * Synchronizes only open automated inbound intake tasks. Callers decide whether
 * owner synchronization or lifecycle cancellation is permitted; this service
 * performs the scoped, auditable, idempotent task writes in their transaction.
 */
export async function reconcileAutomatedInboundFollowUpTasks(tx, {
  organizationId,
  businessUnitId,
  contactId,
  leadId = null,
  actorUserId = null,
  ownerUserId,
  action,
  source,
  reason,
  lifecycleStatus = null,
  excludeTaskId = null,
} = {}) {
  if (!organizationId || !businessUnitId || !contactId || !['sync_owner', 'cancel'].includes(action)) {
    return { changedTasks: [], reason: 'invalid_reconciliation_scope' };
  }
  if (action === 'sync_owner' && ownerUserId === undefined) {
    return { changedTasks: [], reason: 'missing_owner' };
  }

  const selectConditions = [
    eq(tasks.organizationId, organizationId),
    eq(tasks.businessUnitId, businessUnitId),
    eq(tasks.contactId, contactId),
    eq(tasks.taskType, TASK_TYPES.FOLLOW_UP),
    eq(tasks.sourceType, TASK_SOURCE_TYPES.AUTOMATION),
    eq(tasks.sourceLabel, AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL),
    inArray(tasks.status, [TASK_STATUSES.OPEN, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SNOOZED]),
  ];
  if (leadId) selectConditions.push(eq(tasks.leadId, leadId));
  if (excludeTaskId) selectConditions.push(sql`${tasks.id} <> ${excludeTaskId}`);

  const eligibleTaskRows = await tx
    .select({ task: tasks, leadSourceType: leads.sourceType })
    .from(tasks)
    .innerJoin(leads, and(
      eq(leads.id, tasks.leadId),
      eq(leads.organizationId, tasks.organizationId),
      eq(leads.businessUnitId, tasks.businessUnitId),
      eq(leads.contactId, tasks.contactId),
    ))
    .where(and(...selectConditions));
  const eligibleTasks = eligibleTaskRows.map((row) => row.task
    ? { ...row.task, leadSourceType: row.leadSourceType }
    : row);

  const plannedTasks = planAutomatedInboundFollowUpReconciliation(eligibleTasks, {
    organizationId,
    businessUnitId,
    contactId,
    action,
    ownerUserId,
  });
  const candidates = plannedTasks.map(({ task }) => task);
  const changedTasks = [];
  const now = new Date();
  for (const existingTask of candidates) {
    const patch = action === 'sync_owner'
      ? { ownerUserId, updatedAt: now }
      : {
          status: TASK_STATUSES.CANCELED,
          canceledAt: now,
          completedAt: null,
          snoozedUntil: null,
          updatedAt: now,
        };
    const updateConditions = [
      eq(tasks.id, existingTask.id),
      eq(tasks.organizationId, organizationId),
      eq(tasks.businessUnitId, businessUnitId),
      eq(tasks.contactId, contactId),
      currentInboundLeadProvenanceCondition(),
      eq(tasks.taskType, TASK_TYPES.FOLLOW_UP),
      eq(tasks.sourceType, TASK_SOURCE_TYPES.AUTOMATION),
      eq(tasks.sourceLabel, AUTOMATED_INBOUND_FOLLOW_UP_SOURCE_LABEL),
      inArray(tasks.status, [TASK_STATUSES.OPEN, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SNOOZED]),
    ];
    if (leadId) updateConditions.push(eq(tasks.leadId, leadId));
    if (excludeTaskId) updateConditions.push(sql`${tasks.id} <> ${excludeTaskId}`);
    if (action === 'sync_owner') {
      updateConditions.push(ownerUserId === null
        ? isNotNull(tasks.ownerUserId)
        : or(isNull(tasks.ownerUserId), ne(tasks.ownerUserId, ownerUserId)));
    }
    let [task] = await tx
      .update(tasks)
      .set(patch)
      .where(and(...updateConditions))
      .returning();
    if (!task) continue;

    await tx.insert(taskEvents).values(taskEventValues({
      organizationId,
      actorUserId,
      task,
      previousTask: existingTask,
      eventType: action === 'sync_owner' ? TASK_EVENT_TYPES.ASSIGNED : TASK_EVENT_TYPES.CANCELED,
      message: action === 'sync_owner'
        ? 'Synchronized automated inbound follow-up owner with contact assignment.'
        : 'Canceled automated inbound follow-up because the contact no longer needs prospecting.',
      metadataJson: {
        source: source || 'task_reconciliation',
        reason: reason || (action === 'sync_owner' ? 'contact_owner_changed' : 'no_further_prospecting_lifecycle'),
        contactId,
        leadId,
        lifecycleStatus,
      },
    }));
    if (action === 'cancel') {
      const superseded = await supersedeOpenTaskRemovalApprovalInTransaction(tx, {
        organizationId,
        actorUserId,
        previousTask: existingTask,
        task,
        reason: reason || 'Target task was canceled by a valid workflow.',
        now,
      });
      task = superseded.targetTask || task;
    }
    changedTasks.push(task);
  }

  return { changedTasks, reason: null };
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

export function toTaskPayload(row, { session = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    businessUnitId: row.businessUnitId,
    contactId: row.contactId || '',
    contactName: row.contactName || '',
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
    previousFollowUp: row.previousFollowUp || null,
    cancellationPolicy: session ? taskCancellationDecision({ session, task: row }) : null,
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
  if (filters.taskId) conditions.push(eq(tasks.id, filters.taskId));
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

export async function loadLatestFollowUpOutcomePreviews({
  db,
  organizationId,
  contactIds = [],
  businessUnitIds = null,
}) {
  const visibleContactIds = [...new Set(contactIds.filter(Boolean))];
  if (!visibleContactIds.length) return new Map();
  const conditions = [
    eq(activityEvents.organizationId, organizationId),
    inArray(activityEvents.contactId, visibleContactIds),
    sql`lower(coalesce(${activityEvents.eventType}, '')) ~ '^follow_up\\.[a-z_]+$'`,
  ];
  if (Array.isArray(businessUnitIds)) {
    if (!businessUnitIds.length) return new Map();
    conditions.push(inArray(activityEvents.businessUnitId, businessUnitIds));
  }
  const eventTime = sql`coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt})`;
  const rows = await db
    .selectDistinctOn([activityEvents.contactId], {
      contactId: activityEvents.contactId,
      eventType: activityEvents.eventType,
      message: activityEvents.message,
      metadataJson: activityEvents.metadataJson,
      occurredAt: eventTime,
    })
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(activityEvents.contactId, desc(eventTime), desc(activityEvents.createdAt), desc(activityEvents.id));

  return new Map(rows.map((row) => [row.contactId, {
    outcome: row.metadataJson?.outcome || String(row.eventType || '').replace(/^follow_up\./, ''),
    outcomeLabel: row.metadataJson?.outcomeLabel || '',
    note: row.metadataJson?.note || row.message || '',
    occurredAt: row.occurredAt?.toISOString?.() || row.occurredAt || null,
  }]));
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
    let [task] = await tx
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

    if (![TASK_STATUSES.OPEN, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SNOOZED].includes(task.status)) {
      const superseded = await supersedeOpenTaskRemovalApprovalInTransaction(tx, {
        organizationId,
        actorUserId,
        previousTask: existingTask,
        task,
        reason: `Target task moved to ${task.status}.`,
      });
      task = superseded.targetTask || task;
    }

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
    let [task] = await tx
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

    const superseded = await supersedeOpenTaskRemovalApprovalInTransaction(tx, {
      organizationId,
      actorUserId,
      previousTask: existingTask,
      task,
      reason: 'Target task was completed through its recurring workflow.',
    });
    task = superseded.targetTask || task;

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
  cancelOpenFollowUps = false,
  cancelOpenFollowUpsContext = {},
}) {
  return db.transaction(async (tx) => {
    if ([TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELED].includes(existingTask.status)) {
      throw createFollowUpSelectionError(
        'The selected follow-up task was already completed or canceled. Refresh the task queue before logging another outcome.',
        FOLLOW_UP_SELECTION_ERROR_CODES.STALE,
      );
    }

    let [task] = await tx
      .update(tasks)
      .set(taskPatch)
      .where(and(
        eq(tasks.id, existingTask.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.businessUnitId, existingTask.businessUnitId),
        existingTask.contactId ? eq(tasks.contactId, existingTask.contactId) : isNull(tasks.contactId),
        existingTask.leadId ? eq(tasks.leadId, existingTask.leadId) : isNull(tasks.leadId),
        existingTask.ownerUserId ? eq(tasks.ownerUserId, existingTask.ownerUserId) : isNull(tasks.ownerUserId),
        eq(tasks.taskType, TASK_TYPES.FOLLOW_UP),
        eq(tasks.status, existingTask.status),
      ))
      .returning();

    if (!task) {
      throw createFollowUpSelectionError(
        'The selected follow-up task changed before the outcome was saved. Refresh the task queue and select it again.',
        FOLLOW_UP_SELECTION_ERROR_CODES.STALE,
      );
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

    const superseded = await supersedeOpenTaskRemovalApprovalInTransaction(tx, {
      organizationId,
      actorUserId,
      previousTask: existingTask,
      task,
      reason: 'Target task was completed through the follow-up outcome workflow.',
    });
    task = superseded.targetTask || task;

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

    if (cancelOpenFollowUps) {
      await reconcileAutomatedInboundFollowUpTasks(tx, {
        organizationId,
        actorUserId,
        businessUnitId: task.businessUnitId,
        contactId: task.contactId,
        leadId: task.leadId,
        excludeTaskId: task.id,
        action: 'cancel',
        source: 'lifecycle_reconciliation',
        reason: 'no_further_prospecting_lifecycle',
        ...cancelOpenFollowUpsContext,
      });
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

export async function recordFollowUpActivity({
  db,
  organizationId,
  actorUserId,
  context,
  followUpActivity,
  contactPatch = null,
  leadPatch = null,
  leadStatusChange = null,
  profileActivity = null,
  nextTaskValues = null,
  nextTaskEventMetadata = {},
  cancelOpenFollowUps = false,
  cancelOpenFollowUpsContext = {},
}) {
  return db.transaction(async (tx) => {
    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: context.businessUnitId,
      contactId: context.contactId || null,
      leadId: context.leadId || null,
      workOrderId: context.workOrderId || null,
      eventType: followUpActivity.eventType,
      message: followUpActivity.message,
      metadataJson: followUpActivity.metadataJson || {},
      actorUserId,
      occurredAt: followUpActivity.occurredAt || new Date(),
    });

    await tx.insert(notes).values({
      organizationId,
      businessUnitId: context.businessUnitId,
      contactId: context.contactId || null,
      leadId: context.leadId || null,
      workOrderId: context.workOrderId || null,
      body: followUpActivity.noteBody || followUpActivity.message,
      authorUserId: actorUserId,
    });

    if (contactPatch && context.contactId) {
      await tx
        .update(contacts)
        .set(contactPatch)
        .where(and(eq(contacts.id, context.contactId), eq(contacts.organizationId, organizationId)));
    }

    let lead = null;
    if (leadPatch && context.leadId) {
      [lead] = await tx
        .update(leads)
        .set(leadPatch)
        .where(and(eq(leads.id, context.leadId), eq(leads.organizationId, organizationId)))
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
          workOrderId: context.workOrderId || null,
          eventType: profileActivity.eventType || 'lead_profile.updated',
          message: profileActivity.message || 'Updated lead profile.',
          metadataJson: profileActivity.metadataJson || {},
          actorUserId,
          occurredAt: profileActivity.occurredAt || new Date(),
        });
      }
    }

    if (cancelOpenFollowUps) {
      await reconcileAutomatedInboundFollowUpTasks(tx, {
        organizationId,
        actorUserId,
        businessUnitId: context.businessUnitId,
        contactId: context.contactId || null,
        leadId: context.leadId || null,
        action: 'cancel',
        source: 'lifecycle_reconciliation',
        reason: 'no_further_prospecting_lifecycle',
        ...cancelOpenFollowUpsContext,
      });
    }

    let nextTask = null;
    if (nextTaskValues) {
      [nextTask] = await tx
        .insert(tasks)
        .values({
          organizationId,
          businessUnitId: context.businessUnitId,
          contactId: context.contactId || null,
          leadId: context.leadId || null,
          workOrderId: context.workOrderId || null,
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

    return { lead, nextTask };
  });
}

export function compactTaskPatch(patch) {
  return compactObject(patch);
}
