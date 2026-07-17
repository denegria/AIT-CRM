const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MARKED_STATUSES = new Set(['present', 'absent']);

function dateAtNoonUtc(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayInNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(value, amount) {
  const date = dateAtNoonUtc(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatLongDate(value) {
  const date = dateAtNoonUtc(value);
  if (!date) return String(value || '');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function formatSessionDate(value) {
  const date = dateAtNoonUtc(value);
  if (!date) return String(value || '');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function formatEnrollmentDate(value) {
  const date = dateAtNoonUtc(value);
  if (!date) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function formatClockTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || '');
  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return String(value || '');
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatTimeRange(start, end) {
  const formattedStart = formatClockTime(start);
  const formattedEnd = formatClockTime(end);
  if (formattedStart && formattedEnd) return `${formattedStart}–${formattedEnd}`;
  return formattedStart || formattedEnd || 'Time not set';
}

export function formatScheduleDays(days = []) {
  const aliases = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
  return Array.isArray(days) && days.length ? days.map((day) => aliases[day] || day).join(' / ') : 'Schedule not set';
}

export function formatClassLocation(item = {}) {
  if (String(item.modality || '').toLowerCase() === 'online') return 'Online';
  return String(item.location || '').trim() || 'Location not set';
}

export function classTitle(item = {}) {
  const course = String(item.courseName || 'Untitled class').trim();
  const location = formatClassLocation(item);
  return location && location !== 'Location not set' ? `${course} — ${location}` : course;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts[parts.length - 1][0] || '' : ''}`.toUpperCase();
}

export function attendanceStateLabel(value) {
  if (value === 'submitted') return 'Submitted';
  if (value === 'in_progress') return 'In progress';
  return 'Not started';
}

export function marksFromRoster(roster = []) {
  return Object.fromEntries(roster.map((student) => [student.enrollmentId, {
    status: MARKED_STATUSES.has(student.mark?.status) ? student.mark.status : null,
    note: String(student.mark?.note || ''),
  }]));
}

export function serializeMarks(roster = [], markMap = {}) {
  return roster.flatMap((student) => {
    const mark = markMap[student.enrollmentId];
    if (!MARKED_STATUSES.has(mark?.status)) return [];
    return [{ enrollmentId: student.enrollmentId, status: mark.status, note: String(mark.note || '').trim() }];
  });
}

export function attendanceCounts(roster = [], markMap = {}) {
  return roster.reduce((counts, student) => {
    const status = markMap[student.enrollmentId]?.status;
    if (status === 'present') counts.present += 1;
    else if (status === 'absent') counts.absent += 1;
    else counts.unmarked += 1;
    return counts;
  }, { present: 0, absent: 0, unmarked: 0 });
}

export function selectedSession(workspace = null) {
  return workspace?.sessions?.find((session) => session.date === workspace.selectedDate) || null;
}

export function classRailHeading(value, today = todayInNewYork()) {
  if (value === today) return 'Today’s classes';
  const date = dateAtNoonUtc(value);
  return date ? `Classes on ${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date)}` : 'Classes';
}
