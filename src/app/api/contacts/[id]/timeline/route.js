import { NextResponse } from 'next/server';
import { getDb } from '@/db/index.js';
import { contacts, notes } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { assertCanAccessContactLead, resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { latestLeadForContact } from '@/lib/crm/write-helpers.js';
import { listContactTimeline, normalizeTimelineType } from '@/lib/timeline/service.js';

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();
  const type = normalizeTimelineType(new URL(request.url).searchParams.get('type'));

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const timeline = await listContactTimeline({
      db,
      organizationId: session.user.organizationId,
      contactId: contact.id,
      businessUnitIds: session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
      type,
    });

    return NextResponse.json({ timeline });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const noteBody = String(body.note || body.body || body.text || '').trim();
  if (!noteBody) return NextResponse.json({ error: 'Note text is required.' }, { status: 400 });

  const db = getDb();
  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const lead = await latestLeadForContact(db, session.user.organizationId, contact.id);
    assertCanAccessContactLead(session, lead, contact);
    const [note] = await db
      .insert(notes)
      .values({
        organizationId: session.user.organizationId,
        businessUnitId: contact.primaryBusinessUnitId || null,
        contactId: contact.id,
        body: noteBody,
        authorUserId: session.user.id,
      })
      .returning({
        id: notes.id,
        body: notes.body,
        createdAt: notes.createdAt,
      });

    return NextResponse.json({
      note: {
        id: note.id,
        text: note.body,
        createdAt: note.createdAt,
      },
    }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
