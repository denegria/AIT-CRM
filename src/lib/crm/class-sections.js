import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { classSectionVersions, classSessions, contactCourseRecords, courseClassSections } from '../../db/schema.js';
import { createCrmError } from './errors.js';
import { parseSessionDate, todayInAttendanceTimeZone } from '../attendance/policy.js';
import { canonicalAitUsaSchoolLocation } from '../school-locations.js';
import { CANONICAL_WEEKDAYS, canonicalWeekday } from '../schedule-days.js';

const MODALITIES = new Set(['in_person', 'online', 'hybrid']);
const STATUSES = new Set(['planned', 'active', 'inactive']);
export { CANONICAL_WEEKDAYS };

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanDays(value) {
  if (!Array.isArray(value)) return [];
  const days = value.map((day) => {
    const cleaned = cleanText(day);
    const canonical = canonicalWeekday(cleaned);
    if (!canonical) throw new Error(`Class section schedule day is not supported: ${cleaned || '(blank)'}.`);
    return canonical;
  });
  return [...new Set(days)];
}

function cleanTime(value) {
  const time = cleanText(value);
  if (!time) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Class section times must use 24-hour HH:MM format.');
  }
  return time;
}

export function classSectionInput(payload = {}) {
  const sectionKey = cleanText(payload.sectionKey);
  const courseName = cleanText(payload.courseName);
  if (!sectionKey) throw new Error('Class section key is required.');
  if (!courseName) throw new Error('Class section course is required.');
  const modality = cleanText(payload.modality || 'in_person').toLowerCase().replace(/[ -]+/g, '_');
  const status = cleanText(payload.status || 'active').toLowerCase();
  if (!MODALITIES.has(modality)) throw new Error('Class section modality is not supported.');
  if (!STATUSES.has(status)) throw new Error('Class section status is not supported.');
  const courseLocation = canonicalAitUsaSchoolLocation(payload.courseLocation) || cleanText(payload.courseLocation);
  const days = cleanDays(payload.scheduleDaysJson || payload.scheduleDays);
  const scheduledDaysPerWeek = payload.scheduledDaysPerWeek == null || payload.scheduledDaysPerWeek === ''
    ? (days.length || null)
    : Number(payload.scheduledDaysPerWeek);
  if (scheduledDaysPerWeek != null && (!Number.isInteger(scheduledDaysPerWeek) || scheduledDaysPerWeek < 1 || scheduledDaysPerWeek > 7)) {
    throw new Error('Scheduled days per week must be between 1 and 7.');
  }
  return {
    sectionKey,
    courseName,
    teacher: cleanText(payload.teacher) || null,
    courseLocation: courseLocation || null,
    modality,
    scheduleDaysJson: days,
    startTime: cleanTime(payload.startTime),
    endTime: cleanTime(payload.endTime),
    scheduledDaysPerWeek,
    status,
    sourceType: cleanText(payload.sourceType) || null,
    sourceReference: cleanText(payload.sourceReference) || null,
    metadataJson: cleanObject(payload.metadataJson),
  };
}

export function classSectionPayload(row = {}) {
  return {
    id: row.id || '',
    businessUnitId: row.businessUnitId || '',
    sectionKey: row.sectionKey || '',
    courseName: row.courseName || '',
    teacher: row.teacher || '',
    courseLocation: row.courseLocation || '',
    modality: row.modality || 'in_person',
    scheduleDays: Array.isArray(row.scheduleDaysJson) ? row.scheduleDaysJson : [],
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    scheduledDaysPerWeek: row.scheduledDaysPerWeek || null,
    status: row.status || 'active',
    sourceType: row.sourceType || '',
    sourceReference: row.sourceReference || '',
  };
}

export function classSectionLabel(section = {}) {
  const schedule = [
    ...(section.scheduleDays || section.scheduleDaysJson || []),
    [section.startTime, section.endTime].filter(Boolean).join('–'),
  ].filter(Boolean).join(' ');
  return [
    section.courseName,
    section.teacher,
    section.courseLocation,
    schedule,
    section.modality === 'online' ? 'Online' : '',
  ].filter(Boolean).join(' · ');
}

export function resolveSectionVersion(versions, date) {
  return [...versions].filter((row) => row.effectiveDate <= date)
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0] || null;
}

