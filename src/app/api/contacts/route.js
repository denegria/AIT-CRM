import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import {
  activityEvents,
  businessUnitMemberships,
  businessUnits,
  contacts,
  roles,
  userRoles,
  users,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  assertCanAccessContactLead,
  assertCanAssignUser,
  canArchiveContactsDirectly,
  canAccessContact,
  isRegularCoordinatorSession,
  resolveBusinessUnitId,
  resolveOptionalBusinessUnitId,
} from '@/lib/crm/access.js';
import {
  assertCanManageAitUsaAssignments,
  isEligibleAitUsaAssigneeRole,
} from '@/lib/crm/ait-usa-assignment-policy.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { validateManualContactIdentity } from '@/lib/crm/contact-input.js';
import {
  leadProfileForPayload,
  leadProfilePatchFromPayload,
  leadProfilePatchToDrizzleValues,
} from '@/lib/crm/lead-profile.js';
import {
  courseMetadataForPayload,
  courseMetadataPatchFromPayload,
  courseMetadataPatchToDrizzleValues,
  validateCourseMetadataForStatus,
} from '@/lib/crm/course-metadata.js';
import {
  evaluateLifecycleTransition,
  isClosedLifecycleStatus,
  requireLifecycleStatus,
  WORKFLOW_KEYS,
  workflowKeyForBusinessUnit,
} from '@/lib/crm/lifecycle.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createContactWithLead,
  latestLeadForContact,
  updateContactWithLeadAndNotes,
  updateContactWithLeadAndNotesInTransaction,
} from '@/lib/crm/write-helpers.js';
import {
  loadScopedOpportunityById,
  resolveAitUsaActiveOpportunity,
  withLockedAitUsaOpportunityMutation,
} from '@/lib/crm/ait-usa-opportunities.js';
import { createOrReuseArchiveApprovalTask } from '@/lib/tasks/archive-approvals.js';
import { toTaskPayload } from '@/lib/tasks/service.js';
import { workflowFromLead } from '@/lib/sales-workflow';
import { summarizeContactTouch } from '@/lib/contact-touch.js';
import { buildAitUsaEnrollmentSignals } from '@/lib/ait-usa-enrollment-signals.js';
import { loadContactDirectoryPage } from '@/lib/contact-directory/service.js';
import { canonicalAitUsaSchoolLocation } from '@/lib/school-locations.js';
import { hasOpportunityMutationRequest } from '@/lib/crm/contact-profile-patch.js';

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get('view') !== 'directory') {
    return NextResponse.json({ error: 'A supported contacts view is required.' }, { status: 400 });
  }
  try {
    const payload = await loadContactDirectoryPage({ db: getDb(), session, searchParams });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('Contact directory load failed:', error);
    return NextResponse.json({ error: 'Contact directory could not load.' }, { status: 500 });
  }
}

async function loadBusinessUnitForWorkflow(db, session, businessUnitId) {
  if (!businessUnitId) return null;
  const [businessUnit] = await db
    .select({ id: businessUnits.id, name: businessUnits.name, label: businessUnits.label })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
    ))
    .limit(1);
  return businessUnit || null;
}

