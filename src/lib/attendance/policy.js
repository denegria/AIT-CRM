import { ROLE_KEYS, roleKeysForUser } from '../roles.js';
import { CANONICAL_WEEKDAYS } from '../schedule-days.js';

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export const ATTENDANCE_TIME_ZONE = 'America/New_York';
export const ATTENDANCE_STATUSES = Object.freeze(['present', 'absent']);
const ATTENDANCE_STATUS_SET = new Set(ATTENDANCE_STATUSES);
const ATTENDANCE_ROLE_SET = new Set([
  ROLE_KEYS.ACCOUNT_COORDINATOR,
  ROLE_KEYS.SENIOR_COORDINATOR,
  ROLE_KEYS.ADMIN,
]);
const ATTENDANCE_MANAGER_ROLE_SET = new Set([ROLE_KEYS.SENIOR_COORDINATOR, ROLE_KEYS.ADMIN]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isAttendanceEmployee(user = {}) {
  return roleKeysForUser(user).some((roleKey) => ATTENDANCE_ROLE_SET.has(roleKey));
}

export function canManageSubmittedAttendance(user = {}) {
  return roleKeysForUser(user).some((roleKey) => ATTENDANCE_MANAGER_ROLE_SET.has(roleKey));
}

export function canLinkAttendanceContacts(user = {}) {
  return canManageSubmittedAttendance(user);
}

export function isAitUsaBusinessUnit(value) {
  return String(value || '').trim().toLowerCase() === 'ait usa';
}

export function parseSessionDate(value) {
  const dateText = String(value || '').trim();
  if (!DATE_PATTERN.test(dateText)) throw inputError('Session date must use YYYY-MM-DD format.');
  const [year, month, day] = dateText.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw inputError('Session date is not a valid calendar date.');
  }
  return { date: parsed, dateText };
}

export function dateTextFromDate(date) {
  return date.toISOString().slice(0, 10);
}

export function todayInAttendanceTimeZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function weekdayForSessionDate(value) {
  const { date } = parseSessionDate(value);
  return CANONICAL_WEEKDAYS[(date.getUTCDay() + 6) % 7];
}

export function weekBounds(value) {
  const { date } = parseSessionDate(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: dateTextFromDate(start), end: dateTextFromDate(end) };
}

export function scheduledDatesForWeek(scheduleDays, weekOf) {
  const { start } = weekBounds(weekOf);
  const selected = new Set(Array.isArray(scheduleDays) ? scheduleDays : []);
  const startDate = parseSessionDate(start).date;
  return CANONICAL_WEEKDAYS.flatMap((weekday, offset) => {
    if (!selected.has(weekday)) return [];
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + offset);
    return [dateTextFromDate(date)];
  });
}

export function assertScheduledSessionDate(section, sessionDate) {
  const weekday = weekdayForSessionDate(sessionDate);
  const days = Array.isArray(section?.scheduleDaysJson) ? section.scheduleDaysJson : [];
  if (!days.includes(weekday)) {
    throw inputError(`${sessionDate} is not a scheduled ${weekday} meeting for this class.`);
  }
  return sessionDate;
}

export function normalizeExpectedRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw inputError('expectedRevision must be a non-negative integer.');
  }
  return revision;
}

export function normalizeSessionNote(value) {
  const note = String(value || '').trim();
  if (note.length > 4000) throw inputError('Session note cannot exceed 4,000 characters.');
  return note || null;
}

export function normalizeAttendanceMarks(value) {
  if (!Array.isArray(value)) throw inputError('marks must be an array.');
  const enrollmentIds = new Set();
  return value.map((mark) => {
    const enrollmentId = String(mark?.enrollmentId || '').trim();
    const status = String(mark?.status || '').trim().toLowerCase();
    const note = String(mark?.note || '').trim();
    if (!enrollmentId) throw inputError('Every attendance mark requires an enrollmentId.');
    if (enrollmentIds.has(enrollmentId)) throw inputError(`Duplicate attendance mark for enrollment ${enrollmentId}.`);
    if (!ATTENDANCE_STATUS_SET.has(status)) throw inputError('Attendance status must be present or absent.');
    if (note.length > 1000) throw inputError('Attendance note cannot exceed 1,000 characters.');
    enrollmentIds.add(enrollmentId);
    return { enrollmentId, status, note: note || null };
  }).sort((left, right) => left.enrollmentId.localeCompare(right.enrollmentId));
}

export function deriveAttendanceState(session, markCount = 0) {
  if (session?.status === 'submitted') return 'submitted';
  return markCount > 0 ? 'in_progress' : 'not_started';
}

export function attendanceSnapshotsEqual(left = [], right = []) {
  const normalize = (rows) => normalizeAttendanceMarks(rows.map((row) => ({
    enrollmentId: row.enrollmentId,
    status: row.status,
    note: row.note,
  })));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function enrollmentEligibleOnDate(enrollment, sessionDate) {
  parseSessionDate(sessionDate);
  return enrollment?.status === 'active'
    && (!enrollment.startDate || enrollment.startDate <= sessionDate)
    && (!enrollment.endDate || enrollment.endDate >= sessionDate);
}
