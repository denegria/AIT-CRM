import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  activityEvents,
  businessUnitMemberships,
  notifications,
  roles,
  taskEvents,
  tasks,
  userRoles,
  users,
} from '../../db/schema.js';
import {
  ROLE_KEYS,
  isRegularCoordinatorSession,
  userHasRole,
} from '../crm/coordinator-policy.js';
import { createCrmError } from '../crm/errors.js';
import { TASK_EVENT_TYPES, TASK_STATUSES, TASK_TYPES } from './constants.js';

export const TASK_REMOVAL_APPROVAL_SOURCE_TYPE = 'task_removal_approval';
export const TASK_REMOVAL_APPROVAL_NOTIFICATION_TYPE = 'task_removal_approval_requested';
export const TASK_REMOVAL_APPROVAL_OPEN_STATUSES = Object.freeze([
  TASK_STATUSES.OPEN,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SNOOZED,
]);

function cleanText(value) {
  return String(value || '').trim();
}

function requesterLabel(session = {}) {
  return cleanText(session.user?.name) || cleanText(session.user?.email) || 'Coordinator';
}

function taskRemovalApprovalIdempotencyKey(taskId) {
  return `task_removal:${taskId}`;
}

function isOpenTask(task = {}) {
  return TASK_REMOVAL_APPROVAL_OPEN_STATUSES.includes(task.status);
}

function taskRemovalTaskTitle(targetTask = {}) {
  return `Task removal approval - ${cleanText(targetTask.title) || 'task'}`;
}

function taskRemovalTaskDescription({ targetTask, reason, session }) {
  const requester = requesterLabel(session);
  const detail = cleanText(reason) || 'No reason provided.';
  return `${requester} requested approval to cancel "${cleanText(targetTask.title) || 'this task'}".\n\nReason: ${detail}`;
}

function taskRemovalTaskMetadata({ targetTask, session, reason, now }) {
  return {
    approvalType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
    decision: 'pending',
    requesterUserId: session.user.id,
    requesterName: cleanText(session.user.name) || null,
    requesterEmail: cleanText(session.user.email) || null,
    requestedReason: cleanText(reason) || 'Task cancellation requested by coordinator.',
    requestedAt: now.toISOString(),
    targetTaskId: targetTask.id,
    targetTaskTitle: cleanText(targetTask.title) || null,
    targetTaskType: targetTask.taskType || null,
    targetOwnerUserId: targetTask.ownerUserId || null,
    contactId: targetTask.contactId || null,
    leadId: targetTask.leadId || null,
    workOrderId: targetTask.workOrderId || null,
    businessUnitId: targetTask.businessUnitId || null,
    idempotencyKey: taskRemovalApprovalIdempotencyKey(targetTask.id),
  };
}

export function canReviewTaskRemovalApproval(session = {}) {
  return Boolean(
    userHasRole(session.user, ROLE_KEYS.ADMIN) ||
    userHasRole(session.user, ROLE_KEYS.SENIOR_COORDINATOR)
  );
}

export function assertCanReviewTaskRemovalApproval(session = {}) {
  if (!canReviewTaskRemovalApproval(session)) {
    throw createCrmError('Only senior coordinators and admins can review task removal approvals.', 403);
  }
}

export async function findOpenTaskRemovalApprovalTask(db, { organizationId, targetTaskId }) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.organizationId, organizationId),
      eq(tasks.taskType, TASK_TYPES.TASK_REMOVAL_APPROVAL),
      eq(tasks.sourceType, TASK_REMOVAL_APPROVAL_SOURCE_TYPE),
      eq(tasks.sourceId, taskRemovalApprovalIdempotencyKey(targetTaskId)),
      inArray(tasks.status, TASK_REMOVAL_APPROVAL_OPEN_STATUSES),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  return task || null;
}

export async function findSeniorTaskRemovalReviewer(db, { organizationId, businessUnitId, excludeUserId }) {
  if (!businessUnitId) return null;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(businessUnitMemberships, eq(businessUnitMemberships.userId, users.id))
    .where(and(
      eq(users.organizationId, organizationId),
      eq(users.isActive, true),
      eq(roles.organizationId, organizationId),
      eq(roles.key, ROLE_KEYS.SENIOR_COORDINATOR),
      eq(businessUnitMemberships.businessUnitId, businessUnitId),
    ))
    .orderBy(desc(businessUnitMemberships.isPrimary), asc(users.name), asc(users.email))
    .limit(5);

  return rows.find((row) => row.id !== excludeUserId) || null;
}

