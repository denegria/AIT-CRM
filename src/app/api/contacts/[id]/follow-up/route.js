import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
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
import {
  evaluateLifecycleTransition,
  isNoFurtherProspectingLifecycleStatus,
  WORKFLOW_KEYS,
  workflowKeyForBusinessUnit,
} from '@/lib/crm/lifecycle.js';
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
  assertExactFollowUpTaskSelection,
  createFollowUpSelectionError,
  FOLLOW_UP_SELECTION_ERROR_CODES,
  resolveExactFollowUpTaskRequest,
} from '@/lib/tasks/follow-up-selection.js';
import { resolveFollowUpLeadContext } from '@/lib/tasks/follow-up-context.js';
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

async function resolveLeadById(db, organizationId, leadId) {
  if (!leadId) return null;
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  return lead || null;
}

async function listLeadsForContact(db, organizationId, contactId) {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)));
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
    contactId: task.contactId || null,
    leadId: task.leadId || null,
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
    const { searchParams } = new URL(request.url);
    const requestedTaskId = optionalUuid(searchParams.get('taskId'), 'taskId');
    const requestedLeadId = optionalUuid(searchParams.get('leadId'), 'leadId');
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const task = await resolveExactFollowUpTaskRequest({
      requestedTaskId,
      requestedContactId: contact.id,
      requestedLeadId,
      hasContactId: true,
      hasLeadId: searchParams.has('leadId'),
      loadTaskById: async (taskId) => (await db
        .select()
        .from(tasks)
        .where(and(
          eq(tasks.id, taskId),
          eq(tasks.organizationId, session.user.organizationId),
        ))
        .limit(1))[0] || null,
      authorizeTask: (selectedTask) => {
        if (!canAccessBusinessUnit(session, selectedTask.businessUnitId)) {
          throw createFollowUpSelectionError(
            'Insufficient business-unit access.',
            FOLLOW_UP_SELECTION_ERROR_CODES.UNAUTHORIZED,
            403,
          );
        }
        if (isRegularCoordinatorSession(session) && selectedTask.ownerUserId !== session.user.id) {
          throw createFollowUpSelectionError(
            'Regular coordinators can only access tasks assigned to them.',
            FOLLOW_UP_SELECTION_ERROR_CODES.UNAUTHORIZED,
            403,
          );
        }
      },
    });
    const leadContext = await resolveFollowUpLeadContext({
      session,
      contact,
      task,
      requestedLeadId,
      hasRequestedLeadId: searchParams.has('leadId'),
      loadLeadById: (leadId) => resolveLeadById(db, session.user.organizationId, leadId),
      loadLeadsForContact: (contactId) => listLeadsForContact(db, session.user.organizationId, contactId),
    });
    return NextResponse.json({
      task: safeTaskSummary(task),
      leadId: leadContext.leadId,
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request, { params }, runtime = {}) {
  const requirePermissionForRequest = runtime.requirePermissionForRequest || requirePermission;
  const getDbForRequest = runtime.getDbForRequest || getDb;
  const completeFollowUpForRequest = runtime.completeFollowUpForRequest || completeFollowUpTaskWithActivity;
  const recordFollowUpForRequest = runtime.recordFollowUpForRequest || recordFollowUpActivity;
  const { error, session } = await requirePermissionForRequest(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const now = new Date();

  try {
    const completion = normalizeFollowUpCompletionPayload({
      task: { taskType: TASK_TYPES.FOLLOW_UP },
      payload: body,
      now,
    });
    completion.rawPayload = body;
    const db = getDbForRequest();
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const explicitTaskId = optionalUuid(body.taskId, 'taskId');
    const requestedContactId = optionalUuid(body.contactId, 'contactId');
    const requestedLeadId = optionalUuid(body.leadId, 'leadId');
    if (!Object.prototype.hasOwnProperty.call(body, 'contactId') ||
        !Object.prototype.hasOwnProperty.call(body, 'leadId')) {
      throw createFollowUpSelectionError(
        'Follow-up logging requires the selected contact and lead identifiers. Reopen the follow-up and try again.',
        FOLLOW_UP_SELECTION_ERROR_CODES.MISSING_IDENTIFIERS,
        400,
      );
    }
    if (requestedContactId !== contact.id) {
      throw createFollowUpSelectionError(
        'The follow-up request no longer matches this contact. Refresh and try again.',
        FOLLOW_UP_SELECTION_ERROR_CODES.MISMATCH,
      );
    }
    const existingTask = explicitTaskId
      ? ((await db
          .select()
          .from(tasks)
          .where(and(
            eq(tasks.id, explicitTaskId),
            eq(tasks.organizationId, session.user.organizationId),
          ))
          .limit(1))[0] || null)
      : null;

    if (existingTask && !canAccessBusinessUnit(session, existingTask.businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
    if (existingTask && isRegularCoordinatorSession(session) && existingTask.ownerUserId !== session.user.id) {
      throw createCrmError('Regular coordinators can only access tasks assigned to them.', 403);
    }
    if (explicitTaskId) {
      assertExactFollowUpTaskSelection({
        task: existingTask,
        requestedTaskId: explicitTaskId,
        requestedContactId,
        requestedLeadId,
        hasContactId: true,
        hasLeadId: true,
      });
    }

    const leadContext = await resolveFollowUpLeadContext({
      session,
      contact,
      task: existingTask,
      requestedLeadId,
      hasRequestedLeadId: true,
      loadLeadById: (leadId) => resolveLeadById(db, session.user.organizationId, leadId),
      loadLeadsForContact: (contactId) => listLeadsForContact(db, session.user.organizationId, contactId),
    });
    const lead = leadContext.lead;

    const businessUnitId = existingTask?.businessUnitId || lead?.businessUnitId || contact.primaryBusinessUnitId;
    if (!businessUnitId) throw createCrmError('A business unit is required to log follow-up.');
    if (!canAccessBusinessUnit(session, businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
    const businessUnit = await resolveBusinessUnitById(db, session, businessUnitId);
    if (!businessUnit) throw createCrmError('Business unit not found.', 404);

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
      const { task, nextTask } = await completeFollowUpForRequest({
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
        cancelOpenFollowUps: isNoFurtherProspectingLifecycleStatus(transition.leadStatusChange?.toStatus),
        cancelOpenFollowUpsContext: {
          source: 'follow_up_completion',
          lifecycleStatus: transition.leadStatusChange?.toStatus || null,
        },
        followUpOutcome: completion.outcome,
        followUpChannel: completion.channel,
        ...(workflowKeyForBusinessUnit(businessUnit) === WORKFLOW_KEYS.AIT_USA && transition.leadPatch && lead ? {
          aitUsaOpportunityMutation: {
            organizationId: session.user.organizationId,
            businessUnit,
            contact,
            expectedOpportunityId: lead.id,
            toStatus: leadStatusForFollowUpOutcome(completion.outcome, businessUnit) || undefined,
            reopenReason: 'new_course_follow_up',
            terminalReason: transition.leadStatusChange?.reason || `Follow-up outcome: ${completion.outcome}`,
            authorize: ({ opportunity }) => assertCanAccessContactLead(session, opportunity, contact),
          },
        } : {}),
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

    const { nextTask } = await recordFollowUpForRequest({
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
      cancelOpenFollowUps: false,
      followUpOutcome: completion.outcome,
      followUpChannel: completion.channel,
      ...(workflowKeyForBusinessUnit(businessUnit) === WORKFLOW_KEYS.AIT_USA && transition.leadPatch && lead ? {
        aitUsaOpportunityMutation: {
          organizationId: session.user.organizationId,
          businessUnit,
          contact,
          expectedOpportunityId: lead.id,
          toStatus: leadStatusForFollowUpOutcome(completion.outcome, businessUnit) || undefined,
          reopenReason: 'new_course_follow_up',
          terminalReason: transition.leadStatusChange?.reason || `Follow-up outcome: ${completion.outcome}`,
          authorize: ({ opportunity }) => assertCanAccessContactLead(session, opportunity, contact),
        },
      } : {}),
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
