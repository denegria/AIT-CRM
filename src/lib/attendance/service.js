import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  activityEvents,
  attendanceRecords,
  businessUnits,
  classSessions,
  contactCourseRecords,
  contacts,
  courseClassSections,
} from '../../db/schema.js';
import { createCrmError } from '../crm/errors.js';
import { canonicalScheduleDays } from '../schedule-days.js';
import {
  assertScheduledSessionDate,
  attendanceSnapshotsEqual,
  canManageSubmittedAttendance,
  canLinkAttendanceContacts,
  deriveAttendanceState,
  isAitUsaBusinessUnit,
  normalizeAttendanceMarks,
  normalizeExpectedRevision,
  normalizeSessionNote,
  parseSessionDate,
  scheduledDatesForWeek,
  todayInAttendanceTimeZone,
  weekBounds,
  weekdayForSessionDate,
} from './policy.js';

function canAccessBusinessUnit(session, businessUnitId) {
  return Boolean(
    session?.user?.canAccessAllBusinessUnits
    || session?.user?.businessUnitIds?.includes(businessUnitId),
  );
}

function runTransaction(db, transactionRunner, work) {
  return transactionRunner ? transactionRunner(work) : db.transaction(work);
}

function serializeSession(session, markCount = 0) {
  if (!session) return null;
  return {
    id: session.id,
    date: session.sessionDate,
    startTime: session.scheduledStartTime || '',
    endTime: session.scheduledEndTime || '',
    status: session.status,
    attendanceState: deriveAttendanceState(session, markCount),
    revision: session.revision,
    note: session.sessionNote || '',
    submittedAt: session.submittedAt || null,
    submittedByUserId: session.submittedByUserId || null,
  };
}

async function loadSession(tx, sectionId, sessionDate, { lock = false } = {}) {
  let query = tx
    .select()
    .from(classSessions)
    .where(and(
      eq(classSessions.classSectionId, sectionId),
      eq(classSessions.sessionDate, sessionDate),
    ))
    .limit(1);
  if (lock) query = query.for('update');
  const [session] = await query;
  return session || null;
}

async function loadMarks(tx, sessionId) {
  return tx
    .select({
      id: attendanceRecords.id,
      enrollmentId: attendanceRecords.enrollmentId,
      status: attendanceRecords.status,
      note: attendanceRecords.note,
    })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.classSessionId, sessionId))
    .orderBy(asc(attendanceRecords.enrollmentId));
}

async function insertActivity(tx, {
  section,
  actorUserId,
  contactId = null,
  eventType,
  message,
  metadata,
}) {
  await tx.insert(activityEvents).values({
    organizationId: section.organizationId,
    businessUnitId: section.businessUnitId,
    contactId,
    eventType,
    message,
    metadataJson: metadata,
    actorUserId,
    occurredAt: new Date(),
  });
}

async function ensureSession(tx, { section, sessionDate, expectedRevision, initialNote = null }) {
  let session = await loadSession(tx, section.id, sessionDate, { lock: true });
  if (session) return { session, created: false };
  if (expectedRevision !== 0) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);

  const [created] = await tx
    .insert(classSessions)
    .values({
      organizationId: section.organizationId,
      businessUnitId: section.businessUnitId,
      classSectionId: section.id,
      sessionDate,
      scheduledStartTime: section.startTime || null,
      scheduledEndTime: section.endTime || null,
      sessionNote: initialNote,
    })
    .onConflictDoNothing({ target: [classSessions.classSectionId, classSessions.sessionDate] })
    .returning();
  session = created || await loadSession(tx, section.id, sessionDate, { lock: true });
  if (!created && session) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
  return { session, created: true };
}

