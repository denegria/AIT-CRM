import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_RECURRENCE_FREQUENCY,
  DEFAULT_TASK_STATUS,
  TASK_EVENT_TYPES,
  TASK_PRIORITY_VALUES,
  TASK_RECURRENCE_FREQUENCIES,
  TASK_RECURRENCE_FREQUENCY_VALUES,
  TASK_STATUSES,
  TASK_STATUS_VALUES,
  TASK_TYPES,
  TASK_TYPE_VALUES,
} from './constants.js';

const CLOSED_STATUSES = new Set([TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELED]);

function taskPolicyError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function isClosedTaskStatus(status) {
  return CLOSED_STATUSES.has(status);
}

export function normalizeTaskType(value) {
  const taskType = String(value || '').trim();
  return TASK_TYPE_VALUES.includes(taskType) ? taskType : TASK_TYPES.MANUAL_REMINDER;
}

export function normalizeTaskStatus(value) {
  const status = String(value || '').trim();
  return TASK_STATUS_VALUES.includes(status) ? status : DEFAULT_TASK_STATUS;
}

export function parseTaskStatusFilter(value) {
  const status = String(value || '').trim();
  if (!status) return '';
  if (!TASK_STATUS_VALUES.includes(status)) {
    throw taskPolicyError('Invalid task status filter.');
  }
  return status;
}

export function parseTaskTypeFilter(value) {
  const taskType = String(value || '').trim();
  if (!taskType) return '';
  if (!TASK_TYPE_VALUES.includes(taskType)) {
    throw taskPolicyError('Invalid task type filter.');
  }
  return taskType;
}

export function normalizeTaskPriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  return TASK_PRIORITY_VALUES.includes(priority) ? priority : DEFAULT_TASK_PRIORITY;
}

export function parseTaskDateTime(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw taskPolicyError(`${fieldName} must be a valid date/time.`);
  }
  return date;
}

export function normalizeTaskRecurrence(value = {}, anchorDate = null) {
  const input = value && typeof value === 'object' ? value : {};
  const frequency = String(input.frequency || DEFAULT_TASK_RECURRENCE_FREQUENCY).trim().toLowerCase();
  const normalizedFrequency = TASK_RECURRENCE_FREQUENCY_VALUES.includes(frequency)
    ? frequency
    : DEFAULT_TASK_RECURRENCE_FREQUENCY;

  if (normalizedFrequency === TASK_RECURRENCE_FREQUENCIES.NONE) {
    return null;
  }

  const interval = Number.parseInt(input.interval || 1, 10);
  const parsedAnchor = parseTaskDateTime(input.anchorDate || anchorDate, 'recurrence.anchorDate');
  if (!parsedAnchor) {
    throw taskPolicyError('Recurring tasks require a hard due date.');
  }

  return {
    frequency: normalizedFrequency,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    anchorDate: parsedAnchor.toISOString(),
    active: input.active !== false,
    source: 'manual',
  };
}

export function nextRecurringDueAt(recurrence = {}, currentDueAt = null) {
  if (!recurrence?.active || recurrence.frequency === TASK_RECURRENCE_FREQUENCIES.NONE) return null;
  const currentDate = parseTaskDateTime(currentDueAt || recurrence.anchorDate, 'recurrence.currentDueAt');
  if (!currentDate) return null;

  const interval = Number.isFinite(Number(recurrence.interval)) && Number(recurrence.interval) > 0
    ? Number(recurrence.interval)
    : 1;
  const next = new Date(currentDate);

  if (recurrence.frequency === TASK_RECURRENCE_FREQUENCIES.DAILY) {
    next.setUTCDate(next.getUTCDate() + interval);
  } else if (recurrence.frequency === TASK_RECURRENCE_FREQUENCIES.WEEKLY) {
    next.setUTCDate(next.getUTCDate() + (7 * interval));
  } else if (recurrence.frequency === TASK_RECURRENCE_FREQUENCIES.BIWEEKLY) {
    next.setUTCDate(next.getUTCDate() + (14 * interval));
  } else if (recurrence.frequency === TASK_RECURRENCE_FREQUENCIES.MONTHLY) {
    next.setUTCMonth(next.getUTCMonth() + interval);
  } else {
    return null;
  }

  return next;
}

export function buildTaskTransition({ task, action, now = new Date(), payload = {} }) {
  const normalizedAction = String(action || 'update').trim();
  const patch = { updatedAt: now };
  let eventType = TASK_EVENT_TYPES.UPDATED;
  let message = 'Updated task.';

  if (isClosedTaskStatus(task.status) && normalizedAction !== 'reopen') {
    throw taskPolicyError('Completed or canceled tasks must be reopened before further changes.');
  }

  if (normalizedAction === 'assign') {
    eventType = TASK_EVENT_TYPES.ASSIGNED;
    message = 'Assigned task.';
    patch.ownerUserId = payload.ownerUserId || null;
  } else if (normalizedAction === 'complete') {
    eventType = TASK_EVENT_TYPES.COMPLETED;
    message = 'Completed task.';
    patch.status = TASK_STATUSES.COMPLETED;
    patch.completedAt = now;
    patch.canceledAt = null;
  } else if (normalizedAction === 'snooze') {
    eventType = TASK_EVENT_TYPES.SNOOZED;
    message = 'Snoozed task.';
    patch.status = TASK_STATUSES.SNOOZED;
    patch.snoozedUntil = parseTaskDateTime(payload.snoozedUntil || payload.dueAt, 'snoozedUntil');
    if (!patch.snoozedUntil) {
      throw taskPolicyError('snoozedUntil must be provided when snoozing a task.');
    }
    patch.dueAt = patch.snoozedUntil;
  } else if (normalizedAction === 'cancel') {
    eventType = TASK_EVENT_TYPES.CANCELED;
    message = 'Canceled task.';
    patch.status = TASK_STATUSES.CANCELED;
    patch.canceledAt = now;
  } else if (normalizedAction === 'start') {
    eventType = TASK_EVENT_TYPES.STARTED;
    message = 'Started task.';
    patch.status = TASK_STATUSES.IN_PROGRESS;
  } else if (normalizedAction === 'reopen') {
    eventType = TASK_EVENT_TYPES.STARTED;
    message = 'Reopened task.';
    patch.status = TASK_STATUSES.OPEN;
    patch.completedAt = null;
    patch.canceledAt = null;
    patch.snoozedUntil = null;
  } else if (normalizedAction !== 'update') {
    throw taskPolicyError('Unsupported task action.');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = String(payload.title || '').trim();
    if (!title) {
      throw taskPolicyError('Task title is required.');
    }
    patch.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    patch.description = String(payload.description || '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'taskType')) {
    patch.taskType = normalizeTaskType(payload.taskType);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'priority')) {
    patch.priority = normalizeTaskPriority(payload.priority);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'dueAt') && normalizedAction !== 'snooze') {
    eventType = eventType === TASK_EVENT_TYPES.UPDATED
      ? TASK_EVENT_TYPES.DUE_DATE_CHANGED
      : eventType;
    patch.dueAt = parseTaskDateTime(payload.dueAt, 'dueAt');
    if (!patch.dueAt) {
      throw taskPolicyError('Task due date is required.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'ownerUserId') && normalizedAction !== 'assign') {
    eventType = eventType === TASK_EVENT_TYPES.UPDATED
      ? TASK_EVENT_TYPES.ASSIGNED
      : eventType;
    patch.ownerUserId = payload.ownerUserId || null;
  }

  return { patch, eventType, message };
}
