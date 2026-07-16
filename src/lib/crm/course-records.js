import { canonicalAitUsaSchoolLocation } from '../school-locations.js';

const COURSE_RECORD_STATUSES = Object.freeze([
  'planned',
  'active',
  'completed',
  'dropped',
  'cancelled',
  'transferred',
]);

const TERMINAL_STATUSES = new Set(['completed', 'dropped', 'cancelled', 'transferred']);

export const COURSE_RECORD_STATUS_OPTIONS = Object.freeze([
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Current' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped / Quit' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'transferred', label: 'Transferred' },
]);

export const AIT_USA_COURSE_OPTIONS = Object.freeze([
  'Intro to English',
  'English 1',
  'English 2',
  'English 3',
  'English 4',
  'English 5',
  'English 6',
  'GED',
  'Citizenship Prep',
  'Computer',
  'Math',
]);

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalized(value = '') {
  return cleanText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function dateForPayload(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return value?.toISOString?.().slice(0, 10) || '';
}

function dateForDb(value, { allowClear = false } = {}) {
  const clean = cleanText(value);
  if (!clean) return allowClear ? null : undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new Error('Course dates must use YYYY-MM-DD format.');
  }
  return clean;
}

function courseLocationForPayload(value = '') {
  const clean = cleanText(value);
  return canonicalAitUsaSchoolLocation(clean) || clean;
}

function courseLocationForDb(value, { allowClear = false } = {}) {
  const clean = courseLocationForPayload(value);
  if (!clean) return allowClear ? null : undefined;
  return clean;
}

export function normalizeCourseRecordStatus(value = '') {
  const status = normalized(value);
  if (!status) return 'active';
  if (['current', 'enrolled', 'in progress', 'started'].includes(status)) return 'active';
  if (['complete', 'finished', 'graduated'].includes(status)) return 'completed';
  if (['drop', 'dropped quit', 'dropped / quit', 'quit', 'withdrawn', 'withdraw'].includes(status)) return 'dropped';
  if (['cancel', 'canceled'].includes(status)) return 'cancelled';
  if (['transfer'].includes(status)) return 'transferred';
  return COURSE_RECORD_STATUSES.includes(status) ? status : status.replace(/\s+/g, '_');
}

export function courseRecordStatusLabel(value = '') {
  const status = normalizeCourseRecordStatus(value);
  return COURSE_RECORD_STATUS_OPTIONS.find((option) => option.value === status)?.label || cleanText(value) || 'Current';
}

export function isTerminalCourseRecordStatus(value = '') {
  return TERMINAL_STATUSES.has(normalizeCourseRecordStatus(value));
}

export function courseNameOptions(currentValue = '') {
  const current = cleanText(currentValue);
  return [...new Set([
    ...AIT_USA_COURSE_OPTIONS,
    ...(current ? [current] : []),
  ])];
}

export function courseRecordPayloadFromRow(row = {}) {
  return {
    id: row.id || '',
    contactId: row.contactId || '',
    leadId: row.leadId || '',
    businessUnitId: row.businessUnitId || '',
    courseName: cleanText(row.courseName),
    courseLocation: courseLocationForPayload(row.courseLocation),
    teacher: cleanText(row.teacher),
    status: normalizeCourseRecordStatus(row.status),
    statusLabel: courseRecordStatusLabel(row.status),
    startDate: dateForPayload(row.startDate),
    endDate: dateForPayload(row.endDate),
    outcomeReason: cleanText(row.outcomeReason),
    notes: cleanText(row.notes),
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || '',
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || '',
  };
}

export function courseRecordSummaryPayloadFromRow(row = {}) {
  return {
    courseName: cleanText(row.courseName),
    courseLocation: courseLocationForPayload(row.courseLocation),
    teacher: cleanText(row.teacher),
    status: normalizeCourseRecordStatus(row.status),
    startDate: dateForPayload(row.startDate),
    endDate: dateForPayload(row.endDate),
    outcomeReason: cleanText(row.outcomeReason),
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || '',
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || '',
  };
}

