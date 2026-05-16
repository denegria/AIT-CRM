import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { activityEvents, businessUnits, contacts, leads, notes } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { workflowFromLead } from '@/lib/sales-workflow';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toContactPayload(row, lead = null, noteRows = []) {
  const workflow = workflowFromLead(lead);
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
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

function businessUnitError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function businessUnitErrorResponse(error) {
  if (!error?.status) throw error;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

function canAccessContact(session, contact) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    !contact.primaryBusinessUnitId ||
    session.user.businessUnitIds.includes(contact.primaryBusinessUnitId)
  );
}

async function resolveBusinessUnitId(db, session, requestedId) {
  if (requestedId) {
    if (!isUuid(requestedId)) {
      throw businessUnitError('A valid business unit id is required.');
    }

    const [row] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, requestedId), eq(businessUnits.organizationId, session.user.organizationId)))
      .limit(1);

    if (!row) {
      throw businessUnitError('Business unit not found.');
    }
    if (session.user.canAccessAllBusinessUnits || session.user.businessUnitIds.includes(requestedId)) {
      return row.id;
    }
    throw businessUnitError('Insufficient business-unit access.', 403);
  }

  if (!session.user.canAccessAllBusinessUnits && session.user.businessUnitIds.length) {
    return session.user.businessUnitIds[0];
  }

  const [row] = await db
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, session.user.organizationId))
    .orderBy(businessUnits.name)
    .limit(1);
  return row?.id || null;
}

async function resolveOptionalBusinessUnitId(db, session, requestedId) {
  if (!requestedId) return null;
  return resolveBusinessUnitId(db, session, requestedId);
}

async function resolveContactBusinessUnitForCreate(db, session, body) {
  const requestedId = requestedBusinessUnitId(body);
  if (!requestedId && hasBusinessUnitRequest(body) && session.user.canAccessAllBusinessUnits) return null;
  return resolveBusinessUnitId(db, session, requestedId);
}

async function latestLeadForContact(db, contactId) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.contactId, contactId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
}

async function notesForContact(db, session, contactId) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.contactId, contactId), eq(notes.organizationId, session.user.organizationId)))
    .orderBy(desc(notes.createdAt));
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
    return businessUnitErrorResponse(error);
  }
  const [contact] = await db.insert(contacts).values({
    organizationId: session.user.organizationId,
    primaryBusinessUnitId: businessUnitId,
    name,
    email: body.email || null,
    phone: body.phone || null,
    sourceLabel: body.source || null,
  }).returning();

  let lead = null;
  if (businessUnitId) {
    [lead] = await db.insert(leads).values({
      organizationId: session.user.organizationId,
      businessUnitId,
      contactId: contact.id,
      sourceType: 'manual',
      sourceName: body.source || 'Manual',
      status: body.status || 'New Lead',
      currentStage: body.status || 'New Lead',
      assignedUserId: isUuid(body.assignedTo) ? body.assignedTo : null,
    }).returning();
  }

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
  if ('source' in body) patch.sourceLabel = body.source || null;
  if ('businessUnitId' in body || 'primaryBusinessUnitId' in body) {
    const requestedId = requestedBusinessUnitId(body);
    if (!requestedId && !session.user.canAccessAllBusinessUnits && existing.primaryBusinessUnitId) {
      return NextResponse.json({ error: 'Only all-division users can unassign a contact.' }, { status: 403 });
    }
    try {
      patch.primaryBusinessUnitId = await resolveOptionalBusinessUnitId(db, session, requestedId);
    } catch (error) {
      return businessUnitErrorResponse(error);
    }
  }

  const [contact] = await db
    .update(contacts)
    .set(patch)
    .where(eq(contacts.id, id))
    .returning();

  let lead = await latestLeadForContact(db, id);
  if (lead && ('status' in body || 'source' in body || 'assignedTo' in body || 'businessUnitId' in body || 'primaryBusinessUnitId' in body)) {
    const leadPatch = { updatedAt: new Date() };
    if ('status' in body) {
      leadPatch.status = body.status || lead.status;
      leadPatch.currentStage = body.status || lead.currentStage;
    }
    if ('source' in body) leadPatch.sourceName = body.source || null;
    if ('assignedTo' in body) leadPatch.assignedUserId = isUuid(body.assignedTo) ? body.assignedTo : null;
    if (patch.primaryBusinessUnitId && ('businessUnitId' in body || 'primaryBusinessUnitId' in body)) {
      leadPatch.businessUnitId = patch.primaryBusinessUnitId || lead.businessUnitId;
    }
    [lead] = await db.update(leads).set(leadPatch).where(eq(leads.id, lead.id)).returning();
  }

  let noteRows = await notesForContact(db, session, id);
  if (Array.isArray(body.notes)) {
    const previousNoteCount = noteRows.length;
    const noteInputs = normalizeNoteInputs(body.notes);
    await db
      .delete(notes)
      .where(and(eq(notes.contactId, id), eq(notes.organizationId, session.user.organizationId)));

    noteRows = noteInputs.length
      ? await db.insert(notes).values(noteInputs.map((note) => ({
          organizationId: session.user.organizationId,
          businessUnitId: contact.primaryBusinessUnitId,
          contactId: id,
          body: note.body,
          authorUserId: session.user.id,
          createdAt: note.createdAt,
          updatedAt: note.createdAt,
        }))).returning()
      : [];

    if (noteRows.length > previousNoteCount) {
      await db.insert(activityEvents).values({
        organizationId: session.user.organizationId,
        businessUnitId: contact.primaryBusinessUnitId,
        contactId: id,
        leadId: lead?.id || null,
        eventType: 'contact.note_added',
        message: 'Added contact timeline note.',
        actorUserId: session.user.id,
        occurredAt: new Date(),
      });
    }
  }

  return NextResponse.json({ contact: toContactPayload(contact, lead, noteRows) });
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
