import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  businessUnits,
  contacts,
  leads,
  tasks,
  users,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  assertCanAccessContactLead,
  assertCanAssignUser,
  canAccessBusinessUnit,
  isRegularCoordinatorSession,
  resolveContactById,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { evaluateLifecycleTransition } from '@/lib/crm/lifecycle.js';
import {
  leadProfilePatchFromPayload,
  leadProfilePatchToDrizzleValues,
  leadProfileSummary,
} from '@/lib/crm/lead-profile.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '@/lib/tasks/constants.js';
import {
  contactPatchForFollowUpOutcome,
  followUpActivityMessage,
  leadStatusForFollowUpOutcome,
  normalizeFollowUpCompletionPayload,
} from '@/lib/tasks/follow-up.js';
import {
  completeFollowUpTaskWithActivity,
  recordFollowUpActivity,
  toTaskPayload,
} from '@/lib/tasks/service.js';

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function stringParam(value) {
  return String(value || '').trim();
}

function optionalUuid(value, fieldName) {
  const id = stringParam(value);
  if (!id) return null;
  if (!isUuid(id)) throw createCrmError(`${fieldName} must be a valid id.`);
  return id;
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
  assertCanAssignUser(session, user.id, 'Regular coordinators cannot assign tasks to other users.');
  return user.id;
}

async function resolveLatestLeadForContact(db, organizationId, contactId) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
}

async function resolveBusinessUnitById(db, session, businessUnitId) {
  if (!businessUnitId) return null;
  const [businessUnit] = await db
    .select()
    .from(businessUnits)
    .where(and(eq(businessUnits.id, businessUnitId), eq(businessUnits.organizationId, session.user.organizationId)))
    .limit(1);
  return businessUnit || null;
}

async function findOldestOpenFollowUpTask(db, session, contactId) {
  if (!session.user.canAccessAllBusinessUnits && !session.user.businessUnitIds?.length) {
    return null;
  }

  const conditions = [
    eq(tasks.organizationId, session.user.organizationId),
    eq(tasks.contactId, contactId),
    eq(tasks.taskType, TASK_TYPES.FOLLOW_UP),
    inArray(tasks.status, [TASK_STATUSES.OPEN, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.SNOOZED]),
  ];
  if (!session.user.canAccessAllBusinessUnits) {
    conditions.push(inArray(tasks.businessUnitId, session.user.businessUnitIds));
  }
  if (isRegularCoordinatorSession(session)) {
    conditions.push(eq(tasks.ownerUserId, session.user.id));
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.dueAt), asc(tasks.createdAt))
    .limit(1);

  return task || null;
}

function buildFollowUpTransition({
  completion,
  lead,
  businessUnit,
  session,
  now,
  source,
  taskId = null,
  contactId,
}) {
  const suggestedLeadStatus = lead ? leadStatusForFollowUpOutcome(completion.outcome, businessUnit) : null;
  const leadProfilePatch = leadProfilePatchFromPayload(completion.rawPayload || {}, { allowClear: false });
  const leadProfileDbPatch = leadProfilePatchToDrizzleValues(leadProfilePatch);
  const leadProfileUpdateSummary = leadProfileSummary(leadProfilePatch);
  let leadPatch = null;
  let leadStatusChange = null;
  let statusTransitionMeta = null;

  if (lead && suggestedLeadStatus) {
    leadPatch = { updatedAt: now };
    const transition = evaluateLifecycleTransition({
      fromStatus: lead.currentStage || lead.status,
      toStatus: suggestedLeadStatus,
      businessUnit,
      canReopenClosedStatus: session.user.canAccessAllBusinessUnits,
      reopenClosedStatusReason: 'new_course_follow_up',
    });
    statusTransitionMeta = transition;
    if (transition.allowed && transition.changed) {
      Object.assign(leadPatch, {
        status: transition.toStatus,
        currentStage: transition.toStatus,
      });
      leadStatusChange = {
        ...transition,
        reason: transition.reason
          ? `Follow-up outcome: ${completion.outcome}. ${transition.reason}`
          : `Follow-up outcome: ${completion.outcome}`,
      };
    }
  }

  if (lead && Object.keys(leadProfileDbPatch).length) {
    leadPatch = {
      ...(leadPatch || {}),
      ...leadProfileDbPatch,
      updatedAt: now,
    };
  }

  const activityMetadata = compactObject({
    source,
    taskId,
    contactId,
    outcome: completion.outcome,
    outcomeLabel: completion.outcomeLabel,
    channel: completion.channel,
    contactMethod: completion.contactMethod,
    note: completion.note,
    nextDueAt: completion.nextDueAt?.toISOString?.() || null,
    statusTransition: statusTransitionMeta,
    leadProfile: Object.keys(leadProfilePatch).length ? leadProfilePatch : null,
  });

  return {
    leadPatch,
    leadStatusChange,
    leadProfilePatch,
    leadProfileUpdateSummary,
    activityMetadata,
    profileActivity: leadProfileUpdateSummary
      ? {
          eventType: 'lead_profile.updated',
          message: `Updated lead profile: ${leadProfileUpdateSummary}.`,
          metadataJson: compactObject({
            source,
            taskId,
            outcome: completion.outcome,
            leadProfile: leadProfilePatch,
          }),
          occurredAt: completion.occurredAt,
        }
      : null,
  };
}

