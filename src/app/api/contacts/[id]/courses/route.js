import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { contactCourseRecords, contacts, courseClassSections } from '@/db/schema.js';
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
import { classSectionPayload, listClassSections } from '@/lib/crm/class-sections.js';

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
    .select({ course: contactCourseRecords, classSection: courseClassSections })
    .from(contactCourseRecords)
    .leftJoin(courseClassSections, eq(contactCourseRecords.classSectionId, courseClassSections.id))
    .where(and(
      eq(contactCourseRecords.organizationId, session.user.organizationId),
      eq(contactCourseRecords.contactId, contactId),
    ))
    .orderBy(desc(contactCourseRecords.startDate), desc(contactCourseRecords.createdAt));
  return sortCourseRecords(rows.map(({ course, classSection }) => ({
    ...course,
    classSection: classSection ? classSectionPayload(classSection) : null,
  }))).map(courseRecordPayloadFromRow);
}

function businessUnitIdForRecord(session, contact, lead) {
  return lead?.businessUnitId ||
    contact.primaryBusinessUnitId ||
    session.user.primaryBusinessUnitId ||
    session.user.businessUnitIds?.[0] ||
    '';
}

async function loadClassSection(db, session, businessUnitId, classSectionId) {
  if (!classSectionId) return null;
  if (!isUuid(classSectionId)) {
    throw new Error('A valid class section is required.');
  }
  const [section] = await db
    .select()
    .from(courseClassSections)
    .where(and(
      eq(courseClassSections.id, classSectionId),
      eq(courseClassSections.organizationId, session.user.organizationId),
      eq(courseClassSections.businessUnitId, businessUnitId),
    ))
    .limit(1);
  if (!section) {
    const error = new Error('Class section not found in this business unit.');
    error.status = 404;
    throw error;
  }
  return section;
}

function applyClassSection(input, section) {
  if (!section) return input;
  return {
    ...input,
    classSectionId: section.id,
    courseName: section.courseName,
    courseLocation: section.courseLocation,
    teacher: section.teacher,
  };
}

async function courseResponseContext(db, session, contact, lead) {
  const businessUnitId = businessUnitIdForRecord(session, contact, lead);
  const [courses, classSections] = await Promise.all([
    listCourseRecords(db, session, contact.id),
    businessUnitId
      ? listClassSections({
          db,
          organizationId: session.user.organizationId,
          businessUnitId,
          includeInactive: true,
        })
      : [],
  ]);
  return { courses, classSections };
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const { contact, lead } = await loadContactContext(db, session, id);
    return NextResponse.json(await courseResponseContext(db, session, contact, lead));
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

    let input = courseRecordInputFromPayload(body);
    input.status ||= 'active';
    const section = await loadClassSection(db, session, businessUnitId, input.classSectionId);
    if (section?.status !== 'active' && input.status === 'active') {
      return NextResponse.json({ error: 'Inactive class sections cannot accept new active enrollments.' }, { status: 400 });
    }
    input = applyClassSection(input, section);
    const existingRecords = await listCourseRecords(db, session, contact.id);
    validateCourseRecordInput(input, { existingRecords });

    await db.transaction(async (tx) => {
      await tx.insert(contactCourseRecords).values(courseRecordValuesFromInput(input, {
        organizationId: session.user.organizationId,
        businessUnitId,
        contactId: contact.id,
        leadId: lead?.id || null,
        status: 'active',
      }));
    });
    return NextResponse.json(await courseResponseContext(db, session, contact, lead), { status: 201 });
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
    const { contact, lead } = await loadContactContext(db, session, id);
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

    let input = courseRecordInputFromPayload(body, { allowClear: true });
    const nextClassSectionId = Object.prototype.hasOwnProperty.call(input, 'classSectionId')
      ? input.classSectionId
      : existing.classSectionId;
    const section = await loadClassSection(db, session, existing.businessUnitId, nextClassSectionId);
    input = applyClassSection(input, section);
    const nextStatus = Object.prototype.hasOwnProperty.call(input, 'status') ? input.status : existing.status;
    if (section?.status !== 'active' && nextStatus === 'active' && section.id !== existing.classSectionId) {
      return NextResponse.json({ error: 'Inactive class sections cannot accept new active enrollments.' }, { status: 400 });
    }
    const existingRecords = await listCourseRecords(db, session, contact.id);
    validateCourseRecordInput({
      classSectionId: Object.prototype.hasOwnProperty.call(input, 'classSectionId') ? input.classSectionId : existing.classSectionId,
      courseName: Object.prototype.hasOwnProperty.call(input, 'courseName') ? input.courseName : existing.courseName,
      courseLocation: Object.prototype.hasOwnProperty.call(input, 'courseLocation') ? input.courseLocation : existing.courseLocation,
      teacher: Object.prototype.hasOwnProperty.call(input, 'teacher') ? input.teacher : existing.teacher,
      status: Object.prototype.hasOwnProperty.call(input, 'status') ? input.status : existing.status,
      startDate: Object.prototype.hasOwnProperty.call(input, 'startDate') ? input.startDate : existing.startDate,
    }, {
      existingRecords,
      currentRecordId: existing.id,
    });

    const patch = courseRecordValuesFromInput(input, { updatedAt: new Date() });
    await db.transaction(async (tx) => {
      await tx
        .update(contactCourseRecords)
        .set(patch)
        .where(and(
          eq(contactCourseRecords.id, existing.id),
          eq(contactCourseRecords.organizationId, session.user.organizationId),
          eq(contactCourseRecords.contactId, contact.id),
        ));
    });
    return NextResponse.json(await courseResponseContext(db, session, contact, lead));
  } catch (err) {
    return err?.status
      ? crmErrorResponse(err)
      : NextResponse.json({ error: err.message || 'Course update failed.' }, { status: 400 });
  }
}
