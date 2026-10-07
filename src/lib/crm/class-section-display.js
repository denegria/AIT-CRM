import { scheduleSummary } from './class-schedule.js';

export function classSectionScheduleLabel(section) {
  return section ? scheduleSummary(section) : '';
}

export function classSectionDisplayLabel(section = {}) {
  const schedule = classSectionScheduleLabel(section);
  const location = section.modality === 'online'
    ? 'Online'
    : [section.courseLocation || 'Location TBD', section.modality === 'hybrid' ? 'Hybrid' : ''].filter(Boolean).join(' / ');
  return [
    section.courseName || 'Course TBD',
    schedule,
    section.teacher || 'Teacher TBD',
    location,
    section.sectionKey ? `#${section.sectionKey}` : '',
    section.status === 'inactive' ? 'Inactive' : section.status === 'planned' ? 'Planned' : '',
  ].filter(Boolean).join(' · ');
}