async function notifyTaskRemovalReviewer(tx, {
  organizationId,
  businessUnitId,
  targetTask,
  reviewer,
  requesterUserId,
  approvalTaskId,
}) {
  if (!reviewer?.id || reviewer.id === requesterUserId) return null;
  const [notification] = await tx
    .insert(notifications)
    .values({
      organizationId,
      businessUnitId,
      userId: reviewer.id,
      type: TASK_REMOVAL_APPROVAL_NOTIFICATION_TYPE,
      sourceType: TASK_REMOVAL_APPROVAL_SOURCE_TYPE,
      title: `Task removal requested - ${cleanText(targetTask.title) || 'Task'}`,
      body: 'Review the task removal request before it is canceled from active work.',
      href: `/tasks/${approvalTaskId}`,
      contactId: targetTask.contactId || null,
      leadId: targetTask.leadId || null,
      metadataJson: {
        taskId: approvalTaskId,
        targetTaskId: targetTask.id,
        requesterUserId,
        targetTaskTitle: cleanText(targetTask.title) || null,
      },
      idempotencyKey: `task_removal_approval:${approvalTaskId}:${reviewer.id}`,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return notification || null;
}

export async function createOrReuseTaskRemovalApprovalTask({
  db,
  organizationId,
  session,
  targetTask,
  reason,
}) {
  if (!isRegularCoordinatorSession(session)) {
    throw createCrmError('Task removal approval requests are only required for regular coordinators.', 400);
  }
  if (!targetTask?.id) throw createCrmError('Task is required for removal approval.');
  if (!isOpenTask(targetTask)) throw createCrmError('Only open tasks can be requested for removal.', 409);
  if ([TASK_TYPES.ARCHIVE_APPROVAL, TASK_TYPES.TASK_REMOVAL_APPROVAL].includes(targetTask.taskType)) {
    throw createCrmError('Approval tasks cannot be requested for removal.', 400);
  }

  const existingTask = await findOpenTaskRemovalApprovalTask(db, { organizationId, targetTaskId: targetTask.id });
  if (existingTask) {
    return { task: existingTask, reused: true, reviewer: null, targetTask };
  }

  const now = new Date();
  const reviewer = await findSeniorTaskRemovalReviewer(db, {
    organizationId,
    businessUnitId: targetTask.businessUnitId,
    excludeUserId: session.user.id,
  });
  const metadataJson = taskRemovalTaskMetadata({ targetTask, session, reason, now });

  return db.transaction(async (tx) => {
    const [approvalTask] = await tx
      .insert(tasks)
      .values({
        organizationId,
        businessUnitId: targetTask.businessUnitId,
        contactId: targetTask.contactId || null,
        leadId: targetTask.leadId || null,
        workOrderId: targetTask.workOrderId || null,
        title: taskRemovalTaskTitle(targetTask),
        description: taskRemovalTaskDescription({ targetTask, reason, session }),
        taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL,
        status: TASK_STATUSES.OPEN,
        priority: 'medium',
        dueAt: now,
        ownerUserId: reviewer?.id || null,
        createdByUserId: session.user.id,
        sourceType: TASK_REMOVAL_APPROVAL_SOURCE_TYPE,
        sourceId: taskRemovalApprovalIdempotencyKey(targetTask.id),
        sourceLabel: 'Task removal approval',
        metadataJson,
      })
      .returning();

    await tx.insert(taskEvents).values({
      taskId: approvalTask.id,
      organizationId,
      businessUnitId: approvalTask.businessUnitId,
      eventType: TASK_EVENT_TYPES.CREATED,
      toStatus: approvalTask.status,
      toOwnerUserId: approvalTask.ownerUserId || null,
      toDueAt: approvalTask.dueAt,
      actorUserId: session.user.id,
      message: 'Requested task removal approval.',
      metadataJson,
      occurredAt: now,
    });

    await tx.insert(taskEvents).values({
      taskId: targetTask.id,
      organizationId,
      businessUnitId: targetTask.businessUnitId,
      eventType: TASK_EVENT_TYPES.UPDATED,
      fromStatus: targetTask.status,
      toStatus: targetTask.status,
      fromOwnerUserId: targetTask.ownerUserId || null,
      toOwnerUserId: targetTask.ownerUserId || null,
      fromDueAt: targetTask.dueAt || null,
      toDueAt: targetTask.dueAt || null,
      actorUserId: session.user.id,
      message: 'Requested task cancellation approval.',
      metadataJson: {
        approvalTaskId: approvalTask.id,
        requestedReason: metadataJson.requestedReason,
      },
      occurredAt: now,
    });

    const [updatedTargetTask] = await tx
      .update(tasks)
      .set({
        updatedAt: now,
        metadataJson: {
          ...(targetTask.metadataJson || {}),
          removalApproval: {
            approvalTaskId: approvalTask.id,
            decision: 'pending',
            requestedReason: metadataJson.requestedReason,
            requesterUserId: session.user.id,
            requestedAt: now.toISOString(),
          },
        },
      })
      .where(and(
        eq(tasks.id, targetTask.id),
        eq(tasks.organizationId, organizationId),
      ))
      .returning();

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: targetTask.businessUnitId,
      contactId: targetTask.contactId || null,
      leadId: targetTask.leadId || null,
      workOrderId: targetTask.workOrderId || null,
      eventType: 'task.removal_approval_requested',
      message: `Requested task cancellation approval: ${metadataJson.requestedReason}`,
      metadataJson: {
        ...metadataJson,
        approvalTaskId: approvalTask.id,
        reviewerUserId: reviewer?.id || null,
      },
      actorUserId: session.user.id,
      occurredAt: now,
    });

    await notifyTaskRemovalReviewer(tx, {
      organizationId,
      businessUnitId: targetTask.businessUnitId,
      targetTask,
      reviewer,
      requesterUserId: session.user.id,
      approvalTaskId: approvalTask.id,
    });

    return { task: approvalTask, reused: false, reviewer, targetTask: updatedTargetTask || targetTask };
  });
}

