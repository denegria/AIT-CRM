import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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
import {
  TASK_CANCELLATION_DECISIONS,
  TASK_CANCELLATION_REASON_CODES,
  taskCancellationDecision,
} from './cancellation-policy.js';

export const TASK_REMOVAL_APPROVAL_SOURCE_TYPE = 'task_removal_approval';
export const TASK_REMOVAL_APPROVAL_NOTIFICATION_TYPE = 'task_removal_approval_requested';
export const TASK_REMOVAL_APPROVAL_DECISION_NOTIFICATION_TYPE = 'task_removal_approval_decided';
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

export function taskRemovalApprovalIdempotencyKey(taskId) {
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

export function assertTaskCancellationReason(reason) {
  const normalizedReason = cleanText(reason);
  if (!normalizedReason) {
    throw createCrmError('Cancellation reason is required.', 400);
  }
  return normalizedReason;
}

function taskCancellationPolicyError(policy = {}) {
  if (policy.reasonCode === TASK_CANCELLATION_REASON_CODES.CLOSED_TASK) {
    return createCrmError('Only open, in-progress, or snoozed tasks can be canceled.', 409);
  }
  if (policy.reasonCode === TASK_CANCELLATION_REASON_CODES.APPROVAL_TASK) {
    return createCrmError('Approval tasks must be decided through their approve or deny action.', 409);
  }
  if (policy.reasonCode === TASK_CANCELLATION_REASON_CODES.PENDING_APPROVAL) {
    return createCrmError('This task already has a pending cancellation approval.', 409);
  }
  return createCrmError('Your role cannot cancel this task.', 403);
}

export async function cancelTaskDirectly({
  db,
  organizationId,
  session,
  existingTask,
  reason,
  now = new Date(),
}) {
  const policy = taskCancellationDecision({ session, task: existingTask });
  if (policy.decision !== TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL) {
    throw taskCancellationPolicyError(policy);
  }
  const cancellationReason = assertTaskCancellationReason(reason);
  const cancellationMetadata = {
    decision: TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL,
    reasonCode: policy.reasonCode,
    reason: cancellationReason,
    actorUserId: session.user.id,
    canceledAt: now.toISOString(),
  };

  return db.transaction(async (tx) => {
    const updateConditions = [
      eq(tasks.id, existingTask.id),
      eq(tasks.organizationId, organizationId),
      eq(tasks.status, existingTask.status),
      sql`coalesce(${tasks.metadataJson}->'removalApproval'->>'decision', '') <> 'pending'`,
    ];
    if (existingTask.updatedAt) updateConditions.push(eq(tasks.updatedAt, existingTask.updatedAt));
    const [task] = await tx
      .update(tasks)
      .set({
        status: TASK_STATUSES.CANCELED,
        canceledAt: now,
        completedAt: null,
        snoozedUntil: null,
        updatedAt: now,
        metadataJson: {
          ...(existingTask.metadataJson || {}),
          cancellation: cancellationMetadata,
        },
      })
      .where(and(...updateConditions))
      .returning();

    if (!task) {
      throw createCrmError('Task was already updated. Refresh the queue and try again.', 409);
    }

    await tx.insert(taskEvents).values({
      taskId: task.id,
      organizationId,
      businessUnitId: task.businessUnitId,
      eventType: TASK_EVENT_TYPES.CANCELED,
      fromStatus: existingTask.status,
      toStatus: task.status,
      fromOwnerUserId: existingTask.ownerUserId || null,
      toOwnerUserId: task.ownerUserId || null,
      fromDueAt: existingTask.dueAt || null,
      toDueAt: task.dueAt || null,
      actorUserId: session.user.id,
      message: `Canceled task: ${cancellationReason}`,
      metadataJson: cancellationMetadata,
      occurredAt: now,
    });

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: task.businessUnitId,
      contactId: task.contactId || null,
      leadId: task.leadId || null,
      workOrderId: task.workOrderId || null,
      eventType: 'task.canceled',
      message: `Canceled task: ${cancellationReason}`,
      metadataJson: {
        ...cancellationMetadata,
        taskId: task.id,
        taskTitle: cleanText(task.title) || null,
      },
      actorUserId: session.user.id,
      occurredAt: now,
    });

    return { task, cancellationDecision: policy };
  });
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

