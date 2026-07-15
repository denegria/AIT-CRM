import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { contactCourseRecords, contacts } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { assertCanAccessContactLead, resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import {
  courseRecordInputFromPayload,
  courseRecordPayloadFromRow,
  courseRecordValuesFromInput,
  sortCourseRecords,
  validateCourseRecordInput,
} from '@/lib/crm/course-records.js';
import { isUuid } from '@/lib/crm/validation.js';
import { latestLeadForContact } from '@/lib/crm/write-helpers.js';

function cleanString(value) {
  return String(value || '').trim();
}

async function loadContactContext(db, session, contactId) {
  const contact = await resolveContactById({
    db,
    session,
    contactsTable: contacts,
    contactId,
  });
  const lead = await latestLeadForContact(db, session.user.organizationId, contact.id);
  assertCanAccessContactLead(session, lead, contact);
  return { contact, lead };
}

async function listCourseRecords(db, session, contactId) {
  const rows = await db
    .select()
    .from(contactCourseRecords)
    .where(and(
      eq(contactCourseRecords.organizationId, session.user.organizationId),
      eq(contactCourseRecords.contactId, contactId),
    ))
    .orderBy(desc(contactCourseRecords.startDate), desc(contactCourseRecords.createdAt));
  return sortCourseRecords(rows).map(courseRecordPayloadFromRow);
}

function businessUnitIdForRecord(session, contact, lead) {
  return lead?.businessUnitId ||
    contact.primaryBusinessUnitId ||
    session.user.primaryBusinessUnitId ||
    session.user.businessUnitIds?.[0] ||
    '';
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const { contact } = await loadContactContext(db, session, id);
    const courses = await listCourseRecords(db, session, contact.id);
    return NextResponse.json({ courses });
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

  try {
    const { contact, lead } = await loadContactContext(db, session, id);
    const businessUnitId = businessUnitIdForRecord(session, contact, lead);
    if (!businessUnitId) {
      return NextResponse.json({ error: 'Course records need a business unit.' }, { status: 400 });
    }

    const input = courseRecordInputFromPayload(body);
    input.status ||= 'active';
    const existingRecords = await listCourseRecords(db, session, contact.id);
    validateCourseRecordInput(input, { existingRecords });

    const courses = await db.transaction(async (tx) => {
      await tx.insert(contactCourseRecords).values(courseRecordValuesFromInput(input, {
        organizationId: session.user.organizationId,
        businessUnitId,
        contactId: contact.id,
        leadId: lead?.id || null,
        status: 'active',
      }));
      return listCourseRecords(tx, session, contact.id);
    });
    return NextResponse.json({ courses }, { status: 201 });
  } catch (err) {
    return err?.status
      ? crmErrorResponse(err)
      : NextResponse.json({ error: err.message || 'Course save failed.' }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const courseId = cleanString(body.id || body.courseId);
  if (!isUuid(courseId)) return NextResponse.json({ error: 'A valid course record id is required.' }, { status: 400 });

  const db = getDb();
  try {
    const { contact } = await loadContactContext(db, session, id);
    const [existing] = await db
      .select()
      .from(contactCourseRecords)
      .where(and(
        eq(contactCourseRecords.id, courseId),
        eq(contactCourseRecords.organizationId, session.user.organizationId),
        eq(contactCourseRecords.contactId, contact.id),
      ))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Course record not found.' }, { status: 404 });

    const input = courseRecordInputFromPayload(body, { allowClear: true });
    const existingRecords = await listCourseRecords(db, session, contact.id);
    validateCourseRecordInput({
      courseName: Object.prototype.hasOwnProperty.call(input, 'courseName') ? input.courseName : existing.courseName,
      status: Object.prototype.hasOwnProperty.call(input, 'status') ? input.status : existing.status,
      startDate: Object.prototype.hasOwnProperty.call(input, 'startDate') ? input.startDate : existing.startDate,
    }, {
      existingRecords,
      currentRecordId: existing.id,
    });

    const patch = courseRecordValuesFromInput(input, { updatedAt: new Date() });
    const courses = await db.transaction(async (tx) => {
      await tx
        .update(contactCourseRecords)
        .set(patch)
        .where(and(
          eq(contactCourseRecords.id, existing.id),
          eq(contactCourseRecords.organizationId, session.user.organizationId),
          eq(contactCourseRecords.contactId, contact.id),
        ));
      return listCourseRecords(tx, session, contact.id);
    });
    return NextResponse.json({ courses });
  } catch (err) {
    return err?.status
      ? crmErrorResponse(err)
      : NextResponse.json({ error: err.message || 'Course update failed.' }, { status: 400 });
  }
}
