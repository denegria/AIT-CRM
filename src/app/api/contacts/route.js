import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, contacts, users } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessContact,
  resolveBusinessUnitId,
  resolveOptionalBusinessUnitId,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { evaluateLifecycleTransition, requireLifecycleStatus } from '@/lib/crm/lifecycle.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createContactWithLead,
  latestLeadForContact,
  updateContactWithLeadAndNotes,
} from '@/lib/crm/write-helpers.js';
import { workflowFromLead } from '@/lib/sales-workflow';

function toContactPayload(row, lead = null, noteRows = []) {
  const workflow = workflowFromLead(lead);
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    address: row.address || '',
    businessUnitId: row.primaryBusinessUnitId || '',
    primaryBusinessUnitId: row.primaryBusinessUnitId || '',
    status: workflow.status,
    currentStage: workflow.currentStage,
    tags: workflow.tags,
    nextAction: workflow.nextAction,
    priority: workflow.priority,
    outreachState: workflow.outreachState,
    needsFirstOutreach: workflow.needsFirstOutreach,
    source: lead?.sourceName || row.sourceLabel || '',
    assignedTo: lead?.assignedUserId || '',
    lastContact: row.updatedAt?.toISOString?.().slice(0, 10) || row.createdAt?.toISOString?.().slice(0, 10) || '',
    notes: noteRows.map((note) => ({
      id: note.id,
      text: note.body,
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
      createdAt: parseNoteDate(note?.date || note?.createdAt),
    }))
    .filter((note) => note.body);
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Contact name is required.' }, { status: 400 });
  }

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
  try {
    status = requireLifecycleStatus(body.status || 'New Lead');
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
    } : null,
  });

  return NextResponse.json({ contact: toContactPayload(contact, lead) }, { status: 201 });
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

  const hasLeadPatch = 'status' in body || 'source' in body || 'assignedTo' in body || hasBusinessUnitPatch;
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
          canReopenClosedStatus: session.user.canAccessAllBusinessUnits,
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
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Contact update failed.' }, { status: 500 });
  }

  return NextResponse.json({ contact: toContactPayload(result.contact, result.lead, result.noteRows) });
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

  const deleted = await db
    .delete(contacts)
    .where(eq(contacts.id, id))
    .returning({ id: contacts.id });

  if (!deleted.length) {
    return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
