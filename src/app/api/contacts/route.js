import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { activityEvents, businessUnits, contacts, users } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessContact,
  resolveBusinessUnitId,
  resolveOptionalBusinessUnitId,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { validateManualContactIdentity } from '@/lib/crm/contact-input.js';
import {
  leadProfileForPayload,
  leadProfilePatchFromPayload,
  leadProfilePatchToDrizzleValues,
} from '@/lib/crm/lead-profile.js';
import { evaluateLifecycleTransition, requireLifecycleStatus } from '@/lib/crm/lifecycle.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createContactWithLead,
  latestLeadForContact,
  updateContactWithLeadAndNotes,
} from '@/lib/crm/write-helpers.js';
import { workflowFromLead } from '@/lib/sales-workflow';
import { summarizeContactTouch } from '@/lib/contact-touch.js';

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

function toContactPayload(row, lead = null, noteRows = [], businessUnit = null, activityEventRows = []) {
  const workflow = workflowFromLead(lead, { businessUnit });
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

async function resolveAssignableUserId(db, session, value, fieldName = 'assignedTo') {
  const id = String(value || '').trim();
  if (!id) return null;
  if (!isUuid(id)) throw createCrmError(`${fieldName} must be a valid user id.`);

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

function normalizeNoteInputs(rawNotes) {
  if (!Array.isArray(rawNotes)) return [];
  return rawNotes
    .map((note) => ({
      body: String(note?.text || note?.body || '').trim(),
      createdAt: parseNoteDate(note?.createdAt || note?.timestamp || note?.date),
    }))
    .filter((note) => note.body);
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
  let assignedUserId = null;
  try {
    assignedUserId = await resolveAssignableUserId(db, session, body.assignedTo);
  } catch (error) {
    return crmErrorResponse(error);
  }
  let status;
  const businessUnit = await loadBusinessUnitForWorkflow(db, session, businessUnitId);
  try {
    status = requireLifecycleStatus(body.status || 'New Lead', { businessUnit });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { contact, lead } = await createContactWithLead({
    db,
    organizationId: session.user.organizationId,
    contactValues: {
      primaryBusinessUnitId: businessUnitId,
      name,
      email: body.email || null,
      phone: body.phone || null,
      address: body.address || null,
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
  });

  return NextResponse.json({ contact: toContactPayload(contact, lead, [], businessUnit) }, { status: 201 });
}

export async function PATCH(request) {
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

  const patch = { updatedAt: new Date() };
  if ('name' in body) patch.name = String(body.name || '').trim() || existing.name;
  if ('email' in body) patch.email = body.email || null;
  if ('phone' in body) patch.phone = body.phone || null;
  if ('address' in body) patch.address = body.address || null;
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

  let lead = await latestLeadForContact(db, session.user.organizationId, id);
  const statusBusinessUnitId = hasBusinessUnitPatch && patch.primaryBusinessUnitId
    ? patch.primaryBusinessUnitId
    : lead?.businessUnitId || existing.primaryBusinessUnitId;
  const statusBusinessUnit = await loadBusinessUnitForWorkflow(db, session, statusBusinessUnitId);
  if (hasBusinessUnitPatch && patch.primaryBusinessUnitId === null && lead) {
    return NextResponse.json(
      { error: 'Contacts with leads must stay assigned to a business unit.' },
      { status: 400 },
    );
  }
  if ('status' in body && !lead) {
    return NextResponse.json(
      { error: 'Contact has no lead lifecycle status to update.' },
      { status: 400 },
    );
  }

  const leadProfilePatch = leadProfilePatchFromPayload(body, { allowClear: true });
  const hasLeadProfilePatch = Object.keys(leadProfilePatch).length > 0 ||
    (body.leadProfile && typeof body.leadProfile === 'object');
  const hasLeadPatch = 'status' in body || 'source' in body || 'assignedTo' in body || hasBusinessUnitPatch || hasLeadProfilePatch;
  let leadPatch = null;
  let leadStatusChange = null;
  if (lead && hasLeadPatch) {
    leadPatch = { updatedAt: new Date() };
    if ('status' in body) {
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
    if ('source' in body) leadPatch.sourceName = body.source || null;
    if ('assignedTo' in body) {
      try {
        leadPatch.assignedUserId = await resolveAssignableUserId(db, session, body.assignedTo);
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
  }

  let result;
  try {
    result = await updateContactWithLeadAndNotes({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      contactId: id,
      contactPatch: patch,
      existingLead: lead,
      leadPatch,
      leadStatusChange,
      replaceNotes: Array.isArray(body.notes)
        ? { noteInputs: normalizeNoteInputs(body.notes) }
        : null,
      addFollowUpNote: normalizeFollowUpNoteInput(body.followUpNote),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Contact update failed.' }, { status: 500 });
  }

  const resultBusinessUnit = await loadBusinessUnitForWorkflow(
    db,
    session,
    result.contact.primaryBusinessUnitId || result.lead?.businessUnitId,
  );
  return NextResponse.json({
    contact: toContactPayload(
      result.contact,
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

  const archiveReason = String(body.reason || body.archiveReason || 'Archived by employee request.').trim()
    || 'Archived by employee request.';
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
