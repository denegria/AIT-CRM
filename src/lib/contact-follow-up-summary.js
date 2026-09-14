import { FOLLOW_UP_OUTCOME_VALUES } from './tasks/constants.js';
import { followUpOutcomeLabel, followUpOutcomeSuggestsNextDue } from './tasks/follow-up.js';
import { isTaskOverdue, isTaskOpen } from './tasks/visibility.js';

const OUTCOMES = new Set(FOLLOW_UP_OUTCOME_VALUES);

function clean(value = '') {
  return String(value || '').trim();
}

function eventTime(event = {}) {
  const value = event.occurredAt || event.createdAt || event.timestamp || event.date;
  const time = new Date(value || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

function outcomeForEvent(event = {}) {
  const fromMetadata = clean(event.metadataJson?.outcome || event.metadata?.outcome);
  const fromType = clean(event.eventType).replace(/^follow_up\./i, '');
  const outcome = fromMetadata || fromType;
  return OUTCOMES.has(outcome) ? outcome : '';
}

export function latestStructuredFollowUp(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({ event, outcome: outcomeForEvent(event) }))
    .filter(({ event, outcome }) => outcome && /^follow_up\.[a-z_]+$/i.test(clean(event.eventType)))
    .sort((left, right) => eventTime(right.event) - eventTime(left.event))[0] || null;
}

// The task route is the authorization boundary. This adapter intentionally does
// not accept its broader users array or timeline-linked records as task input.
export function scopedFollowUpTasksFromPayload(payload = {}) {
  return Array.isArray(payload.tasks) ? payload.tasks.filter((task) => isTaskOpen(task)) : [];
}

function ownerLabel(task = {}, ownerOptions = []) {
  if (!task.ownerUserId) return 'Unassigned';
  return ownerOptions.find((owner) => owner.id === task.ownerUserId)?.label || 'Assigned — name unavailable';
}

export function buildFollowUpSummary({
  events = [],
  tasks = [],
  ownerOptions = [],
  contactability = {},
  isPrivileged = false,
  now = new Date(),
} = {}) {
  const latest = latestStructuredFollowUp(events);
  const outcome = latest?.outcome || '';
  const permittedTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => isTaskOpen(task));
  const outreachBlocked = contactability?.canFollowUp === false;

  const result = {
    latest: latest
      ? {
          outcome,
          label: clean(latest.event.metadataJson?.outcomeLabel) || followUpOutcomeLabel(outcome),
          occurredAt: latest.event.occurredAt || latest.event.createdAt || latest.event.timestamp || latest.event.date || null,
        }
      : null,
    commitment: null,
    outreachBlocked,
  };

  if (permittedTasks.length > 1) {
    result.commitment = { kind: 'multiple', count: permittedTasks.length, label: `${permittedTasks.length} follow-ups need review` };
    return result;
  }

  const task = permittedTasks[0];
  if (task) {
    const snoozedUntil = task.snoozedUntil || null;
    const dueAt = task.dueAt || task.dueDate || null;
    result.commitment = {
      kind: outreachBlocked ? 'blocked' : 'exact',
      task,
      ownerLabel: ownerLabel(task, ownerOptions),
      label: outreachBlocked
        ? 'Outreach blocked — review task'
        : snoozedUntil
          ? 'Snoozed until'
          : !dueAt
            ? 'Follow-up needs a date'
            : isTaskOverdue(task, now)
              ? 'Overdue'
              : 'Next follow-up',
      dueAt: snoozedUntil || dueAt,
      originalDueAt: snoozedUntil && task.originalDueAt ? task.originalDueAt : null,
      isOverdue: !snoozedUntil && isTaskOverdue(task, now),
    };
    return result;
  }

  const suggestsNext = outcome && followUpOutcomeSuggestsNextDue(outcome);
  result.commitment = {
    kind: 'empty',
    label: isPrivileged
      ? (suggestsNext ? 'Next follow-up not scheduled' : 'No open follow-up recorded')
      : 'No follow-up assigned to you',
    detail: !isPrivileged && suggestsNext ? 'Latest outcome suggests another follow-up' : '',
  };
  return result;
}