export async function decideTaskRemovalApprovalTask({
  db,
  organizationId,
  session,
  existingTask,
  decision,
  reason = '',
}) {
  assertCanReviewTaskRemovalApproval(session);
  if (existingTask.taskType !== TASK_TYPES.TASK_REMOVAL_APPROVAL) {
    throw createCrmError('Task is not a removal approval request.', 400);
  }
  if (!TASK_REMOVAL_APPROVAL_OPEN_STATUSES.includes(existingTask.status)) {
    throw createCrmError('Task removal approval request is already closed.', 409);
  }

  const normalizedDecision = cleanText(decision).toLowerCase();
  if (!['approve', 'deny'].includes(normalizedDecision)) {
    throw createCrmError('Task removal approval decision must be approve or deny.');
  }

  const now = new Date();
  const metadata = existingTask.metadataJson || {};
  const targetTaskId = metadata.targetTaskId || cleanText(existingTask.sourceId).replace(/^task_removal:/, '');
  if (!targetTaskId) throw createCrmError('Task removal approval is missing the target task.', 400);
  const decisionReason = cleanText(reason) || (
    normalizedDecision === 'approve'
      ? metadata.requestedReason || 'Task cancellation approved.'
      : 'Task cancellation request denied.'
  );

  return db.transaction(async (tx) => {
    const [approvalTask] = await tx
      .update(tasks)
      .set({
        status: normalizedDecision === 'approve' ? TASK_STATUSES.COMPLETED : TASK_STATUSES.CANCELED,
        completedAt: normalizedDecision === 'approve' ? now : null,
        canceledAt: normalizedDecision === 'deny' ? now : null,
        updatedAt: now,
        metadataJson: {
          ...metadata,
          decision: normalizedDecision === 'approve' ? 'approved' : 'denied',
          decisionReason,
          reviewerUserId: session.user.id,
          reviewerName: cleanText(session.user.name) || null,
          reviewerEmail: cleanText(session.user.email) || null,
          decidedAt: now.toISOString(),
        },
      })
      .where(and(
        eq(tasks.id, existingTask.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, existingTask.status),
      ))
      .returning();

    if (!approvalTask) {
      throw createCrmError('Task removal approval was already updated. Refresh the queue and try again.', 409);
    }

    let targetTask = null;
    if (normalizedDecision === 'approve') {
      const [targetBeforeDecision] = await tx
        .select()
        .from(tasks)
        .where(and(
          eq(tasks.id, targetTaskId),
          eq(tasks.organizationId, organizationId),
        ))
        .limit(1);
      if (!targetBeforeDecision) {
        throw createCrmError('Target task no longer exists.', 404);
      }

      const [canceledTask] = await tx
        .update(tasks)
        .set({
          status: TASK_STATUSES.CANCELED,
          canceledAt: now,
          completedAt: null,
          snoozedUntil: null,
          updatedAt: now,
          metadataJson: {
            ...(targetBeforeDecision.metadataJson || {}),
            removalApproval: {
              approvalTaskId: approvalTask.id,
              decision: 'approved',
              decisionReason,
              reviewerUserId: session.user.id,
              decidedAt: now.toISOString(),
            },
          },
        })
        .where(and(
          eq(tasks.id, targetTaskId),
          eq(tasks.organizationId, organizationId),
          inArray(tasks.status, TASK_REMOVAL_APPROVAL_OPEN_STATUSES),
        ))
        .returning();
      targetTask = canceledTask || null;
      if (!targetTask) {
        throw createCrmError('Target task is already closed or no longer exists.', 409);
      }

      await tx.insert(taskEvents).values({
        taskId: targetTask.id,
        organizationId,
        businessUnitId: targetTask.businessUnitId,
        eventType: TASK_EVENT_TYPES.CANCELED,
        fromStatus: targetBeforeDecision.status || null,
        toStatus: targetTask.status,
        fromOwnerUserId: targetBeforeDecision.ownerUserId || null,
        toOwnerUserId: targetTask.ownerUserId || null,
        fromDueAt: targetBeforeDecision.dueAt || null,
        toDueAt: targetTask.dueAt || null,
        actorUserId: session.user.id,
        message: 'Approved task cancellation request.',
        metadataJson: {
          approvalTaskId: approvalTask.id,
          reason: decisionReason,
          requesterUserId: metadata.requesterUserId || null,
        },
        occurredAt: now,
      });
    }

    await tx.insert(taskEvents).values({
      taskId: approvalTask.id,
      organizationId,
      businessUnitId: approvalTask.businessUnitId,
      eventType: normalizedDecision === 'approve' ? TASK_EVENT_TYPES.COMPLETED : TASK_EVENT_TYPES.CANCELED,
      fromStatus: existingTask.status,
      toStatus: approvalTask.status,
      fromOwnerUserId: existingTask.ownerUserId || null,
      toOwnerUserId: approvalTask.ownerUserId || null,
      fromDueAt: existingTask.dueAt || null,
      toDueAt: approvalTask.dueAt || null,
      actorUserId: session.user.id,
      message: normalizedDecision === 'approve'
        ? 'Approved task removal request.'
        : 'Denied task removal request.',
      metadataJson: {
        decision: normalizedDecision,
        reason: decisionReason,
        requesterUserId: metadata.requesterUserId || null,
        targetTaskId,
      },
      occurredAt: now,
    });

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: approvalTask.businessUnitId,
      contactId: approvalTask.contactId || metadata.contactId || null,
      leadId: approvalTask.leadId || metadata.leadId || null,
      workOrderId: approvalTask.workOrderId || metadata.workOrderId || null,
      eventType: normalizedDecision === 'approve'
        ? 'task.removal_approval_approved'
        : 'task.removal_approval_denied',
      message: normalizedDecision === 'approve'
        ? `Canceled task after approval: ${decisionReason}`
        : `Denied task cancellation request: ${decisionReason}`,
      metadataJson: {
        source: 'task_removal_approval_task',
        approvalTaskId: approvalTask.id,
        targetTaskId,
        targetTaskTitle: metadata.targetTaskTitle || null,
        decision: normalizedDecision,
        reason: decisionReason,
        requesterUserId: metadata.requesterUserId || null,
        reviewerUserId: session.user.id,
      },
      actorUserId: session.user.id,
      occurredAt: now,
    });

    return { task: approvalTask, targetTask, decision: normalizedDecision };
  });
}
