import { and, asc, eq } from 'drizzle-orm';
import { courseClassSections } from '../../db/schema.js';
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

export async function listClassSections({ db, organizationId, businessUnitId, includeInactive = false }) {
  const rows = await db
    .select()
    .from(courseClassSections)
    .where(and(
      eq(courseClassSections.organizationId, organizationId),
      eq(courseClassSections.businessUnitId, businessUnitId),
      ...(includeInactive ? [] : [eq(courseClassSections.status, 'active')]),
    ))
    .orderBy(asc(courseClassSections.courseName), asc(courseClassSections.teacher), asc(courseClassSections.sectionKey));
  return rows.map(classSectionPayload);
}

export async function upsertClassSection({ db, organizationId, businessUnitId, payload }) {
  if (!db || !organizationId || !businessUnitId) {
    throw new Error('Class section writes require an explicit database, organization, and business unit.');
  }
  const input = classSectionInput(payload);
  const [row] = await db
    .insert(courseClassSections)
    .values({ organizationId, businessUnitId, ...input })
    .onConflictDoUpdate({
      target: [
        courseClassSections.organizationId,
        courseClassSections.businessUnitId,
        courseClassSections.sectionKey,
      ],
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return classSectionPayload(row);
}
