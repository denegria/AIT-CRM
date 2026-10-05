// Follow-up times are entered in the operator's browser time zone. Keep the
// existing date-only 09:00 behavior for quick-date and legacy workflows.
export function followUpDueInputToIso(dateValue, timeValue = '') {
  if (!dateValue) return null;
  const date = String(dateValue).trim();
  const time = String(timeValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error('Choose a valid next follow-up date and time.');
  }
  const local = `${date}T${time || '09:00'}`;
  const dueAt = new Date(local);
  if (Number.isNaN(dueAt.getTime()) ||
      dueAt.getFullYear() !== Number(date.slice(0, 4)) ||
      dueAt.getMonth() + 1 !== Number(date.slice(5, 7)) ||
      dueAt.getDate() !== Number(date.slice(8, 10)) ||
      dueAt.getHours() !== Number((time || '09:00').slice(0, 2)) ||
      dueAt.getMinutes() !== Number((time || '09:00').slice(3, 5))) {
    throw new Error('This time does not exist in your time zone. Choose another time.');
  }
  // A repeated wall-clock time during a fall DST transition has two instants.
  // Require another time instead of silently choosing the earlier one.
  if (time && [60, 120].some((minutes) => {
    const later = new Date(dueAt.getTime() + minutes * 60_000);
    return later.getFullYear() === dueAt.getFullYear() &&
      later.getMonth() === dueAt.getMonth() && later.getDate() === dueAt.getDate() &&
      later.getHours() === dueAt.getHours() && later.getMinutes() === dueAt.getMinutes();
  })) {
    throw new Error('This time occurs twice in your time zone. Choose another time.');
  }
  return dueAt.toISOString();
}