export async function loadSectionVersions(db, sectionIds) {
  if (!sectionIds.length) return new Map();
  const rows = await db.select().from(classSectionVersions)
    .where(inArray(classSectionVersions.classSectionId, sectionIds))
    .orderBy(asc(classSectionVersions.effectiveDate));
  const bySection = new Map(sectionIds.map((id) => [id, []]));
  for (const row of rows) bySection.get(row.classSectionId)?.push(row);
  return bySection;
}

export function sectionAtDate(section, versions, date) {
  const version = resolveSectionVersion(versions, date);
  return version ? { ...section, ...version, id: section.id, sectionKey: section.sectionKey } : null;
}

export async function listClassSections({ db, organizationId, businessUnitId, includeInactive = false, date = todayInAttendanceTimeZone() }) {
  parseSessionDate(date);
  const rows = await db.select().from(courseClassSections).where(and(
    eq(courseClassSections.organizationId, organizationId),
    eq(courseClassSections.businessUnitId, businessUnitId),
  )).orderBy(asc(courseClassSections.courseName), asc(courseClassSections.sectionKey));
  const versions = await loadSectionVersions(db, rows.map((row) => row.id));
  return rows.flatMap((row) => {
    const effective = sectionAtDate(row, versions.get(row.id) || [], date);
    return effective && (includeInactive || effective.status === 'active') ? [classSectionPayload(effective)] : [];
  });
}

const SNAPSHOT_FIELDS = ['courseName', 'teacher', 'courseLocation', 'modality', 'scheduleDaysJson',
  'startTime', 'endTime', 'scheduledDaysPerWeek', 'status'];

export function normalizeManagedSection(payload, { sectionKey = '' } = {}) {
  let input;
  try { input = classSectionInput({ ...payload, sectionKey: sectionKey || payload.sectionKey }); }
  catch (error) { throw createCrmError(error.message, 400); }
  if (!input.scheduleDaysJson.length) throw createCrmError('Choose at least one class day.', 400);
  if (!input.startTime || !input.endTime || input.startTime >= input.endTime) {
    throw createCrmError('Enter a valid start and end time in New York local time.', 400);
  }
  if (!canonicalAitUsaSchoolLocation(input.courseLocation)) {
    throw createCrmError('Choose a valid AIT USA class location.', 400);
  }
  if (input.scheduledDaysPerWeek !== input.scheduleDaysJson.length) {
    throw createCrmError('Scheduled days per week must match the selected days.', 400);
  }
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, input[field]]));
}

export function enrollmentSpansDate(enrollment, effectiveDate) {
  return enrollment.status === 'active'
    && (!enrollment.startDate || enrollment.startDate <= effectiveDate)
    && (!enrollment.endDate || enrollment.endDate >= effectiveDate);
}

export function assertNoPendingDeactivation(versions, enrollment, today = todayInAttendanceTimeZone()) {
  const next = [...versions].filter((row) => row.effectiveDate > today).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  for (const version of next) {
    if (version.status === 'inactive' && enrollmentSpansDate(enrollment, version.effectiveDate)) {
      throw createCrmError(`Enrollment would span the scheduled class deactivation on ${version.effectiveDate}. End or transition it first.`, 409);
    }
  }
}

export async function lockSectionForEnrollment(tx, { organizationId, businessUnitId, sectionId, enrollment }) {
  const [section] = await tx.select().from(courseClassSections).where(and(
    eq(courseClassSections.id, sectionId), eq(courseClassSections.organizationId, organizationId),
    eq(courseClassSections.businessUnitId, businessUnitId),
  )).limit(1).for('update');
  if (!section) throw createCrmError('Class section not found in this business unit.', 404);
  const versions = (await loadSectionVersions(tx, [section.id])).get(section.id) || [];
  const today = todayInAttendanceTimeZone();
  const current = sectionAtDate(section, versions, today);
  if (!current || current.status !== 'active') throw createCrmError('Class section is not active for enrollment today.', 409);
  assertNoPendingDeactivation(versions, enrollment, today);
  return current;
}