export function courseRecordInputFromPayload(payload = {}, { allowClear = false } = {}) {
  const source = payload.courseRecord && typeof payload.courseRecord === 'object'
    ? payload.courseRecord
    : payload;
  const input = {};
  if (Object.prototype.hasOwnProperty.call(source, 'courseName')) {
    input.courseName = cleanText(source.courseName);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'courseLocation')) {
    input.courseLocation = courseLocationForDb(source.courseLocation, { allowClear });
  }
  if (Object.prototype.hasOwnProperty.call(source, 'teacher')) {
    const value = cleanText(source.teacher);
    input.teacher = value || (allowClear ? null : undefined);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'status')) {
    input.status = normalizeCourseRecordStatus(source.status);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'startDate')) {
    input.startDate = dateForDb(source.startDate, { allowClear });
  }
  if (Object.prototype.hasOwnProperty.call(source, 'endDate')) {
    input.endDate = dateForDb(source.endDate, { allowClear });
  }
  if (Object.prototype.hasOwnProperty.call(source, 'outcomeReason')) {
    const value = cleanText(source.outcomeReason);
    input.outcomeReason = value || (allowClear ? null : undefined);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'notes')) {
    const value = cleanText(source.notes);
    input.notes = value || (allowClear ? null : undefined);
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function courseRecordValuesFromInput(input = {}, defaults = {}) {
  return {
    ...defaults,
    ...(Object.prototype.hasOwnProperty.call(input, 'courseName') ? { courseName: cleanText(input.courseName) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'courseLocation') ? { courseLocation: courseLocationForPayload(input.courseLocation) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'teacher') ? { teacher: cleanText(input.teacher) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'status') ? { status: normalizeCourseRecordStatus(input.status) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'startDate') ? { startDate: input.startDate || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'endDate') ? { endDate: input.endDate || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'outcomeReason') ? { outcomeReason: cleanText(input.outcomeReason) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'notes') ? { notes: cleanText(input.notes) || null } : {}),
  };
}

export function validateCourseRecordInput(input = {}, {
  existingRecords = [],
  currentRecordId = '',
  requireCourseName = true,
} = {}) {
  const status = normalizeCourseRecordStatus(input.status);
  if (!COURSE_RECORD_STATUSES.includes(status)) {
    throw new Error('Course status is not supported.');
  }
  if (requireCourseName && !cleanText(input.courseName)) {
    throw new Error('Course name is required.');
  }
  if (status === 'active') {
    if (!input.startDate) {
      throw new Error('Start date is required for the current course.');
    }
    const hasOtherActive = existingRecords.some((record) => (
      record.id !== currentRecordId && normalizeCourseRecordStatus(record.status) === 'active'
    ));
    if (hasOtherActive) {
      throw new Error('This contact already has a current course. End it before starting another course.');
    }
  }
}

export function sortCourseRecords(records = []) {
  return [...records].sort((left, right) => {
    const leftActive = normalizeCourseRecordStatus(left.status) === 'active';
    const rightActive = normalizeCourseRecordStatus(right.status) === 'active';
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    const leftDate = left.endDate || left.startDate || left.createdAt || '';
    const rightDate = right.endDate || right.startDate || right.createdAt || '';
    return String(rightDate).localeCompare(String(leftDate));
  });
}

export function deriveCourseSummary(records = []) {
  const sorted = sortCourseRecords(records.map(courseRecordPayloadFromRow));
  const currentCourse = sorted.find((record) => record.status === 'active') || null;
  const completedCourses = sorted.filter((record) => record.status === 'completed');
  const endedCourses = sorted.filter((record) => isTerminalCourseRecordStatus(record.status));
  return {
    records: sorted,
    currentCourse,
    latestCompletedCourse: completedCourses[0] || null,
    latestEndedCourse: endedCourses[0] || null,
    hasCurrentCourse: Boolean(currentCourse),
  };
}