export async function resolveAttendanceSection({ db, session, sectionId }) {
  const [row] = await db
    .select({
      id: courseClassSections.id,
      organizationId: courseClassSections.organizationId,
      businessUnitId: courseClassSections.businessUnitId,
      businessUnitName: businessUnits.name,
      sectionKey: courseClassSections.sectionKey,
      courseName: courseClassSections.courseName,
      teacher: courseClassSections.teacher,
      courseLocation: courseClassSections.courseLocation,
      modality: courseClassSections.modality,
      scheduleDaysJson: courseClassSections.scheduleDaysJson,
      startTime: courseClassSections.startTime,
      endTime: courseClassSections.endTime,
      status: courseClassSections.status,
    })
    .from(courseClassSections)
    .innerJoin(businessUnits, eq(businessUnits.id, courseClassSections.businessUnitId))
    .where(and(
      eq(courseClassSections.id, sectionId),
      eq(courseClassSections.organizationId, session.user.organizationId),
    ))
    .limit(1);
  if (!row) throw createCrmError('Class section not found.', 404);
  if (!isAitUsaBusinessUnit(row.businessUnitName)) throw createCrmError('Attendance is only available for AIT USA classes.', 403);
  if (!canAccessBusinessUnit(session, row.businessUnitId)) throw createCrmError('You cannot access this class section.', 403);
  if (row.status !== 'active') throw createCrmError('Attendance is only available for active class sections.', 409);
  return row;
}

export async function listEligibleRoster({ db, section, sessionDate }) {
  parseSessionDate(sessionDate);
  return db
    .select({
      enrollmentId: contactCourseRecords.id,
      contactId: contactCourseRecords.contactId,
      name: contacts.name,
      startDate: contactCourseRecords.startDate,
      endDate: contactCourseRecords.endDate,
      status: contactCourseRecords.status,
    })
    .from(contactCourseRecords)
    .innerJoin(contacts, eq(contacts.id, contactCourseRecords.contactId))
    .where(and(
      eq(contactCourseRecords.organizationId, section.organizationId),
      eq(contactCourseRecords.businessUnitId, section.businessUnitId),
      eq(contactCourseRecords.classSectionId, section.id),
      eq(contactCourseRecords.status, 'active'),
      or(isNull(contactCourseRecords.startDate), lte(contactCourseRecords.startDate, sessionDate)),
      or(isNull(contactCourseRecords.endDate), gte(contactCourseRecords.endDate, sessionDate)),
    ))
    .orderBy(asc(contacts.name), asc(contactCourseRecords.id));
}

async function listSessionRoster({ db, section, sessionDate, sessionId = null }) {
  const eligible = await listEligibleRoster({ db, section, sessionDate });
  if (!sessionId) return eligible;
  const persisted = await db
    .select({
      enrollmentId: contactCourseRecords.id,
      contactId: contactCourseRecords.contactId,
      name: contacts.name,
      startDate: contactCourseRecords.startDate,
      endDate: contactCourseRecords.endDate,
      status: contactCourseRecords.status,
    })
    .from(attendanceRecords)
    .innerJoin(contactCourseRecords, eq(contactCourseRecords.id, attendanceRecords.enrollmentId))
    .innerJoin(contacts, eq(contacts.id, contactCourseRecords.contactId))
    .where(eq(attendanceRecords.classSessionId, sessionId));
  const byEnrollment = new Map(eligible.map((row) => [row.enrollmentId, row]));
  for (const row of persisted) byEnrollment.set(row.enrollmentId, row);
  return [...byEnrollment.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.enrollmentId.localeCompare(right.enrollmentId)
  ));
}

async function assertPersistedOrScheduledDate(db, section, sessionDate) {
  parseSessionDate(sessionDate);
  const persisted = await loadSession(db, section.id, sessionDate);
  if (!persisted) assertScheduledSessionDate(section, sessionDate);
}

