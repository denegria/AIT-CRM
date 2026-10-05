const DAY_LABELS = {
  Monday: 'M', Tuesday: 'Tu', Wednesday: 'W', Thursday: 'Th',
  Friday: 'F', Saturday: 'Sa', Sunday: 'Su',
};

function displayTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  if (hour > 23) return '';
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function classSectionDisplayLabel(section = {}) {
  const days = section.scheduleDays || section.scheduleDaysJson || [];
  const dayLabel = Array.isArray(days) ? days.map((day) => DAY_LABELS[day] || day).join('/') : '';
  const start = displayTime(section.startTime);
  const end = displayTime(section.endTime);
  const timeLabel = start && end
    ? `${start.replace(/ (AM|PM)$/, (_, period) => end.endsWith(period) ? '' : ` ${period}`)}–${end}`
    : start || end;
  const schedule = [dayLabel, timeLabel].filter(Boolean).join(' ') || 'Schedule TBD';
  const location = section.modality === 'online'
    ? 'Online'
    : [section.courseLocation || 'Location TBD', section.modality === 'hybrid' ? 'Hybrid' : ''].filter(Boolean).join(' / ');
  return [
    section.courseName || 'Course TBD',
    schedule,
    section.teacher || 'Teacher TBD',
    location,
    section.sectionKey ? `#${section.sectionKey}` : '',
    section.status && section.status !== 'active' ? 'Inactive' : '',
  ].filter(Boolean).join(' · ');
}