function toTimestamp(value) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function chooseTaskRemovalReviewer(candidates = []) {
  return [...candidates].sort((left, right) => {
    const loadDifference = Number(left.openApprovalCount || 0) - Number(right.openApprovalCount || 0);
    if (loadDifference) return loadDifference;
    if (Boolean(left.isPrimary) !== Boolean(right.isPrimary)) return left.isPrimary ? -1 : 1;
    const assignedDifference = toTimestamp(left.lastAssignedAt) - toTimestamp(right.lastAssignedAt);
    if (assignedDifference) return assignedDifference;
    return String(left.id || '').localeCompare(String(right.id || ''));
  })[0] || null;
}

async function attachTaskRemovalReviewerLoad(db, organizationId, candidates = []) {
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.id).filter(Boolean))];
  if (!candidateIds.length) return [];
  const assignments = await db
    .select({ ownerUserId: tasks.ownerUserId, createdAt: tasks.createdAt, status: tasks.status })
    .from(tasks)
    .where(and(
      eq(tasks.organizationId, organizationId),
      inArray(tasks.ownerUserId, candidateIds),
      eq(tasks.taskType, TASK_TYPES.TASK_REMOVAL_APPROVAL),
    ));
  const loadByUserId = new Map(candidateIds.map((id) => [id, { count: 0, lastAssignedAt: null }]));
  for (const assignment of assignments) {
    const load = loadByUserId.get(assignment.ownerUserId);
    if (!load) continue;
    if (TASK_REMOVAL_APPROVAL_OPEN_STATUSES.includes(assignment.status)) load.count += 1;
    if (!load.lastAssignedAt || toTimestamp(assignment.createdAt) > toTimestamp(load.lastAssignedAt)) {
      load.lastAssignedAt = assignment.createdAt;
    }
  }
  return candidates.map((candidate) => ({
    ...candidate,
    openApprovalCount: loadByUserId.get(candidate.id)?.count || 0,
    lastAssignedAt: loadByUserId.get(candidate.id)?.lastAssignedAt || null,
  }));
}

async function findSeniorTaskRemovalReviewers(db, { organizationId, businessUnitId, excludeUserId }) {
  if (!businessUnitId) return [];
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isPrimary: businessUnitMemberships.isPrimary,
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
    .orderBy(desc(businessUnitMemberships.isPrimary), users.id);
  const byId = new Map();
  for (const row of rows) {
    if (!row.id || row.id === excludeUserId) continue;
    const current = byId.get(row.id);
    if (!current || row.isPrimary) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function findAdminTaskRemovalReviewers(db, { organizationId, excludeUserId }) {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      eq(users.organizationId, organizationId),
      eq(users.isActive, true),
      eq(roles.organizationId, organizationId),
      eq(roles.key, ROLE_KEYS.ADMIN),
    ))
    .orderBy(users.id);
  return rows
    .filter((row) => row.id && row.id !== excludeUserId)
    .map((row) => ({ ...row, isPrimary: false }));
}