export async function listAttendanceClasses({ db, session, date = todayInAttendanceTimeZone() }) {
  const weekday = weekdayForSessionDate(date);
  const rows = await db
    .select({
      id: courseClassSections.id,
      organizationId: courseClassSections.organizationId,
      businessUnitId: courseClassSections.businessUnitId,
      businessUnitName: businessUnits.name,
      courseName: courseClassSections.courseName,
      teacher: courseClassSections.teacher,
      courseLocation: courseClassSections.courseLocation,
      modality: courseClassSections.modality,
      scheduleDaysJson: courseClassSections.scheduleDaysJson,
      startTime: courseClassSections.startTime,
      endTime: courseClassSections.endTime,
    })
    .from(courseClassSections)
    .innerJoin(businessUnits, eq(businessUnits.id, courseClassSections.businessUnitId))
    .where(and(
      eq(courseClassSections.organizationId, session.user.organizationId),
      eq(courseClassSections.status, 'active'),
    ))
    .orderBy(asc(courseClassSections.startTime), asc(courseClassSections.courseName));

  const sections = rows.filter((row) => (
    isAitUsaBusinessUnit(row.businessUnitName)
    && canAccessBusinessUnit(session, row.businessUnitId)
    && canonicalScheduleDays(row.scheduleDaysJson).includes(weekday)
  ));
  if (!sections.length) return { date, classes: [] };

  const sectionIds = sections.map((row) => row.id);
  const [enrollments, sessions] = await Promise.all([
    db.select({ classSectionId: contactCourseRecords.classSectionId })
      .from(contactCourseRecords)
      .where(and(
        inArray(contactCourseRecords.classSectionId, sectionIds),
        eq(contactCourseRecords.status, 'active'),
        or(isNull(contactCourseRecords.startDate), lte(contactCourseRecords.startDate, date)),
        or(isNull(contactCourseRecords.endDate), gte(contactCourseRecords.endDate, date)),
      )),
    db.select().from(classSessions).where(and(
      inArray(classSessions.classSectionId, sectionIds),
      eq(classSessions.sessionDate, date),
    )),
  ]);
  const enrollmentCounts = enrollments.reduce((counts, row) => {
    counts.set(row.classSectionId, (counts.get(row.classSectionId) || 0) + 1);
    return counts;
  }, new Map());
  const sessionBySection = new Map(sessions.map((row) => [row.classSectionId, row]));
  const sessionIds = sessions.map((row) => row.id);
  const marks = sessionIds.length
    ? await db.select({ classSessionId: attendanceRecords.classSessionId }).from(attendanceRecords)
      .where(inArray(attendanceRecords.classSessionId, sessionIds))
    : [];
  const markCounts = marks.reduce((counts, row) => {
    counts.set(row.classSessionId, (counts.get(row.classSessionId) || 0) + 1);
    return counts;
  }, new Map());

  return {
    date,
    classes: sections.map((section) => {
      const classSession = sessionBySection.get(section.id);
      return {
        id: section.id,
        courseName: section.courseName,
        teacher: section.teacher || '',
        location: section.courseLocation || '',
        modality: section.modality,
        startTime: section.startTime || '',
        endTime: section.endTime || '',
        studentCount: enrollmentCounts.get(section.id) || 0,
        attendanceState: classSession
          ? deriveAttendanceState(classSession, markCounts.get(classSession.id) || 0)
          : 'not_started',
      };
    }),
  };
}

