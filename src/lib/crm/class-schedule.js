import { CANONICAL_WEEKDAYS, canonicalWeekday } from '../schedule-days.js';
import { formatScheduleDays, formatTimeRange } from '../attendance/client-view.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayOrder = new Map(CANONICAL_WEEKDAYS.map((day, index) => [day, index]));

export function normalizeScheduleSlots(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('Add at least one class schedule time group.');
  const usedDays = new Set();
  const groups = value.map((slot) => {
    const days = Array.isArray(slot?.days) ? slot.days : (slot?.day ? [slot.day] : []);
    if (!days.length || days.some((day) => !dayOrder.has(day))) {
      throw new Error('Choose one or more valid weekdays for each time group.');
    }
    const uniqueDays = [...new Set(days)];
    if (uniqueDays.length !== days.length || uniqueDays.some((day) => usedDays.has(day))) {
      throw new Error('Each weekday can appear in only one class schedule time group.');
    }
    const startTime = String(slot.startTime || '').trim();
    const endTime = String(slot.endTime || '').trim();
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime) || startTime >= endTime) {
      throw new Error('Enter a valid start and end time in New York local time for every group.');
    }
    uniqueDays.forEach((day) => usedDays.add(day));
    return { days: uniqueDays.sort((left, right) => dayOrder.get(left) - dayOrder.get(right)), startTime, endTime };
  });
  return groups.sort((left, right) => dayOrder.get(left.days[0]) - dayOrder.get(right.days[0]));
}

// Empty slots are intentional for imported/legacy rows. Their single time range
// applies to every stored weekday until a manager explicitly saves a new version.
export function scheduleSlotsForSection(section = {}) {
  const stored = Array.isArray(section.scheduleSlotsJson) && section.scheduleSlotsJson.length
    ? section.scheduleSlotsJson : section.scheduleSlots;
  if (Array.isArray(stored) && stored.length) return stored;
  const days = section.scheduleDaysJson || section.scheduleDays || [];
  if (!Array.isArray(days) || !section.startTime || !section.endTime) return [];
  const canonical = [...new Set(days.map((day) => canonicalWeekday(day)).filter(Boolean))];
  return canonical.length ? [{ days: canonical, startTime: section.startTime, endTime: section.endTime }] : [];
}

export function scheduleSlotForWeekday(section, weekday) {
  return scheduleSlotsForSection(section).find((slot) => slot.days?.includes(weekday)) || null;
}

export function scheduleSummary(section = {}) {
  const days = section.scheduleDaysJson || section.scheduleDays || [];
  if (Array.isArray(days) && days.some((day) => !dayOrder.has(day))) return 'Schedule needs review';
  const slots = scheduleSlotsForSection(section);
  if (slots.length) return slots.map((slot) =>
    `${formatScheduleDays(slot.days)} · ${formatTimeRange(slot.startTime, slot.endTime)}`).join('; ');
  return days.length ? `${formatScheduleDays(days)} · Time not set` : 'Class schedule not set';
}
