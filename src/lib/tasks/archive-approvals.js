import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  activityEvents,
  businessUnitMemberships,
  contacts,
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

export const ARCHIVE_APPROVAL_SOURCE_TYPE = 'archive_approval';
export const ARCHIVE_APPROVAL_NOTIFICATION_TYPE = 'archive_approval_requested';
export const ARCHIVE_APPROVAL_OPEN_STATUSES = Object.freeze([
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

function archiveTaskTitle(contact = {}) {
  return `Archive approval - ${cleanText(contact.name) || 'contact'}`;
}

function archiveTaskDescription({ contact, reason, session }) {
  const requester = requesterLabel(session);
  const detail = cleanText(reason) || 'No reason provided.';
  return `${requester} requested approval to archive ${cleanText(contact.name) || 'this contact'}.\n\nReason: ${detail}`;
}

function archiveTaskMetadata({ contact, lead = null, session, reason, now, existingRequestCount = 0 }) {
  return {
    approvalType: TASK_TYPES.ARCHIVE_APPROVAL,
    decision: 'pending',
    requesterUserId: session.user.id,
    requesterName: cleanText(session.user.name) || null,
    requesterEmail: cleanText(session.user.email) || null,
    requestedReason: cleanText(reason) || 'Archive requested by coordinator.',
    requestedAt: now.toISOString(),
    contactId: contact.id,
    contactName: cleanText(contact.name) || null,
    businessUnitId: contact.primaryBusinessUnitId || lead?.businessUnitId || null,
    leadId: lead?.id || null,
    idempotencyKey: archiveApprovalIdempotencyKey(contact.id),
    existingRequestCount,
  };
}

export function archiveApprovalIdempotencyKey(contactId) {
  return `contact_archive:${contactId}`;
}

export function canReviewArchiveApproval(session = {}) {
  return Boolean(
    userHasRole(session.user, ROLE_KEYS.ADMIN) ||
    userHasRole(session.user, ROLE_KEYS.SENIOR_COORDINATOR)
  );
}

export function assertCanReviewArchiveApproval(session = {}) {
  if (!canReviewArchiveApproval(session)) {
    throw createCrmError('Only senior coordinators and admins can review archive approvals.', 403);
  }
}

export async function findOpenArchiveApprovalTask(db, { organizationId, contactId }) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.organizationId, organizationId),
      eq(tasks.contactId, contactId),
      eq(tasks.taskType, TASK_TYPES.ARCHIVE_APPROVAL),
      inArray(tasks.status, ARCHIVE_APPROVAL_OPEN_STATUSES),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  return task || null;
}

export async function findSeniorReviewerForBusinessUnit(db, { organizationId, businessUnitId, excludeUserId }) {
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

async function notifyReviewer(tx, { organizationId, businessUnitId, contactId, leadId, reviewer, requesterUserId, contactName, taskId }) {
  if (!reviewer?.id || reviewer.id === requesterUserId) return null;
  const [notification] = await tx
    .insert(notifications)
    .values({
      organizationId,
      businessUnitId,
      userId: reviewer.id,
      type: ARCHIVE_APPROVAL_NOTIFICATION_TYPE,
      sourceType: ARCHIVE_APPROVAL_SOURCE_TYPE,
      title: `Archive approval requested - ${cleanText(contactName) || 'Contact'}`,
      body: 'Review the archive approval task before the contact is removed from active CRM lists.',
      href: `/tasks/${taskId}`,
      contactId,
      leadId: leadId || null,
      metadataJson: {
        taskId,
        requesterUserId,
        contactName: cleanText(contactName) || null,
      },
      idempotencyKey: `archive_approval:${taskId}:${reviewer.id}`,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return notification || null;
}

export async function createOrReuseArchiveApprovalTask({
  db,
  organizationId,
  session,
  contact,
  lead = null,
  reason,
}) {
  if (!isRegularCoordinatorSession(session)) {
    throw createCrmError('Archive approval requests are only required for regular coordinators.', 400);
  }

  const businessUnitId = contact.primaryBusinessUnitId || lead?.businessUnitId || null;
  if (!businessUnitId) {
    throw createCrmError('Contact must belong to a business unit before archive approval can be requested.');
  }

  const existingTask = await findOpenArchiveApprovalTask(db, { organizationId, contactId: contact.id });
  if (existingTask) {
    return { task: existingTask, reused: true, reviewer: null };
  }

  const now = new Date();
  const reviewer = await findSeniorReviewerForBusinessUnit(db, {
    organizationId,
    businessUnitId,
    excludeUserId: session.user.id,
  });
  const metadataJson = archiveTaskMetadata({ contact, lead, session, reason, now });

  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(tasks)
      .values({
        organizationId,
        businessUnitId,
        contactId: contact.id,
        leadId: lead?.id || null,
        title: archiveTaskTitle(contact),
        description: archiveTaskDescription({ contact, reason, session }),
        taskType: TASK_TYPES.ARCHIVE_APPROVAL,
        status: TASK_STATUSES.OPEN,
        priority: 'high',
        dueAt: now,
        ownerUserId: reviewer?.id || null,
        createdByUserId: session.user.id,
        sourceType: ARCHIVE_APPROVAL_SOURCE_TYPE,
        sourceId: archiveApprovalIdempotencyKey(contact.id),
        sourceLabel: 'Archive approval',
        metadataJson,
      })
      .returning();

    await tx.insert(taskEvents).values({
      taskId: task.id,
      organizationId,
      businessUnitId,
      eventType: TASK_EVENT_TYPES.CREATED,
      toStatus: task.status,
      toOwnerUserId: task.ownerUserId || null,
      toDueAt: task.dueAt,
      actorUserId: session.user.id,
      message: 'Requested contact archive approval.',
      metadataJson,
      occurredAt: now,
    });

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId,
      contactId: contact.id,
      leadId: lead?.id || null,
      eventType: 'contact.archive_approval_requested',
      message: `Requested archive approval: ${metadataJson.requestedReason}`,
      metadataJson: {
        ...metadataJson,
        taskId: task.id,
        reviewerUserId: reviewer?.id || null,
      },
      actorUserId: session.user.id,
      occurredAt: now,
    });

    await notifyReviewer(tx, {
      organizationId,
      businessUnitId,
      contactId: contact.id,
      leadId: lead?.id || null,
      reviewer,
      requesterUserId: session.user.id,
      contactName: contact.name,
      taskId: task.id,
    });

    return { task, reused: false, reviewer };
  });
}