export function toContactPayload(row, lead = null, noteRows = [], businessUnit = null, activityEventRows = []) {
  const workflow = workflowFromLead(lead, { businessUnit });
  const enrollmentSignals = buildAitUsaEnrollmentSignals({
    contact: row,
    lead,
    workflow,
  });
  const touchSummary = summarizeContactTouch({
    contact: row,
    businessUnit,
    notes: noteRows,
    activityEvents: activityEventRows,
  });
  const submittedAt = activityEventRows
    .filter((event) => String(event.eventType || '').toLowerCase() === 'website_lead_captured')
    .filter((event) => !lead?.id || !event.leadId || event.leadId === lead.id)
    .map((event) => event.occurredAt || event.createdAt)
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    address: row.address || '',
    businessUnitId: row.primaryBusinessUnitId || '',
    primaryBusinessUnitId: row.primaryBusinessUnitId || '',
    businessUnitName: businessUnit?.name || '',
    hasLeadStatus: Boolean(lead),
    opportunityId: lead?.id || '',
    opportunityConflict: Boolean(row.opportunityConflict),
    activeOpportunityCount: Number(row.activeOpportunityCount || 0),
    workflowKey: workflow.workflowKey,
    workflowLabel: workflow.workflowLabel,
    status: workflow.status,
    currentStage: workflow.currentStage,
    tags: workflow.tags,
    nextAction: workflow.nextAction,
    priority: workflow.priority,
    outreachState: workflow.outreachState,
    needsFirstOutreach: workflow.needsFirstOutreach,
    source: lead?.sourceName || row.sourceLabel || '',
    leadProfile: leadProfileForPayload(lead),
    courseMetadata: courseMetadataForPayload(lead),
    enrollmentSignals,
    programInterest: lead?.programInterest || '',
    preferredDay: lead?.preferredDay || '',
    preferredSchedule: lead?.preferredSchedule || '',
    testInterest: lead?.testInterest || '',
    educationLevel: lead?.educationLevel || '',
    schoolName: lead?.schoolName || '',
    locationPreference: lead?.locationPreference || '',
    profileDetails: lead?.profileDetails || '',
    sourceDetail: lead?.sourceDetail || '',
    assignedTo: lead?.assignedUserId || '',
    submittedAt: submittedAt?.toISOString?.() || submittedAt || '',
    contactCreatedAt: row.createdAt?.toISOString?.() || row.createdAt || '',
    leadCreatedAt: lead?.createdAt?.toISOString?.() || lead?.createdAt || '',
    createdAt: lead?.createdAt?.toISOString?.() || row.createdAt?.toISOString?.() || lead?.createdAt || row.createdAt || '',
    lastContact: touchSummary.lastTouch,
    lastTouch: touchSummary.lastTouch,
    lastTouchLabel: touchSummary.lastTouchLabel,
    lastTouchText: touchSummary.lastTouchText,
    latestComment: touchSummary.latestComment,
    latestCommentDate: touchSummary.latestCommentDate,
    latestCommentLabel: touchSummary.latestCommentLabel,
    lastEdited: touchSummary.lastEdited,
    notes: noteRows.map((note) => ({
      id: note.id,
      text: note.body,
      createdAt: note.createdAt?.toISOString?.() || '',
      timestamp: note.createdAt?.toISOString?.() || '',
      date: note.createdAt?.toISOString?.().slice(0, 10) || '',
    })),
  };
}

function requestedBusinessUnitId(body) {
  return body.businessUnitId || body.primaryBusinessUnitId || '';
}

function hasBusinessUnitRequest(body) {
  return 'businessUnitId' in body || 'primaryBusinessUnitId' in body;
}

async function resolveAssignableUserId(db, session, value, fieldName = 'assignedTo', businessUnit = null) {
  const id = String(value || '').trim();
  const isAitUsa = workflowKeyForBusinessUnit(businessUnit) === WORKFLOW_KEYS.AIT_USA;
  if (isAitUsa) assertCanManageAitUsaAssignments(session);
  if (!id) return null;
  if (!isUuid(id)) throw createCrmError(`${fieldName} must be a valid user id.`);
  assertCanAssignUser(session, id);

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.id, id),
      eq(users.organizationId, session.user.organizationId),
      eq(users.isActive, true),
    ))
    .limit(1);

  if (!user) throw createCrmError('Assigned user not found.', 404);
  if (isAitUsa) {
    const [roleRows, membershipRows] = await Promise.all([
      db
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(
          eq(userRoles.userId, id),
          eq(roles.organizationId, session.user.organizationId),
        )),
      db
        .select({ businessUnitId: businessUnitMemberships.businessUnitId })
        .from(businessUnitMemberships)
        .where(eq(businessUnitMemberships.userId, id)),
    ]);
    if (!isEligibleAitUsaAssigneeRole({
      roleKeys: roleRows.map((row) => row.key).filter(Boolean),
      assigneeUserId: id,
      actorUserId: session.user.id,
    })) {
      throw createCrmError('Selected AIT USA assignee must be a regular Coordinator or the acting Senior Coordinator.');
    }
    if (!membershipRows.some((row) => row.businessUnitId === businessUnit.id)) {
      throw createCrmError('Selected assignee does not belong to the AIT USA business unit.');
    }
  }
  return user.id;
}


