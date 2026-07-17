export const CANONICAL_WEEKDAYS = Object.freeze([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

const WEEKDAY_BY_LOWERCASE = new Map(CANONICAL_WEEKDAYS.map((day) => [day.toLowerCase(), day]));

const WEEKDAY_BY_TOKEN = new Map([
  ['MONDAY', 'Monday'], ['MON', 'Monday'], ['LUN', 'Monday'], ['LUNES', 'Monday'],
  ['TUESDAY', 'Tuesday'], ['TUE', 'Tuesday'], ['TUES', 'Tuesday'], ['MAR', 'Tuesday'], ['MARTES', 'Tuesday'],
  ['WEDNESDAY', 'Wednesday'], ['WED', 'Wednesday'], ['MIE', 'Wednesday'], ['MIER', 'Wednesday'], ['MIERCOLES', 'Wednesday'],
  ['THURSDAY', 'Thursday'], ['THU', 'Thursday'], ['THUR', 'Thursday'], ['THURS', 'Thursday'], ['THUES', 'Thursday'], ['JUE', 'Thursday'], ['JUEVES', 'Thursday'],
  ['FRIDAY', 'Friday'], ['FRI', 'Friday'], ['VIE', 'Friday'], ['VIERNES', 'Friday'],
  ['SATURDAY', 'Saturday'], ['SAT', 'Saturday'], ['SAB', 'Saturday'], ['SABADO', 'Saturday'], ['SABADOS', 'Saturday'],
  ['SUNDAY', 'Sunday'], ['SUN', 'Sunday'], ['DOM', 'Sunday'], ['DOMINGO', 'Sunday'], ['DOMINGOS', 'Sunday'],
]);

function scheduleToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function addWeekdayRange(selected, start, end) {
  const startIndex = CANONICAL_WEEKDAYS.indexOf(start);
  const endIndex = CANONICAL_WEEKDAYS.indexOf(end);
  if (startIndex < 0 || endIndex < 0) return;
  for (let offset = 0; offset < CANONICAL_WEEKDAYS.length; offset += 1) {
    const index = (startIndex + offset) % CANONICAL_WEEKDAYS.length;
    selected.add(CANONICAL_WEEKDAYS[index]);
    if (index === endIndex) break;
  }
}

export function canonicalWeekday(value) {
  return WEEKDAY_BY_LOWERCASE.get(String(value || '').trim().toLowerCase()) || '';
}

export function canonicalScheduleDays(value) {
  const selected = new Set();
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    const normalized = scheduleToken(entry);
    const range = normalized.match(/\b([A-Z]+)\s+(?:TO|A|AL)\s+([A-Z]+)\b/);
    if (range) {
      addWeekdayRange(selected, WEEKDAY_BY_TOKEN.get(range[1]), WEEKDAY_BY_TOKEN.get(range[2]));
    }
    for (const token of normalized.split(/[^A-Z]+/).filter(Boolean)) {
      const weekday = WEEKDAY_BY_TOKEN.get(token);
      if (weekday) selected.add(weekday);
    }
  }
  return CANONICAL_WEEKDAYS.filter((weekday) => selected.has(weekday));
}