function safeTaskSummary(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    dueAt: task.dueAt?.toISOString?.() || task.dueAt || null,
    status: task.status,
  };
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const lead = await resolveLatestLeadForContact(db, session.user.organizationId, contact.id);
    assertCanAccessContactLead(session, lead, contact);
    const task = await findOldestOpenFollowUpTask(db, session, contact.id);
    return NextResponse.json({ task: safeTaskSummary(task) });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  const now = new Date();

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const explicitTaskId = optionalUuid(body.taskId, 'taskId');
    const existingTask = explicitTaskId
      ? (await db
          .select()
          .from(tasks)
          .where(and(
            eq(tasks.id, explicitTaskId),
            eq(tasks.organizationId, session.user.organizationId),
            eq(tasks.contactId, contact.id),
            eq(tasks.taskType, TASK_TYPES.FOLLOW_UP),
          ))
          .limit(1))[0]
      : await findOldestOpenFollowUpTask(db, session, contact.id);

    if (explicitTaskId && !existingTask) throw createCrmError('Follow-up task not found.', 404);
    if (existingTask && !canAccessBusinessUnit(session, existingTask.businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
    if (existingTask && isRegularCoordinatorSession(session) && existingTask.ownerUserId !== session.user.id) {
      throw createCrmError('Regular coordinators can only access tasks assigned to them.', 403);
    }

    const lead = existingTask?.leadId
      ? (await db
          .select()
          .from(leads)
          .where(and(eq(leads.id, existingTask.leadId), eq(leads.organizationId, session.user.organizationId)))
          .limit(1))[0] || null
      : await resolveLatestLeadForContact(db, session.user.organizationId, contact.id);
    assertCanAccessContactLead(session, lead, contact);

    const businessUnitId = existingTask?.businessUnitId || lead?.businessUnitId || contact.primaryBusinessUnitId;
    if (!businessUnitId) throw createCrmError('A business unit is required to log follow-up.');
    if (!canAccessBusinessUnit(session, businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
    const businessUnit = await resolveBusinessUnitById(db, session, businessUnitId);
    if (!businessUnit) throw createCrmError('Business unit not found.', 404);

    const completion = normalizeFollowUpCompletionPayload({
      task: existingTask || { taskType: TASK_TYPES.FOLLOW_UP },
      payload: body,
      now,
    });
    completion.rawPayload = body;

    const source = existingTask ? 'contact_log_follow_up_task' : 'contact_log_follow_up';
    const transition = buildFollowUpTransition({
      completion,
      lead,
      businessUnit,
      session,
      now,
      source,
      taskId: existingTask?.id || null,
      contactId: contact.id,
    });
    const effectiveOwnerUserId = existingTask?.ownerUserId || session.user.id;
    const nextOwnerUserId = completion.createNextTask && completion.nextDueAt
      ? await resolveOrganizationUserId(
          db,
          session,
          body.nextOwnerUserId || body.nextAssignedTo || effectiveOwnerUserId,
          'nextOwnerUserId',
        )
      : null;
    if (completion.createNextTask && completion.nextDueAt && !nextOwnerUserId) {
      throw createCrmError('Next follow-up owner is required.');
    }
    const nextTaskValues = completion.createNextTask && completion.nextDueAt
      ? {
          title: stringParam(body.nextTaskTitle) || existingTask?.title || `Follow up - ${contact.name}`,
          description: stringParam(body.nextTaskDescription) || null,
          taskType: TASK_TYPES.FOLLOW_UP,
          status: TASK_STATUSES.OPEN,
          priority: existingTask?.priority || TASK_PRIORITIES.MEDIUM,
          dueAt: completion.nextDueAt,
          ownerUserId: nextOwnerUserId,
          snoozedUntil: null,
          completedAt: null,
          canceledAt: null,
          sourceType: 'manual',
          sourceId: existingTask?.id || contact.id,
          sourceLabel: 'Follow-up completion',
          metadataJson: compactObject({
            createdFromTaskId: existingTask?.id || null,
            previousOutcome: completion.outcome,
          }),
        }
      : null;

    if (existingTask) {
      const { task, nextTask } = await completeFollowUpTaskWithActivity({
        db,
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        existingTask,
        taskPatch: {
          updatedAt: now,
          status: TASK_STATUSES.COMPLETED,
          completedAt: now,
          canceledAt: null,
          ownerUserId: effectiveOwnerUserId,
          ...(lead?.id && !existingTask.leadId ? { leadId: lead.id } : {}),
        },
        followUpActivity: {
          eventType: completion.eventType,
          message: followUpActivityMessage(completion),
          noteBody: completion.note,
          metadataJson: transition.activityMetadata,
          occurredAt: completion.occurredAt,
        },
        taskEventMetadata: compactObject({
          followUpOutcome: completion.outcome,
          activityEventType: completion.eventType,
          nextDueAt: completion.nextDueAt?.toISOString?.() || null,
          nextOwnerUserId,
        }),
        contactPatch: contactPatchForFollowUpOutcome(completion.outcome, now),
        leadPatch: transition.leadPatch,
        leadStatusChange: transition.leadStatusChange,
        cancelOpenFollowUps: transition.leadStatusChange?.toStatus === 'Not Interested',
        profileActivity: transition.profileActivity,
        nextTaskValues,
        nextTaskEventMetadata: compactObject({
          createdFromTaskId: existingTask.id,
          followUpOutcome: completion.outcome,
          ownerUserId: nextOwnerUserId,
        }),
      });

      return NextResponse.json({
        completedTask: toTaskPayload(task),
        nextTask: toTaskPayload(nextTask),
        taskMatched: true,
      });
    }

    const { nextTask } = await recordFollowUpActivity({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      context: {
        businessUnitId,
        contactId: contact.id,
        leadId: lead?.id || null,
      },
      followUpActivity: {
        eventType: completion.eventType,
        message: followUpActivityMessage(completion),
        noteBody: completion.note,
        metadataJson: transition.activityMetadata,
        occurredAt: completion.occurredAt,
      },
      contactPatch: contactPatchForFollowUpOutcome(completion.outcome, now),
      leadPatch: transition.leadPatch,
      leadStatusChange: transition.leadStatusChange,
      cancelOpenFollowUps: transition.leadStatusChange?.toStatus === 'Not Interested',
      profileActivity: transition.profileActivity,
      nextTaskValues,
      nextTaskEventMetadata: compactObject({
        contactId: contact.id,
        followUpOutcome: completion.outcome,
        ownerUserId: nextOwnerUserId,
      }),
    });

    return NextResponse.json({
      completedTask: null,
      nextTask: toTaskPayload(nextTask),
      taskMatched: false,
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