export async function listManagedSections({ db, organizationId, businessUnitId, canManage, today = todayInAttendanceTimeZone() }) {
  const rows = await db.select().from(courseClassSections).where(and(
    eq(courseClassSections.organizationId, organizationId), eq(courseClassSections.businessUnitId, businessUnitId),
  )).orderBy(asc(courseClassSections.courseName), asc(courseClassSections.sectionKey));
  const versions = await loadSectionVersions(db, rows.map((row) => row.id));
  const counts = rows.length ? await db.select({ classSectionId: contactCourseRecords.classSectionId,
    count: sql`count(*)::int` }).from(contactCourseRecords).where(and(
    inArray(contactCourseRecords.classSectionId, rows.map((row) => row.id)),
    eq(contactCourseRecords.organizationId, organizationId), eq(contactCourseRecords.businessUnitId, businessUnitId),
    eq(contactCourseRecords.status, 'active'),
    or(isNull(contactCourseRecords.startDate), lte(contactCourseRecords.startDate, today)),
    or(isNull(contactCourseRecords.endDate), gte(contactCourseRecords.endDate, today)),
  )).groupBy(contactCourseRecords.classSectionId) : [];
  const countBySection = new Map(counts.map((row) => [row.classSectionId, Number(row.count)]));
  return rows.flatMap((row) => {
    const history = versions.get(row.id) || [];
    const current = sectionAtDate(row, history, today);
    const next = canManage ? history.filter((item) => item.effectiveDate > today).map((item) => ({
      effectiveDate: item.effectiveDate, revision: item.revision, ...classSectionPayload({ ...row, ...item }),
    })) : [];
    if (!current && !canManage) return [];
    return [{ ...classSectionPayload(current || row), status: current?.status || 'planned',
      revision: history.at(-1)?.revision || 0, rosterCount: countBySection.get(row.id) || 0,
      ...(canManage ? { upcoming: next, baselineDate: history.find((item) => item.isBaseline)?.effectiveDate || null } : {}),
    }];
  });
}

export async function writeManagedSection({ db, organizationId, businessUnitId, actorUserId, sectionId = null,
  payload, expectedRevision, effectiveDate, today = todayInAttendanceTimeZone() }) {
  parseSessionDate(effectiveDate);
  if (effectiveDate < today) throw createCrmError('Effective date cannot be before today. Existing attendance history is unchanged.', 400);
  if (!actorUserId || !organizationId || !businessUnitId) throw createCrmError('A scoped employee is required.', 403);
  return db.transaction(async (tx) => {
    let section;
    let versions = [];
    if (sectionId) {
      [section] = await tx.select().from(courseClassSections).where(and(
        eq(courseClassSections.id, sectionId), eq(courseClassSections.organizationId, organizationId),
        eq(courseClassSections.businessUnitId, businessUnitId),
      )).limit(1).for('update');
      if (!section) throw createCrmError('Class section not found.', 404);
      versions = (await loadSectionVersions(tx, [section.id])).get(section.id) || [];
    }
    const revision = versions.at(-1)?.revision || 0;
    const normalized = normalizeManagedSection(payload, { sectionKey: section?.sectionKey });
    const existingAtDate = versions.find((item) => item.effectiveDate === effectiveDate);
    if (existingAtDate) {
      const identical = SNAPSHOT_FIELDS.every((field) => JSON.stringify(existingAtDate[field]) === JSON.stringify(normalized[field]));
      if (identical && (Number(expectedRevision) === revision || Number(expectedRevision) === revision - 1)) return { section: { ...classSectionPayload({ ...section, ...existingAtDate }), revision },
        audit: { outcome: 'unchanged', effectiveDate, revision } };
      throw createCrmError(existingAtDate.isBaseline
        ? 'The rollout baseline occupies this date. Choose a later effective date.'
        : 'A class version already exists on that effective date. Choose another date.', 409);
    }
    if (Number(expectedRevision) !== revision) throw createCrmError('Class changed in another tab. Refresh and try again.', 409);
    if (sectionId && versions.some((item) => item.effectiveDate > effectiveDate)) {
      throw createCrmError('A later class change is already scheduled. Resolve that change before inserting an earlier version.', 409);
    }
    const [submitted] = sectionId ? await tx.select({ id: classSessions.id }).from(classSessions).where(and(
      eq(classSessions.classSectionId, section.id),
      gte(classSessions.sessionDate, effectiveDate),
    )).limit(1) : [];
    if (submitted) throw createCrmError('A recorded attendance session exists on or after this date. Choose a later effective date.', 409);
    if (normalized.status === 'inactive' && sectionId) {
      const [blocking] = await tx.select({ id: contactCourseRecords.id }).from(contactCourseRecords).where(and(
        eq(contactCourseRecords.classSectionId, section.id), eq(contactCourseRecords.organizationId, organizationId),
        eq(contactCourseRecords.businessUnitId, businessUnitId), eq(contactCourseRecords.status, 'active'),
        or(isNull(contactCourseRecords.startDate), lte(contactCourseRecords.startDate, effectiveDate)),
        or(isNull(contactCourseRecords.endDate), gte(contactCourseRecords.endDate, effectiveDate)),
      )).limit(1);
      if (blocking) throw createCrmError(`Active enrollments span ${effectiveDate}. End or transition the roster before scheduling deactivation.`, 409);
    }
    if (!section) {
      const key = cleanText(payload.sectionKey);
      if (!key) throw createCrmError('Class section key is required.', 400);
      [section] = await tx.insert(courseClassSections).values({ organizationId, businessUnitId,
        sectionKey: key, ...normalized, sourceType: 'employee_management' }).returning();
    }
    const before = sectionId ? sectionAtDate(section, versions, effectiveDate) : null;
    const changes = Object.fromEntries(SNAPSHOT_FIELDS.filter((field) =>
      JSON.stringify(before?.[field] ?? null) !== JSON.stringify(normalized[field] ?? null))
      .map((field) => [field, { before: before?.[field] ?? null, after: normalized[field] ?? null }]));
    const [version] = await tx.insert(classSectionVersions).values({
      organizationId, businessUnitId, classSectionId: section.id, effectiveDate,
      revision: revision + 1, actorUserId, ...normalized,
      auditSummaryJson: { kind: sectionId ? 'class_changed' : 'class_created', changes },
    }).returning();
    return { section: { ...classSectionPayload({ ...section, ...version }), revision: version.revision },
      audit: { outcome: 'saved', effectiveDate, revision: version.revision, changedFields: Object.keys(changes) } };
  });
}