export async function findTaskRemovalReviewer(db, { organizationId, businessUnitId, excludeUserId }) {
  const seniors = await findSeniorTaskRemovalReviewers(db, {
    organizationId,
    businessUnitId,
    excludeUserId,
  });
  if (seniors.length) {
    const candidates = await attachTaskRemovalReviewerLoad(db, organizationId, seniors);
    const reviewer = chooseTaskRemovalReviewer(candidates);
    return reviewer ? { ...reviewer, tier: 'senior_coordinator' } : null;
  }

  const admins = await findAdminTaskRemovalReviewers(db, { organizationId, excludeUserId });
  if (admins.length) {
    const candidates = await attachTaskRemovalReviewerLoad(db, organizationId, admins);
    const reviewer = chooseTaskRemovalReviewer(candidates);
    return reviewer ? { ...reviewer, tier: 'admin' } : null;
  }
  return null;
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

async function notifyTaskRemovalRequester(tx, {
  organizationId,
  businessUnitId,
  requesterUserId,
  approvalTaskId,
  targetTask,
  decision,
  decisionReason,
}) {
  if (!requesterUserId) return null;
  const decisionLabel = decision === 'approved'
    ? 'approved'
    : decision === 'denied'
      ? 'denied'
      : 'closed because the task changed';
  const [notification] = await tx
    .insert(notifications)
    .values({
      organizationId,
      businessUnitId,
      userId: requesterUserId,
      type: TASK_REMOVAL_APPROVAL_DECISION_NOTIFICATION_TYPE,
      sourceType: TASK_REMOVAL_APPROVAL_SOURCE_TYPE,
      title: `Cancellation request ${decisionLabel} - ${cleanText(targetTask?.title) || 'Task'}`,
      body: cleanText(decisionReason) || `Your task cancellation request was ${decisionLabel}.`,
      href: targetTask?.id ? `/tasks/${targetTask.id}` : '/tasks',
      contactId: targetTask?.contactId || null,
      leadId: targetTask?.leadId || null,
      metadataJson: {
        approvalTaskId,
        targetTaskId: targetTask?.id || null,
        decision,
      },
      idempotencyKey: `task_removal_decision:${approvalTaskId}:${decision}:${requesterUserId}`,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return notification || null;
}

async function selectTaskForUpdate(tx, { organizationId, taskId }) {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .for('update')
    .limit(1);
  return task || null;
}

function pendingRemovalApproval(task, approvalTaskId = '') {
  const state = task?.metadataJson?.removalApproval || {};
  return state.decision === 'pending' && (!approvalTaskId || state.approvalTaskId === approvalTaskId)
    ? state
    : null;
}

export async function createOrReuseTaskRemovalApprovalTask({
  db,
  organizationId,
  session,
  targetTask,
  reason,
  now = new Date(),
}) {
  if (!isRegularCoordinatorSession(session)) {
    throw createCrmError('Task removal approval requests are only required for regular coordinators.', 400);
  }
  if (!targetTask?.id) throw createCrmError('Task is required for removal approval.');
  const cancellationReason = assertTaskCancellationReason(reason);

  return db.transaction(async (tx) => {
    const currentTargetTask = await selectTaskForUpdate(tx, {
      organizationId,
      taskId: targetTask.id,
    });
    if (!currentTargetTask) throw createCrmError('Task not found.', 404);
    if (!isOpenTask(currentTargetTask)) throw createCrmError('Only open tasks can be requested for removal.', 409);
    if ([TASK_TYPES.ARCHIVE_APPROVAL, TASK_TYPES.TASK_REMOVAL_APPROVAL].includes(currentTargetTask.taskType)) {
      throw createCrmError('Approval tasks cannot be requested for removal.', 400);
    }

    let existingTask = await findOpenTaskRemovalApprovalTask(tx, {
      organizationId,
      targetTaskId: currentTargetTask.id,
    });
    if (existingTask) {
      let reviewer = null;
      if (!existingTask.ownerUserId) {
        reviewer = await findTaskRemovalReviewer(tx, {
          organizationId,
          businessUnitId: currentTargetTask.businessUnitId,
          excludeUserId: session.user.id,
        });
        if (reviewer?.id) {
          const [assignedTask] = await tx
            .update(tasks)
            .set({ ownerUserId: reviewer.id, updatedAt: now })
            .where(and(
              eq(tasks.id, existingTask.id),
              eq(tasks.organizationId, organizationId),
              inArray(tasks.status, TASK_REMOVAL_APPROVAL_OPEN_STATUSES),
              sql`${tasks.ownerUserId} is null`,
            ))
            .returning();
          if (assignedTask) existingTask = assignedTask;
        }
      }
      let currentTarget = currentTargetTask;
      if (!pendingRemovalApproval(currentTargetTask, existingTask.id)) {
        const [repairedTarget] = await tx
          .update(tasks)
          .set({
            updatedAt: now,
            metadataJson: {
              ...(currentTargetTask.metadataJson || {}),
              removalApproval: {
                approvalTaskId: existingTask.id,
                decision: 'pending',
                requestedReason: existingTask.metadataJson?.requestedReason || cancellationReason,
                requesterUserId: existingTask.metadataJson?.requesterUserId || session.user.id,
                requestedAt: existingTask.metadataJson?.requestedAt || now.toISOString(),
              },
            },
          })
          .where(and(eq(tasks.id, currentTargetTask.id), eq(tasks.organizationId, organizationId)))
          .returning();
        currentTarget = repairedTarget || currentTargetTask;
      }
      await notifyTaskRemovalReviewer(tx, {
        organizationId,
        businessUnitId: currentTargetTask.businessUnitId,
        targetTask: currentTargetTask,
        reviewer: reviewer || (existingTask.ownerUserId ? { id: existingTask.ownerUserId } : null),
        requesterUserId: session.user.id,
        approvalTaskId: existingTask.id,
      });
      return { task: existingTask, reused: true, reviewer, targetTask: currentTarget };
    }

    const reviewer = await findTaskRemovalReviewer(tx, {
      organizationId,
      businessUnitId: currentTargetTask.businessUnitId,
      excludeUserId: session.user.id,
    });
    const metadataJson = {
      ...taskRemovalTaskMetadata({ targetTask: currentTargetTask, session, reason: cancellationReason, now }),
      reviewerTier: reviewer?.tier || 'shared_queue',
    };
    const [approvalTask] = await tx
      .insert(tasks)
      .values({
        organizationId,
        businessUnitId: currentTargetTask.businessUnitId,
        contactId: currentTargetTask.contactId || null,
        leadId: currentTargetTask.leadId || null,
        workOrderId: currentTargetTask.workOrderId || null,
        title: taskRemovalTaskTitle(currentTargetTask),
        description: taskRemovalTaskDescription({ targetTask: currentTargetTask, reason: cancellationReason, session }),
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
      taskId: currentTargetTask.id,
      organizationId,
      businessUnitId: currentTargetTask.businessUnitId,
      eventType: TASK_EVENT_TYPES.UPDATED,
      fromStatus: currentTargetTask.status,
      toStatus: currentTargetTask.status,
      fromOwnerUserId: currentTargetTask.ownerUserId || null,
      toOwnerUserId: currentTargetTask.ownerUserId || null,
      fromDueAt: currentTargetTask.dueAt || null,
      toDueAt: currentTargetTask.dueAt || null,
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
          ...(currentTargetTask.metadataJson || {}),
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
        eq(tasks.id, currentTargetTask.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, currentTargetTask.status),
      ))
      .returning();

    if (!updatedTargetTask) {
      throw createCrmError('Task was already updated. Refresh the queue and try again.', 409);
    }

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: currentTargetTask.businessUnitId,
      contactId: currentTargetTask.contactId || null,
      leadId: currentTargetTask.leadId || null,
      workOrderId: currentTargetTask.workOrderId || null,
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
      businessUnitId: currentTargetTask.businessUnitId,
      targetTask: currentTargetTask,
      reviewer,
      requesterUserId: session.user.id,
      approvalTaskId: approvalTask.id,
    });

    return { task: approvalTask, reused: false, reviewer, targetTask: updatedTargetTask };
  });
}

async function supersedeLockedTaskRemovalApproval(tx, {
  organizationId,
  approvalTask,
  targetTask,
  actorUserId,
  reason,
  now,
}) {
  const decisionReason = cleanText(reason) || `Target task moved to ${targetTask.status}.`;
  const [closedApproval] = await tx
    .update(tasks)
    .set({
      status: TASK_STATUSES.CANCELED,
      completedAt: null,
      canceledAt: now,
      updatedAt: now,
      metadataJson: {
        ...(approvalTask.metadataJson || {}),
        decision: 'superseded',
        decisionReason,
        supersededByStatus: targetTask.status,
        supersededAt: now.toISOString(),
      },
    })
    .where(and(
      eq(tasks.id, approvalTask.id),
      eq(tasks.organizationId, organizationId),
      inArray(tasks.status, TASK_REMOVAL_APPROVAL_OPEN_STATUSES),
    ))
    .returning();
  if (!closedApproval) return { approvalTask: null, targetTask };

  const [updatedTarget] = await tx
    .update(tasks)
    .set({
      updatedAt: now,
      metadataJson: {
        ...(targetTask.metadataJson || {}),
        removalApproval: {
          ...(targetTask.metadataJson?.removalApproval || {}),
          approvalTaskId: closedApproval.id,
          decision: 'superseded',
          decisionReason,
          supersededByStatus: targetTask.status,
          decidedAt: now.toISOString(),
        },
      },
    })
    .where(and(eq(tasks.id, targetTask.id), eq(tasks.organizationId, organizationId)))
    .returning();
  const finalTarget = updatedTarget || targetTask;

  await tx.insert(taskEvents).values([
    {
      taskId: closedApproval.id,
      organizationId,
      businessUnitId: closedApproval.businessUnitId,
      eventType: TASK_EVENT_TYPES.CANCELED,
      fromStatus: approvalTask.status,
      toStatus: closedApproval.status,
      fromOwnerUserId: approvalTask.ownerUserId || null,
      toOwnerUserId: closedApproval.ownerUserId || null,
      fromDueAt: approvalTask.dueAt || null,
      toDueAt: closedApproval.dueAt || null,
      actorUserId,
      message: 'Cancellation request superseded by target task completion or closure.',
      metadataJson: { decision: 'superseded', targetTaskId: targetTask.id, reason: decisionReason },
      occurredAt: now,
    },
    {
      taskId: finalTarget.id,
      organizationId,
      businessUnitId: finalTarget.businessUnitId,
      eventType: TASK_EVENT_TYPES.UPDATED,
      fromStatus: finalTarget.status,
      toStatus: finalTarget.status,
      fromOwnerUserId: finalTarget.ownerUserId || null,
      toOwnerUserId: finalTarget.ownerUserId || null,
      fromDueAt: finalTarget.dueAt || null,
      toDueAt: finalTarget.dueAt || null,
      actorUserId,
      message: 'Closed pending cancellation request because the task changed state.',
      metadataJson: { approvalTaskId: closedApproval.id, decision: 'superseded', reason: decisionReason },
      occurredAt: now,
    },
  ]);

  await tx.insert(activityEvents).values({
    organizationId,
    businessUnitId: finalTarget.businessUnitId,
    contactId: finalTarget.contactId || null,
    leadId: finalTarget.leadId || null,
    workOrderId: finalTarget.workOrderId || null,
    eventType: 'task.removal_approval_superseded',
    message: `Closed cancellation request because the task changed state: ${decisionReason}`,
    metadataJson: {
      approvalTaskId: closedApproval.id,
      targetTaskId: finalTarget.id,
      requesterUserId: closedApproval.metadataJson?.requesterUserId || null,
      supersededByStatus: finalTarget.status,
    },
    actorUserId,
    occurredAt: now,
  });

  await notifyTaskRemovalRequester(tx, {
    organizationId,
    businessUnitId: finalTarget.businessUnitId,
    requesterUserId: closedApproval.metadataJson?.requesterUserId || null,
    approvalTaskId: closedApproval.id,
    targetTask: finalTarget,
    decision: 'superseded',
    decisionReason,
  });
  return { approvalTask: closedApproval, targetTask: finalTarget };
}

export async function supersedeOpenTaskRemovalApprovalInTransaction(tx, {
  organizationId,
  actorUserId,
  previousTask,
  task,
  reason,
  now = new Date(),
}) {
  if (!previousTask || !task || isOpenTask(task)) return { approvalTask: null, targetTask: task };
  const pending = pendingRemovalApproval(previousTask);
  if (!pending?.approvalTaskId) return { approvalTask: null, targetTask: task };
  const approvalTask = await selectTaskForUpdate(tx, {
    organizationId,
    taskId: pending.approvalTaskId,
  });
  if (!approvalTask || !isOpenTask(approvalTask)) return { approvalTask: null, targetTask: task };
  return supersedeLockedTaskRemovalApproval(tx, {
    organizationId,
    approvalTask,
    targetTask: task,
    actorUserId,
    reason,
    now,
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
    const targetBeforeDecision = await selectTaskForUpdate(tx, { organizationId, taskId: targetTaskId });
    if (!targetBeforeDecision) throw createCrmError('Target task no longer exists.', 404);
    const currentApproval = await selectTaskForUpdate(tx, { organizationId, taskId: existingTask.id });
    if (!currentApproval || !isOpenTask(currentApproval)) {
      throw createCrmError('Task removal approval was already updated. Refresh the queue and try again.', 409);
    }
    if (currentApproval.taskType !== TASK_TYPES.TASK_REMOVAL_APPROVAL) {
      throw createCrmError('Task is not a removal approval request.', 400);
    }
    if (!isOpenTask(targetBeforeDecision)) {
      return supersedeLockedTaskRemovalApproval(tx, {
        organizationId,
        approvalTask: currentApproval,
        targetTask: targetBeforeDecision,
        actorUserId: session.user.id,
        reason: `Target task already moved to ${targetBeforeDecision.status}.`,
        now,
      }).then((result) => ({
        task: result.approvalTask || currentApproval,
        targetTask: result.targetTask,
        decision: 'superseded',
      }));
    }
    if (!pendingRemovalApproval(targetBeforeDecision, currentApproval.id)) {
      throw createCrmError('Cancellation request no longer matches the target task.', 409);
    }

    let targetTask = targetBeforeDecision;
    if (normalizedDecision === 'approve') {
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
              approvalTaskId: currentApproval.id,
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
          sql`${tasks.metadataJson}->'removalApproval'->>'approvalTaskId' = ${currentApproval.id}`,
        ))
        .returning();
      if (!canceledTask) {
        throw createCrmError('Target task is already closed or no longer exists.', 409);
      }
      targetTask = canceledTask;

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
          approvalTaskId: currentApproval.id,
          reason: decisionReason,
          requesterUserId: metadata.requesterUserId || null,
        },
        occurredAt: now,
      });
    } else {
      const [deniedTarget] = await tx
        .update(tasks)
        .set({
          updatedAt: now,
          metadataJson: {
            ...(targetBeforeDecision.metadataJson || {}),
            removalApproval: {
              ...(targetBeforeDecision.metadataJson?.removalApproval || {}),
              approvalTaskId: currentApproval.id,
              decision: 'denied',
              decisionReason,
              reviewerUserId: session.user.id,
              decidedAt: now.toISOString(),
            },
          },
        })
        .where(and(
          eq(tasks.id, targetTaskId),
          eq(tasks.organizationId, organizationId),
          eq(tasks.status, targetBeforeDecision.status),
          sql`${tasks.metadataJson}->'removalApproval'->>'approvalTaskId' = ${currentApproval.id}`,
        ))
        .returning();
      if (!deniedTarget) throw createCrmError('Target task was already updated. Refresh and try again.', 409);
      targetTask = deniedTarget;
      await tx.insert(taskEvents).values({
        taskId: targetTask.id,
        organizationId,
        businessUnitId: targetTask.businessUnitId,
        eventType: TASK_EVENT_TYPES.UPDATED,
        fromStatus: targetBeforeDecision.status,
        toStatus: targetTask.status,
        fromOwnerUserId: targetBeforeDecision.ownerUserId || null,
        toOwnerUserId: targetTask.ownerUserId || null,
        fromDueAt: targetBeforeDecision.dueAt || null,
        toDueAt: targetTask.dueAt || null,
        actorUserId: session.user.id,
        message: 'Denied task cancellation request; task remains active.',
        metadataJson: { approvalTaskId: currentApproval.id, reason: decisionReason },
        occurredAt: now,
      });
    }

    const [approvalTask] = await tx
      .update(tasks)
      .set({
        status: normalizedDecision === 'approve' ? TASK_STATUSES.COMPLETED : TASK_STATUSES.CANCELED,
        completedAt: normalizedDecision === 'approve' ? now : null,
        canceledAt: normalizedDecision === 'deny' ? now : null,
        updatedAt: now,
        metadataJson: {
          ...(currentApproval.metadataJson || {}),
          decision: normalizedDecision === 'approve' ? 'approved' : 'denied',
          decisionReason,
          reviewerUserId: session.user.id,
          reviewerName: cleanText(session.user.name) || null,
          reviewerEmail: cleanText(session.user.email) || null,
          decidedAt: now.toISOString(),
        },
      })
      .where(and(
        eq(tasks.id, currentApproval.id),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, currentApproval.status),
      ))
      .returning();
    if (!approvalTask) throw createCrmError('Task removal approval was already updated.', 409);

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

    await notifyTaskRemovalRequester(tx, {
      organizationId,
      businessUnitId: targetTask.businessUnitId,
      requesterUserId: currentApproval.metadataJson?.requesterUserId || null,
      approvalTaskId: approvalTask.id,
      targetTask,
      decision: normalizedDecision === 'approve' ? 'approved' : 'denied',
      decisionReason,
    });

    return { task: approvalTask, targetTask, decision: normalizedDecision };
  });
}
