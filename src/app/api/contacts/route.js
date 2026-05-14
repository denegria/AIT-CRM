import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, contacts, leads } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function toContactPayload(row, lead = null) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    businessUnitId: row.primaryBusinessUnitId || '',
    primaryBusinessUnitId: row.primaryBusinessUnitId || '',
    status: lead?.status || 'New Lead',
    source: lead?.sourceName || row.sourceLabel || '',
    assignedTo: lead?.assignedUserId || '',
    lastContact: row.updatedAt?.toISOString?.().slice(0, 10) || row.createdAt?.toISOString?.().slice(0, 10) || '',
    notes: [],
  };
}

function canAccessContact(session, contact) {
  return Boolean(
    session.user.canAccessAllBusinessUnits ||
    !contact.primaryBusinessUnitId ||
    session.user.businessUnitIds.includes(contact.primaryBusinessUnitId)
  );
}

async function resolveBusinessUnitId(db, session, requestedId) {
  if (requestedId && isUuid(requestedId)) {
    if (session.user.canAccessAllBusinessUnits || session.user.businessUnitIds.includes(requestedId)) {
      return requestedId;
    }
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

async function latestLeadForContact(db, contactId) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.contactId, contactId))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
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
  const businessUnitId = await resolveBusinessUnitId(db, session, body.businessUnitId || body.primaryBusinessUnitId);
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
    patch.primaryBusinessUnitId = await resolveOptionalBusinessUnitId(db, session, body.businessUnitId || body.primaryBusinessUnitId);
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

  return NextResponse.json({ contact: toContactPayload(contact, lead) });
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
