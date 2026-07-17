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

export function canonicalWeekday(value) {
  return WEEKDAY_BY_LOWERCASE.get(String(value || '').trim().toLowerCase()) || '';
}