export async function previewManagedSection({ db, organizationId, businessUnitId, sectionId, payload, effectiveDate,
  today = todayInAttendanceTimeZone() }) {
  parseSessionDate(effectiveDate);
  if (effectiveDate < today) throw createCrmError('Effective date cannot be before today.', 400);
  let section = null;
  if (sectionId) {
    [section] = await db.select({ id: courseClassSections.id, sectionKey: courseClassSections.sectionKey })
      .from(courseClassSections).where(and(eq(courseClassSections.id, sectionId),
        eq(courseClassSections.organizationId, organizationId), eq(courseClassSections.businessUnitId, businessUnitId))).limit(1);
    if (!section) throw createCrmError('Class section not found.', 404);
  }
  const next = normalizeManagedSection(payload, { sectionKey: section?.sectionKey });
  const [roster] = sectionId ? await db.select({ count: sql`count(*)::int` }).from(contactCourseRecords).where(and(
    eq(contactCourseRecords.classSectionId, sectionId), eq(contactCourseRecords.organizationId, organizationId),
    eq(contactCourseRecords.businessUnitId, businessUnitId), eq(contactCourseRecords.status, 'active'),
    or(isNull(contactCourseRecords.startDate), lte(contactCourseRecords.startDate, effectiveDate)),
    or(isNull(contactCourseRecords.endDate), gte(contactCourseRecords.endDate, effectiveDate)),
  )) : [{ count: 0 }];
  const upcomingDates = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(`${effectiveDate}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const text = day.toISOString().slice(0, 10);
    if (next.status === 'active' && next.scheduleDaysJson.includes(CANONICAL_WEEKDAYS[(day.getUTCDay() + 6) % 7])) {
      upcomingDates.push(text);
    }
  }
  return { effectiveDate, activeEnrollmentsSpanningDate: Number(roster?.count || 0), upcomingDates,
    willBlockDeactivation: next.status === 'inactive' && Number(roster?.count || 0) > 0 };
}