export async function getAttendanceWorkspace({ db, session, sectionId, weekOf, selectedDate }) {
  const section = await resolveAttendanceSection({ db, session, sectionId });
  const anchorDate = weekOf || todayInAttendanceTimeZone();
  parseSessionDate(anchorDate);
  const { start, end } = weekBounds(anchorDate);
  const scheduledDates = scheduledDatesForWeek(section.scheduleDaysJson, anchorDate);
  const persistedSessions = await db.select().from(classSessions).where(and(
    eq(classSessions.classSectionId, section.id),
    between(classSessions.sessionDate, start, end),
  )).orderBy(asc(classSessions.sessionDate));
  const allSessionDates = [...new Set([
    ...scheduledDates,
    ...persistedSessions.map((row) => row.sessionDate),
  ])].sort();
  const requestedDate = selectedDate || todayInAttendanceTimeZone();
  const effectiveDate = allSessionDates.includes(requestedDate) ? requestedDate : (allSessionDates[0] || requestedDate);
  const selectedPersistedSession = persistedSessions.find((row) => row.sessionDate === effectiveDate) || null;
  const roster = await listSessionRoster({
    db,
    section,
    sessionDate: effectiveDate,
    sessionId: selectedPersistedSession?.id || null,
  });
  const persistedByDate = new Map(persistedSessions.map((row) => [row.sessionDate, row]));
  const persistedIds = persistedSessions.map((row) => row.id);
  const marks = persistedIds.length
    ? await db.select().from(attendanceRecords)
      .where(inArray(attendanceRecords.classSessionId, persistedIds))
      .orderBy(asc(attendanceRecords.enrollmentId))
    : [];
  const marksBySession = marks.reduce((map, row) => {
    const rows = map.get(row.classSessionId) || [];
    rows.push(row);
    map.set(row.classSessionId, rows);
    return map;
  }, new Map());
  const selectedSession = persistedByDate.get(effectiveDate) || null;
  const exposeContactLinks = canLinkAttendanceContacts(session.user);

  return {
    class: {
      id: section.id,
      courseName: section.courseName,
      teacher: section.teacher || '',
      location: section.courseLocation || '',
      modality: section.modality,
      scheduleDays: canonicalScheduleDays(section.scheduleDaysJson),
      startTime: section.startTime || '',
      endTime: section.endTime || '',
    },
    week: { start, end },
    selectedDate: effectiveDate,
    sessions: allSessionDates.map((date) => {
      const persisted = persistedByDate.get(date);
      return persisted
        ? serializeSession(persisted, marksBySession.get(persisted.id)?.length || 0)
        : {
          id: null,
          date,
          startTime: section.startTime || '',
          endTime: section.endTime || '',
          status: 'open',
          attendanceState: 'not_started',
          revision: 0,
          note: '',
          submittedAt: null,
          submittedByUserId: null,
        };
    }),
    roster: roster.map((row) => ({
      enrollmentId: row.enrollmentId,
      ...(exposeContactLinks ? { contactId: row.contactId } : {}),
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      mark: selectedSession
        ? (() => {
          const mark = marksBySession.get(selectedSession.id)?.find((candidate) => candidate.enrollmentId === row.enrollmentId);
          return mark ? { status: mark.status, note: mark.note || '' } : null;
        })()
        : null,
    })),
    canLinkContacts: exposeContactLinks,
    capabilities: {
      canEditOpenAttendance: true,
      canReopenSubmittedAttendance: canManageSubmittedAttendance(session.user),
    },
  };
}

