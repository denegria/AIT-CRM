import { WORKFLOW_KEYS, normalizeLifecycleStatus } from './lifecycle.js';

const COURSE_METADATA_FIELDS = Object.freeze([
  'currentCourse',
  'completedCourse',
  'endedCourse',
  'courseOutcome',
]);

const COURSE_METADATA_COLUMN_BY_FIELD = Object.freeze({
  currentCourse: 'current_course',
  completedCourse: 'completed_course',
  endedCourse: 'ended_course',
  courseOutcome: 'course_outcome',
});

const COURSE_OUTCOME_LABELS = Object.freeze({
  completed: 'Completed',
  dropped_quit: 'Dropped / Quit',
  transferred: 'Transferred',
  unknown: 'Unknown',
});

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalized(value = '') {
  return cleanText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function compactPatch(patch = {}, { allowClear = false } = {}) {
  return Object.fromEntries(
    COURSE_METADATA_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(patch, field))
      .map((field) => [field, cleanText(patch[field])])
      .filter(([, value]) => allowClear || Boolean(value)),
  );
}

export function normalizeCourseOutcome(value = '') {
  const outcome = normalized(value);
  if (!outcome) return '';
  if (['completed', 'complete', 'finished', 'graduated'].includes(outcome)) return 'completed';
  if (['dropped', 'drop', 'quit', 'dropped quit', 'dropped / quit', 'quit mid course', 'withdrawn', 'withdraw'].includes(outcome)) return 'dropped_quit';
  if (['transferred', 'transfer'].includes(outcome)) return 'transferred';
  if (['unknown', 'not sure', 'unsure', 'n a', 'na'].includes(outcome)) return 'unknown';
  return outcome.replace(/\s+/g, '_');
}

export function courseMetadataPatchFromPayload(payload = {}, { allowClear = false } = {}) {
  const source = payload.courseMetadata && typeof payload.courseMetadata === 'object'
    ? payload.courseMetadata
    : payload;
  const patch = compactPatch(source, { allowClear });
  if (Object.prototype.hasOwnProperty.call(patch, 'courseOutcome')) {
    patch.courseOutcome = normalizeCourseOutcome(patch.courseOutcome);
  }
  return patch;
}

export function courseMetadataForPayload(lead = null) {
  return Object.fromEntries(COURSE_METADATA_FIELDS.map((field) => [field, cleanText(lead?.[field])]));
}

export function courseMetadataPatchToDbValues(patch = {}) {
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([field]) => COURSE_METADATA_COLUMN_BY_FIELD[field])
      .map(([field, value]) => [COURSE_METADATA_COLUMN_BY_FIELD[field], cleanText(value) || null]),
  );
}

export function courseMetadataPatchToDrizzleValues(patch = {}) {
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([field]) => COURSE_METADATA_FIELDS.includes(field))
      .map(([field, value]) => [field, cleanText(value) || null]),
  );
}

export function validateCourseMetadataForStatus({
  courseMetadata = {},
  status = '',
  businessUnit = null,
  workflowKey = '',
} = {}) {
  const lifecycleStatus = normalizeLifecycleStatus(status, { businessUnit, workflowKey }) || cleanText(status);
  const outcome = normalizeCourseOutcome(courseMetadata.courseOutcome);
  const unitWorkflowKey = workflowKey || businessUnit?.workflowKey || '';
  if (unitWorkflowKey && unitWorkflowKey !== WORKFLOW_KEYS.AIT_USA) return;

  if (lifecycleStatus === 'Enrolled' && ['completed', 'dropped_quit', 'transferred'].includes(outcome)) {
    throw new Error('Enrolled contacts cannot have a terminal course outcome.');
  }
  if (lifecycleStatus === 'Course Completed' && ['dropped_quit', 'transferred'].includes(outcome)) {
    throw new Error('Course Completed contacts can only use Completed or Unknown as the course outcome.');
  }
  if (lifecycleStatus === 'Dropped / Quit' && outcome === 'completed') {
    throw new Error('Dropped / Quit contacts cannot use Completed as the course outcome.');
  }
}

export function courseMetadataSummary(patch = {}) {
  return Object.entries(patch)
    .filter(([field, value]) => COURSE_METADATA_FIELDS.includes(field) && cleanText(value))
    .map(([field, value]) => {
      if (field === 'courseOutcome') {
        return `Course outcome: ${COURSE_OUTCOME_LABELS[normalizeCourseOutcome(value)] || cleanText(value)}`;
      }
      const label = {
        currentCourse: 'Current course',
        completedCourse: 'Completed course',
        endedCourse: 'Ended course',
      }[field] || field;
      return `${label}: ${cleanText(value)}`;
    })
    .join('; ');
}