export async function decideArchiveApprovalTask({
  db,
  organizationId,
  session,
  existingTask,
  decision,
  reason = '',
}) {
  assertCanReviewArchiveApproval(session);
  if (existingTask.taskType !== TASK_TYPES.ARCHIVE_APPROVAL) {
    throw createCrmError('Task is not an archive approval request.', 400);
  }
  if (!ARCHIVE_APPROVAL_OPEN_STATUSES.includes(existingTask.status)) {
    throw createCrmError('Archive approval task is already closed.', 409);
  }

  const normalizedDecision = cleanText(decision).toLowerCase();
  if (!['approve', 'deny'].includes(normalizedDecision)) {
    throw createCrmError('Archive approval decision must be approve or deny.');
  }

  const now = new Date();
  const metadata = existingTask.metadataJson || {};
  const decisionReason = cleanText(reason) || (
    normalizedDecision === 'approve'
      ? metadata.requestedReason || 'Archive approved.'
      : 'Archive request denied.'
  );

  return db.transaction(async (tx) => {
    const [task] = await tx
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

    if (!task) {
      throw createCrmError('Archive approval task was already updated. Refresh the queue and try again.', 409);
    }

    let archivedContact = null;
    if (normalizedDecision === 'approve') {
      const [contact] = await tx
        .update(contacts)
        .set({
          archivedAt: now,
          archivedByUserId: session.user.id,
          archiveReason: decisionReason,
          updatedAt: now,
        })
        .where(and(
          eq(contacts.id, existingTask.contactId),
          eq(contacts.organizationId, organizationId),
          isNull(contacts.archivedAt),
        ))
        .returning({
          id: contacts.id,
          name: contacts.name,
          primaryBusinessUnitId: contacts.primaryBusinessUnitId,
        });
      archivedContact = contact || null;
      if (!archivedContact) {
        throw createCrmError('Contact is already archived or no longer exists.', 409);
      }
    }

    await tx.insert(taskEvents).values({
      taskId: task.id,
      organizationId,
      businessUnitId: task.businessUnitId,
      eventType: normalizedDecision === 'approve' ? TASK_EVENT_TYPES.COMPLETED : TASK_EVENT_TYPES.CANCELED,
      fromStatus: existingTask.status,
      toStatus: task.status,
      fromOwnerUserId: existingTask.ownerUserId || null,
      toOwnerUserId: task.ownerUserId || null,
      fromDueAt: existingTask.dueAt || null,
      toDueAt: task.dueAt || null,
      actorUserId: session.user.id,
      message: normalizedDecision === 'approve'
        ? 'Approved contact archive request.'
        : 'Denied contact archive request.',
      metadataJson: {
        decision: normalizedDecision,
        reason: decisionReason,
        requesterUserId: metadata.requesterUserId || null,
        contactId: existingTask.contactId || null,
      },
      occurredAt: now,
    });

    await tx.insert(activityEvents).values({
      organizationId,
      businessUnitId: task.businessUnitId,
      contactId: existingTask.contactId || null,
      leadId: existingTask.leadId || null,
      eventType: normalizedDecision === 'approve'
        ? 'contact.archived'
        : 'contact.archive_approval_denied',
      message: normalizedDecision === 'approve'
        ? `Archived contact: ${decisionReason}`
        : `Denied archive request: ${decisionReason}`,
      metadataJson: {
        source: 'archive_approval_task',
        taskId: task.id,
        decision: normalizedDecision,
        reason: decisionReason,
        requesterUserId: metadata.requesterUserId || null,
        reviewerUserId: session.user.id,
        contactName: archivedContact?.name || metadata.contactName || null,
      },
      actorUserId: session.user.id,
      occurredAt: now,
    });

    return { task, archivedContact, decision: normalizedDecision };
  });
}