async function resolveContactBusinessUnitForCreate(db, session, body) {
  const requestedId = requestedBusinessUnitId(body);
  if (!requestedId && hasBusinessUnitRequest(body) && session.user.canAccessAllBusinessUnits) return null;
  return resolveBusinessUnitId({ db, session, businessUnitsTable: businessUnits, requestedId });
}

function parseNoteDate(value) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeAppendNoteInput(rawNote) {
  const body = typeof rawNote === 'object' && rawNote !== null
    ? String(rawNote.body || rawNote.text || '').trim()
    : String(rawNote || '').trim();
  return body ? { body } : null;
}

function normalizeFollowUpNoteInput(rawFollowUpNote) {
  if (!rawFollowUpNote || typeof rawFollowUpNote !== 'object') return null;
  const body = String(rawFollowUpNote.text || rawFollowUpNote.body || rawFollowUpNote.note || '').trim();
  if (!body) return null;
  return {
    body,
    occurredAt: parseNoteDate(rawFollowUpNote.occurredAt || rawFollowUpNote.date || rawFollowUpNote.createdAt),
  };
}

function contactAddressForWrite(value, businessUnit) {
  const current = String(value || '').trim();
  if (workflowKeyForBusinessUnit(businessUnit) !== WORKFLOW_KEYS.AIT_USA) return current || null;
  if (!current) return null;
  const learningLocation = canonicalAitUsaSchoolLocation(current);
  if (!learningLocation) {
    throw createCrmError('Intended Learning Location must be Bound Brook, Plainfield, Piscataway, Flemington, or Online.');
  }
  return learningLocation;
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const validationError = validateManualContactIdentity(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const db = getDb();
  let businessUnitId;
  try {
    businessUnitId = await resolveContactBusinessUnitForCreate(db, session, body);
  } catch (error) {
    return crmErrorResponse(error);
  }
  let status;
  const businessUnit = await loadBusinessUnitForWorkflow(db, session, businessUnitId);
  let assignedUserId = null;
  const isAitUsaCreate = workflowKeyForBusinessUnit(businessUnit) === WORKFLOW_KEYS.AIT_USA;
  const requestedOwnerId = String(
    body.assignedTo || (!isAitUsaCreate && isRegularCoordinatorSession(session) ? session.user.id : ''),
  ).trim();
  if (requestedOwnerId) {
    try {
      assignedUserId = await resolveAssignableUserId(db, session, requestedOwnerId, 'assignedTo', businessUnit);
    } catch (error) {
      return crmErrorResponse(error);
    }
  }
  try {
    status = requireLifecycleStatus(body.status || 'New Lead', { businessUnit });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const initialTerminalReason = String(body.terminalStatusReason || '').trim();
  if (
    workflowKeyForBusinessUnit(businessUnit) === WORKFLOW_KEYS.AIT_USA &&
    isClosedLifecycleStatus(status, { businessUnit }) &&
    !initialTerminalReason
  ) {
    return NextResponse.json(
      { error: 'A reason is required to create an AIT USA Opportunity in a closed status.' },
      { status: 400 },
    );
  }

  let contactAddress;
  try {
    contactAddress = contactAddressForWrite(body.address, businessUnit);
  } catch (error) {
    return crmErrorResponse(error);
  }

  const { contact, lead, noteRows } = await createContactWithLead({
    db,
    organizationId: session.user.organizationId,
    actorUserId: session.user.id,
    contactValues: {
      primaryBusinessUnitId: businessUnitId,
      name,
      email: body.email || null,
      phone: body.phone || null,
      address: contactAddress,
      sourceLabel: body.source || null,
    },
    leadValues: businessUnitId ? {
      businessUnitId,
      sourceType: 'manual',
      sourceName: body.source || 'Manual',
      status,
      currentStage: status,
      assignedUserId,
      ...leadProfilePatchToDrizzleValues(leadProfilePatchFromPayload(body, { allowClear: false })),
    } : null,
    initialLeadStatusReason: initialTerminalReason || null,
    initialNote: normalizeAppendNoteInput(body.appendNote || body.initialNote),
  });

  return NextResponse.json({ contact: toContactPayload(contact, lead, noteRows, businessUnit) }, { status: 201 });
}

export async function PATCH(request, _context = {}, overrides = {}) {
  const requirePermissionForRequest = overrides.requirePermissionForRequest || requirePermission;
  const getDbForRequest = overrides.getDbForRequest || getDb;
  const latestLeadForContactForRequest = overrides.latestLeadForContactForRequest || latestLeadForContact;
  const loadBusinessUnitForRequest = overrides.loadBusinessUnitForRequest || loadBusinessUnitForWorkflow;
  const resolveActiveOpportunityForRequest = overrides.resolveActiveOpportunityForRequest || resolveAitUsaActiveOpportunity;
  const loadScopedOpportunityForRequest = overrides.loadScopedOpportunityForRequest || loadScopedOpportunityById;
  const updateContactForRequest = overrides.updateContactForRequest || updateContactWithLeadAndNotes;
  const updateContactInTransactionForRequest = overrides.updateContactInTransactionForRequest || updateContactWithLeadAndNotesInTransaction;
  const withLockedMutationForRequest = overrides.withLockedMutationForRequest || withLockedAitUsaOpportunityMutation;
  const { error, session } = await requirePermissionForRequest(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body.notes)) {
    return NextResponse.json({ error: 'Contact notes are append-only. Submit appendNote to add a timeline note.' }, { status: 400 });
  }
  const id = String(body.id || '').trim();
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid contact id is required.' }, { status: 400 });
  }

  const db = getDbForRequest();
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, session.user.organizationId)))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }
  if (!canAccessContact(session, existing)) {
    return NextResponse.json({ error: 'Insufficient business-unit access.' }, { status: 403 });
  }

  const patch = { updatedAt: new Date() };
  if ('name' in body) patch.name = String(body.name || '').trim() || existing.name;
  if ('email' in body) patch.email = body.email || null;
  if ('phone' in body) patch.phone = body.phone || null;
  if ('source' in body) patch.sourceLabel = body.source || null;
  const hasBusinessUnitPatch = hasBusinessUnitRequest(body);
  if (hasBusinessUnitPatch) {
    const requestedId = requestedBusinessUnitId(body);
    if (!requestedId && !session.user.canAccessAllBusinessUnits && existing.primaryBusinessUnitId) {
      return NextResponse.json({ error: 'Only all-division users can unassign a contact.' }, { status: 403 });
    }
    try {
      patch.primaryBusinessUnitId = await resolveOptionalBusinessUnitId({
        db,
        session,
        businessUnitsTable: businessUnits,
        requestedId,
      });
    } catch (error) {
      return crmErrorResponse(error);
    }
  }

  let lead = await latestLeadForContactForRequest(db, session.user.organizationId, id);
  const statusBusinessUnitId = hasBusinessUnitPatch && patch.primaryBusinessUnitId
    ? patch.primaryBusinessUnitId
    : existing.primaryBusinessUnitId || lead?.businessUnitId;
  const statusBusinessUnit = await loadBusinessUnitForRequest(db, session, statusBusinessUnitId);
  if (
    hasBusinessUnitPatch &&
    existing.primaryBusinessUnitId &&
    patch.primaryBusinessUnitId &&
    patch.primaryBusinessUnitId !== existing.primaryBusinessUnitId
  ) {
    const currentBusinessUnit = await loadBusinessUnitForRequest(
      db,
      session,
      existing.primaryBusinessUnitId,
    );
    if (workflowKeyForBusinessUnit(currentBusinessUnit) === WORKFLOW_KEYS.AIT_USA) {
      return NextResponse.json(
        { error: 'Move the Contact only after resolving or closing its AIT USA Opportunity.' },
        { status: 409 },
      );
    }
  }
  const isAitUsaWorkflow = workflowKeyForBusinessUnit(statusBusinessUnit) === WORKFLOW_KEYS.AIT_USA;
  let hasAitUsaOpportunityConflict = false;
  let activeOpportunityCount = 0;
  if (isAitUsaWorkflow) {
    let requestedOpportunity = null;
    if (body.opportunityId) {
      if (!isUuid(body.opportunityId)) {
        return NextResponse.json({ error: 'Selected Opportunity id is invalid.' }, { status: 400 });
      }
      requestedOpportunity = await loadScopedOpportunityForRequest(db, {
        organizationId: session.user.organizationId,
        businessUnitId: statusBusinessUnit.id,
        contactId: id,
        opportunityId: body.opportunityId,
      });
      if (!requestedOpportunity) {
        return NextResponse.json({ error: 'Selected Opportunity was not found for this Contact.' }, { status: 409 });
      }
    }
    const activeOpportunity = await resolveActiveOpportunityForRequest({
      client: db,
      organization: session.user.organizationId,
      businessUnit: statusBusinessUnit,
      contact: existing,
      lock: false,
    });
    if (activeOpportunity.status === 'ambiguous') {
      hasAitUsaOpportunityConflict = true;
      activeOpportunityCount = activeOpportunity.activeCount || 2;
      if (hasOpportunityMutationRequest(body)) {
        return NextResponse.json(
          { error: 'This Contact has multiple active Opportunities. Review and resolve the conflict before editing Opportunity fields.' },
          { status: 409 },
        );
      }
      lead = requestedOpportunity;
    } else if (activeOpportunity.status === 'exact') {
      activeOpportunityCount = 1;
      if (requestedOpportunity) {
        lead = requestedOpportunity;
      } else {
        lead = await loadScopedOpportunityForRequest(db, {
          organizationId: session.user.organizationId,
          businessUnitId: statusBusinessUnit.id,
          contactId: id,
          opportunityId: activeOpportunity.leadId,
        });
      }
    } else {
      lead = requestedOpportunity;
    }
  }
  try {
    assertCanAccessContactLead(session, lead, existing);
  } catch (error) {
    return crmErrorResponse(error);
  }
  if ('address' in body) {
    try {
      patch.address = contactAddressForWrite(body.address, statusBusinessUnit);
    } catch (error) {
      return crmErrorResponse(error);
    }
  }
  if (hasBusinessUnitPatch && patch.primaryBusinessUnitId === null && lead) {
    return NextResponse.json(
      { error: 'Contacts with leads must stay assigned to a business unit.' },
      { status: 400 },
    );
  }
  if ('status' in body && !lead) {
    return NextResponse.json(
      { error: isAitUsaWorkflow
        ? 'Contact has no Opportunity lifecycle status to update. Start an Opportunity first.'
        : 'Contact has no lead lifecycle status to update.' },
      { status: 400 },
    );
  }

  const leadProfilePatch = leadProfilePatchFromPayload(body, { allowClear: true });
  const hasLeadProfilePatch = Object.keys(leadProfilePatch).length > 0 ||
    (body.leadProfile && typeof body.leadProfile === 'object');
  const courseMetadataPatch = courseMetadataPatchFromPayload(body, { allowClear: true });
  const hasCourseMetadataPatch = Object.keys(courseMetadataPatch).length > 0 ||
    (body.courseMetadata && typeof body.courseMetadata === 'object');
  const hasLeadPatch = 'status' in body || 'source' in body || 'assignedTo' in body ||
    hasBusinessUnitPatch || hasLeadProfilePatch || hasCourseMetadataPatch;
  let leadPatch = null;
  let leadStatusChange = null;
  if (lead && hasLeadPatch) {
    leadPatch = { updatedAt: new Date() };
    if ('status' in body) {
      if (isAitUsaWorkflow) {
        try {
          const requestedStatus = requireLifecycleStatus(body.status, { businessUnit: statusBusinessUnit });
          leadPatch.status = requestedStatus;
          leadPatch.currentStage = requestedStatus;
        } catch (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      } else {
        let transition;
        try {
          transition = evaluateLifecycleTransition({
            fromStatus: lead.status,
            toStatus: body.status,
            businessUnit: statusBusinessUnit,
            canReopenClosedStatus: session.user.canAccessAllBusinessUnits,
            reopenClosedStatusReason: body.statusChangeReason || body.reopenClosedStatusReason || '',
          });
        } catch (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (!transition.allowed) {
          return NextResponse.json({ error: transition.reason }, { status: 403 });
        }
        leadPatch.status = transition.toStatus;
        leadPatch.currentStage = transition.toStatus;
        leadStatusChange = transition;
      }
    }
    if ('source' in body) leadPatch.sourceName = body.source || null;
    if ('assignedTo' in body) {
      try {
        leadPatch.assignedUserId = await resolveAssignableUserId(
          db,
          session,
          body.assignedTo,
          'assignedTo',
          statusBusinessUnit,
        );
      } catch (error) {
        return crmErrorResponse(error);
      }
    }
    if (hasBusinessUnitPatch && patch.primaryBusinessUnitId) {
      leadPatch.businessUnitId = patch.primaryBusinessUnitId;
    }
    if (hasLeadProfilePatch) {
      Object.assign(leadPatch, leadProfilePatchToDrizzleValues(leadProfilePatch));
    }
    if (hasCourseMetadataPatch) {
      try {
        validateCourseMetadataForStatus({
          courseMetadata: {
            currentCourse: Object.prototype.hasOwnProperty.call(courseMetadataPatch, 'currentCourse')
              ? courseMetadataPatch.currentCourse
              : lead.currentCourse,
            completedCourse: Object.prototype.hasOwnProperty.call(courseMetadataPatch, 'completedCourse')
              ? courseMetadataPatch.completedCourse
              : lead.completedCourse,
            endedCourse: Object.prototype.hasOwnProperty.call(courseMetadataPatch, 'endedCourse')
              ? courseMetadataPatch.endedCourse
              : lead.endedCourse,
            courseOutcome: Object.prototype.hasOwnProperty.call(courseMetadataPatch, 'courseOutcome')
              ? courseMetadataPatch.courseOutcome
              : lead.courseOutcome,
          },
          status: leadPatch.status || lead.status,
          businessUnit: statusBusinessUnit,
          workflowKey: workflowFromLead({ ...lead, ...leadPatch }, { businessUnit: statusBusinessUnit }).workflowKey,
        });
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      Object.assign(leadPatch, courseMetadataPatchToDrizzleValues(courseMetadataPatch));
    }
  }

  let result;
  try {
    const writeValues = {
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      contactId: id,
      contactPatch: patch,
      existingLead: lead,
      leadPatch,
      leadStatusChange,
      appendNote: normalizeAppendNoteInput(body.appendNote),
      addFollowUpNote: normalizeFollowUpNoteInput(body.followUpNote),
    };
    if (isAitUsaWorkflow && lead && hasLeadPatch) {
      result = await withLockedMutationForRequest({
        db,
        organizationId: session.user.organizationId,
        businessUnit: statusBusinessUnit,
        contact: existing,
        expectedOpportunityId: lead.id,
        toStatus: 'status' in body ? body.status : undefined,
        reopenReason: body.statusChangeReason || body.reopenClosedStatusReason || '',
        terminalReason: body.terminalStatusReason || '',
        authorize: ({ opportunity }) => assertCanAccessContactLead(session, opportunity, existing),
        write: ({ tx, opportunity, transition }) => updateContactInTransactionForRequest({
          ...writeValues,
          tx,
          existingLead: opportunity,
          leadPatch: {
            ...leadPatch,
            ...(transition ? {
              status: transition.toStatus,
              currentStage: transition.toStatus,
            } : {}),
          },
          leadStatusChange: transition,
        }),
      });
    } else {
      result = await updateContactForRequest(writeValues);
    }
  } catch (error) {
    return error?.status
      ? crmErrorResponse(error)
      : NextResponse.json({ error: error.message || 'Contact update failed.' }, { status: 500 });
  }

  if (isAitUsaWorkflow && lead && hasLeadPatch) {
    activeOpportunityCount = result.lead && !isClosedLifecycleStatus(
      result.lead.status || result.lead.currentStage,
      { businessUnit: statusBusinessUnit },
    ) ? 1 : 0;
    hasAitUsaOpportunityConflict = false;
  }

  const resultBusinessUnit = await loadBusinessUnitForRequest(
    db,
    session,
    result.contact.primaryBusinessUnitId || result.lead?.businessUnitId,
  );
  return NextResponse.json({
    contact: toContactPayload(
      {
        ...result.contact,
        opportunityConflict: hasAitUsaOpportunityConflict,
        activeOpportunityCount,
      },
      result.lead,
      result.noteRows,
      resultBusinessUnit,
      result.activityEventRows,
    ),
  });
}

export async function DELETE(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid contact id is required.' }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, session.user.organizationId)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }
  if (!canAccessContact(session, existing)) {
    return NextResponse.json({ error: 'Insufficient business-unit access.' }, { status: 403 });
  }
  let lead = null;
  try {
    lead = await latestLeadForContact(db, session.user.organizationId, id);
    assertCanAccessContactLead(session, lead, existing);
  } catch (error) {
    return crmErrorResponse(error);
  }

  const archiveReason = String(body.reason || body.archiveReason || 'Archived by employee request.').trim()
    || 'Archived by employee request.';
  if (!canArchiveContactsDirectly(session)) {
    try {
      const { task, reused } = await createOrReuseArchiveApprovalTask({
        db,
        organizationId: session.user.organizationId,
        session,
        contact: existing,
        lead,
        reason: archiveReason,
      });
      return NextResponse.json({
        ok: true,
        id,
        archived: false,
        approvalRequested: true,
        reused,
        task: toTaskPayload(task),
      }, { status: reused ? 200 : 202 });
    } catch (error) {
      return crmErrorResponse(error);
    }
  }

  const archivedAt = new Date();
  const archived = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({
        archivedAt,
        archivedByUserId: session.user.id,
        archiveReason,
        updatedAt: archivedAt,
      })
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, session.user.organizationId)))
      .returning({
        id: contacts.id,
        name: contacts.name,
        primaryBusinessUnitId: contacts.primaryBusinessUnitId,
      });

    if (!row) return null;

    await tx.insert(activityEvents).values({
      organizationId: session.user.organizationId,
      businessUnitId: row.primaryBusinessUnitId || null,
      contactId: row.id,
      eventType: 'contact.archived',
      message: `Archived contact: ${archiveReason}`,
      metadataJson: {
        reason: archiveReason,
        contactName: row.name,
      },
      actorUserId: session.user.id,
      occurredAt: archivedAt,
    });

    return row;
  });

  if (!archived) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id, archived: true });
}
