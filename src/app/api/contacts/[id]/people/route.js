import { NextResponse } from 'next/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { contactPeople, contacts } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';

function cleanString(value) {
  return String(value || '').trim();
}

function toPersonPayload(row) {
  return {
    id: row.id,
    contactId: row.contactId,
    name: row.name,
    role: row.role || '',
    phone: row.phone || '',
    email: row.email || '',
    notes: row.notes || '',
    isPrimary: Boolean(row.isPrimary),
    sourceLabel: row.sourceLabel || '',
    sourceSheet: row.sourceSheet || '',
    sourceRow: row.sourceRow || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadContactOrThrow(db, session, contactId) {
  return resolveContactById({
    db,
    session,
    contactsTable: contacts,
    contactId,
  });
}

async function listPeople(db, session, contactId) {
  const rows = await db
    .select()
    .from(contactPeople)
    .where(and(
      eq(contactPeople.organizationId, session.user.organizationId),
      eq(contactPeople.contactId, contactId),
    ))
    .orderBy(desc(contactPeople.isPrimary), asc(contactPeople.name), asc(contactPeople.createdAt));
  return rows.map(toPersonPayload);
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const contact = await loadContactOrThrow(db, session, id);
    const people = await listPeople(db, session, contact.id);
    return NextResponse.json({ people });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const name = cleanString(body.name);
  if (!name) return NextResponse.json({ error: 'Person name is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await loadContactOrThrow(db, session, id);
    const people = await db.transaction(async (tx) => {
      if (body.isPrimary) {
        await tx
          .update(contactPeople)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(contactPeople.organizationId, session.user.organizationId),
            eq(contactPeople.contactId, contact.id),
          ));
      }
      await tx.insert(contactPeople).values({
        organizationId: session.user.organizationId,
        businessUnitId: contact.primaryBusinessUnitId || null,
        contactId: contact.id,
        name,
        role: cleanString(body.role) || null,
        phone: cleanString(body.phone) || null,
        email: cleanString(body.email) || null,
        notes: cleanString(body.notes) || null,
        isPrimary: Boolean(body.isPrimary),
        sourceLabel: cleanString(body.sourceLabel) || null,
        sourceSheet: cleanString(body.sourceSheet) || null,
        sourceRow: Number.isInteger(body.sourceRow) ? body.sourceRow : null,
        metadataJson: body.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : {},
      });
      return listPeople(tx, session, contact.id);
    });
    return NextResponse.json({ people }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const personId = cleanString(body.id);
  if (!isUuid(personId)) return NextResponse.json({ error: 'A valid person id is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await loadContactOrThrow(db, session, id);
    const people = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: contactPeople.id })
        .from(contactPeople)
        .where(and(
          eq(contactPeople.id, personId),
          eq(contactPeople.organizationId, session.user.organizationId),
          eq(contactPeople.contactId, contact.id),
        ))
        .limit(1);
      if (!existing) {
        return null;
      }
      if (body.isPrimary) {
        await tx
          .update(contactPeople)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(contactPeople.organizationId, session.user.organizationId),
            eq(contactPeople.contactId, contact.id),
          ));
      }
      const patch = { updatedAt: new Date() };
      if ('name' in body) {
        const name = cleanString(body.name);
        if (!name) throw new Error('Person name is required.');
        patch.name = name;
      }
      if ('role' in body) patch.role = cleanString(body.role) || null;
      if ('phone' in body) patch.phone = cleanString(body.phone) || null;
      if ('email' in body) patch.email = cleanString(body.email) || null;
      if ('notes' in body) patch.notes = cleanString(body.notes) || null;
      if ('isPrimary' in body) patch.isPrimary = Boolean(body.isPrimary);
      await tx
        .update(contactPeople)
        .set(patch)
        .where(and(
          eq(contactPeople.id, personId),
          eq(contactPeople.organizationId, session.user.organizationId),
          eq(contactPeople.contactId, contact.id),
        ));
      return listPeople(tx, session, contact.id);
    });
    if (!people) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    return NextResponse.json({ people });
  } catch (err) {
    return err.message === 'Person name is required.'
      ? NextResponse.json({ error: err.message }, { status: 400 })
      : crmErrorResponse(err);
  }
}

export async function DELETE(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const personId = cleanString(body.id);
  if (!isUuid(personId)) return NextResponse.json({ error: 'A valid person id is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await loadContactOrThrow(db, session, id);
    const people = await db.transaction(async (tx) => {
      await tx
        .delete(contactPeople)
        .where(and(
          eq(contactPeople.id, personId),
          eq(contactPeople.organizationId, session.user.organizationId),
          eq(contactPeople.contactId, contact.id),
        ));
      return listPeople(tx, session, contact.id);
    });
    return NextResponse.json({ people });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