export async function saveSessionNote({ db, section, sessionDate, expectedRevision, note, transactionRunner }) {
  const revision = normalizeExpectedRevision(expectedRevision);
  const normalizedNote = normalizeSessionNote(note);
  await assertPersistedOrScheduledDate(db, section, sessionDate);
  return runTransaction(db, transactionRunner, async (tx) => {
    const { session, created } = await ensureSession(tx, {
      section,
      sessionDate,
      expectedRevision: revision,
      initialNote: normalizedNote,
    });
    if (created) return serializeSession(session, 0);
    if (session.sessionNote === normalizedNote) {
      const marks = await loadMarks(tx, session.id);
      return serializeSession(session, marks.length);
    }
    if (session.status === 'submitted') throw createCrmError('Submitted attendance must be reopened before editing.', 409);
    if (session.revision !== revision) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    const [updated] = await tx.update(classSessions).set({
      sessionNote: normalizedNote,
      revision: sql`${classSessions.revision} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(classSessions.id, session.id), eq(classSessions.revision, revision))).returning();
    if (!updated) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    const marks = await loadMarks(tx, session.id);
    return serializeSession(updated, marks.length);
  });
}

async function latestReopenReason(tx, sessionId) {
  const [event] = await tx.select({ metadata: activityEvents.metadataJson })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.eventType, 'attendance.session_reopened'),
      sql`${activityEvents.metadataJson}->>'sessionId' = ${sessionId}`,
    ))
    .orderBy(desc(activityEvents.createdAt))
    .limit(1);
  return String(event?.metadata?.reason || '').trim();
}

function attendanceDiff(previous, next) {
  const previousByEnrollment = new Map(previous.map((mark) => [mark.enrollmentId, mark]));
  const nextByEnrollment = new Map(next.map((mark) => [mark.enrollmentId, mark]));
  return [...new Set([...previousByEnrollment.keys(), ...nextByEnrollment.keys()])].flatMap((enrollmentId) => {
    const before = previousByEnrollment.get(enrollmentId) || null;
    const after = nextByEnrollment.get(enrollmentId) || null;
    if (before?.status === after?.status && (before?.note || null) === (after?.note || null)) return [];
    return [{ enrollmentId, before, after }];
  });
}

export async function saveAttendanceSnapshot({
  db,
  section,
  sessionDate,
  actorUserId,
  expectedRevision,
  marks,
  transactionRunner,
}) {
  const revision = normalizeExpectedRevision(expectedRevision);
  const normalizedMarks = normalizeAttendanceMarks(marks);
  await assertPersistedOrScheduledDate(db, section, sessionDate);

  return runTransaction(db, transactionRunner, async (tx) => {
    const { session, created } = await ensureSession(tx, { section, sessionDate, expectedRevision: revision });
    const previousMarks = await loadMarks(tx, session.id);
    const roster = await listSessionRoster({ db: tx, section, sessionDate, sessionId: session.id });
    const rosterByEnrollment = new Map(roster.map((row) => [row.enrollmentId, row]));
    const invalid = normalizedMarks.find((mark) => !rosterByEnrollment.has(mark.enrollmentId));
    if (invalid) throw createCrmError('Attendance can only be marked for students enrolled on this session date.', 400);
    if (attendanceSnapshotsEqual(previousMarks, normalizedMarks)) return serializeSession(session, previousMarks.length);
    if (session.status === 'submitted') throw createCrmError('Submitted attendance must be reopened before editing.', 409);
    if (!created && session.revision !== revision) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);

    const correctionReason = await latestReopenReason(tx, session.id);
    const changes = attendanceDiff(previousMarks, normalizedMarks);
    await tx.delete(attendanceRecords).where(eq(attendanceRecords.classSessionId, session.id));
    if (normalizedMarks.length) {
      await tx.insert(attendanceRecords).values(normalizedMarks.map((mark) => ({
        organizationId: section.organizationId,
        businessUnitId: section.businessUnitId,
        classSessionId: session.id,
        classSectionId: section.id,
        enrollmentId: mark.enrollmentId,
        status: mark.status,
        note: mark.note,
        markedByUserId: actorUserId,
      })));
    }
    let updated = session;
    if (!created) {
      [updated] = await tx.update(classSessions).set({
        revision: sql`${classSessions.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(classSessions.id, session.id), eq(classSessions.revision, revision))).returning();
      if (!updated) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    }

    if (correctionReason) {
      for (const change of changes) {
        const enrollment = rosterByEnrollment.get(change.enrollmentId);
        await insertActivity(tx, {
          section,
          actorUserId,
          contactId: enrollment?.contactId || null,
          eventType: 'attendance.mark_corrected',
          message: `Attendance corrected for ${sessionDate}.`,
          metadata: {
            sessionId: session.id,
            sectionId: section.id,
            sessionDate,
            enrollmentId: change.enrollmentId,
            before: change.before ? { status: change.before.status, note: change.before.note || null } : null,
            after: change.after ? { status: change.after.status, note: change.after.note || null } : null,
            reason: correctionReason,
          },
        });
      }
    }
    return serializeSession(updated, normalizedMarks.length);
  });
}

export async function submitAttendanceSession({
  db,
  section,
  sessionDate,
  actorUserId,
  expectedRevision,
  transactionRunner,
}) {
  const revision = normalizeExpectedRevision(expectedRevision);
  await assertPersistedOrScheduledDate(db, section, sessionDate);
  return runTransaction(db, transactionRunner, async (tx) => {
    const session = await loadSession(tx, section.id, sessionDate, { lock: true });
    if (!session) throw createCrmError('Mark every student before submitting attendance.', 409);
    const marks = await loadMarks(tx, session.id);
    const roster = await listSessionRoster({ db: tx, section, sessionDate, sessionId: session.id });
    if (!roster.length) throw createCrmError('This session has no eligible students to submit.', 409);
    if (session.status === 'submitted') return serializeSession(session, marks.length);
    if (session.revision !== revision) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    if (marks.length !== roster.length) throw createCrmError('Mark every student present or absent before submitting.', 409);
    const rosterIds = new Set(roster.map((row) => row.enrollmentId));
    if (marks.some((mark) => !rosterIds.has(mark.enrollmentId))) {
      throw createCrmError('The roster changed. Refresh attendance before submitting.', 409);
    }
    const submittedAt = new Date();
    const [updated] = await tx.update(classSessions).set({
      status: 'submitted',
      submittedByUserId: actorUserId,
      submittedAt,
      revision: sql`${classSessions.revision} + 1`,
      updatedAt: submittedAt,
    }).where(and(
      eq(classSessions.id, session.id),
      eq(classSessions.revision, revision),
      eq(classSessions.status, 'open'),
    )).returning();
    if (!updated) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    const presentCount = marks.filter((mark) => mark.status === 'present').length;
    await insertActivity(tx, {
      section,
      actorUserId,
      eventType: 'attendance.session_submitted',
      message: `Attendance submitted for ${section.courseName} on ${sessionDate}.`,
      metadata: {
        sessionId: session.id,
        sectionId: section.id,
        sessionDate,
        presentCount,
        absentCount: marks.length - presentCount,
      },
    });
    return serializeSession(updated, marks.length);
  });
}

export async function reopenAttendanceSession({
  db,
  section,
  sessionDate,
  actorUserId,
  expectedRevision,
  reason,
  transactionRunner,
}) {
  const revision = normalizeExpectedRevision(expectedRevision);
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) throw createCrmError('A reason is required to reopen submitted attendance.', 400);
  if (normalizedReason.length > 1000) throw createCrmError('Reopen reason cannot exceed 1,000 characters.', 400);
  await assertPersistedOrScheduledDate(db, section, sessionDate);
  return runTransaction(db, transactionRunner, async (tx) => {
    const session = await loadSession(tx, section.id, sessionDate, { lock: true });
    if (!session) throw createCrmError('Attendance session not found.', 404);
    if (session.status === 'open') {
      const latestReason = await latestReopenReason(tx, session.id);
      if (latestReason === normalizedReason) {
        const marks = await loadMarks(tx, session.id);
        return serializeSession(session, marks.length);
      }
      throw createCrmError('Attendance is already open.', 409);
    }
    if (session.revision !== revision) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    const [updated] = await tx.update(classSessions).set({
      status: 'open',
      submittedByUserId: null,
      submittedAt: null,
      revision: sql`${classSessions.revision} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(classSessions.id, session.id),
      eq(classSessions.revision, revision),
      eq(classSessions.status, 'submitted'),
    )).returning();
    if (!updated) throw createCrmError('Attendance changed in another tab. Refresh and try again.', 409);
    await insertActivity(tx, {
      section,
      actorUserId,
      eventType: 'attendance.session_reopened',
      message: `Attendance reopened for ${section.courseName} on ${sessionDate}.`,
      metadata: { sessionId: session.id, sectionId: section.id, sessionDate, reason: normalizedReason },
    });
    const marks = await loadMarks(tx, session.id);
    return serializeSession(updated, marks.length);
  });
}
