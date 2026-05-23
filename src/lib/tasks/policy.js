import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  TASK_EVENT_TYPES,
  TASK_PRIORITY_VALUES,
  TASK_STATUSES,
  TASK_STATUS_VALUES,
  TASK_TYPES,
  TASK_TYPE_VALUES,
} from './constants.js';

const CLOSED_STATUSES = new Set([TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELED]);

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

export function normalizeTaskPriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  return TASK_PRIORITY_VALUES.includes(priority) ? priority : DEFAULT_TASK_PRIORITY;
}

export function parseTaskDateTime(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid date/time.`);
    error.status = 400;
    throw error;
  }
  return date;
}

export function buildTaskTransition({ task, action, now = new Date(), payload = {} }) {
  const normalizedAction = String(action || 'update').trim();
  const patch = { updatedAt: now };
  let eventType = TASK_EVENT_TYPES.UPDATED;
  let message = 'Updated task.';

  if (isClosedTaskStatus(task.status) && normalizedAction !== 'reopen') {
    const error = new Error('Completed or canceled tasks must be reopened before further changes.');
    error.status = 400;
    throw error;
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
      const error = new Error('snoozedUntil must be provided when snoozing a task.');
      error.status = 400;
      throw error;
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
    const error = new Error('Unsupported task action.');
    error.status = 400;
    throw error;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = String(payload.title || '').trim();
    if (!title) {
      const error = new Error('Task title is required.');
      error.status = 400;
      throw error;
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
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'ownerUserId') && normalizedAction !== 'assign') {
    eventType = eventType === TASK_EVENT_TYPES.UPDATED
      ? TASK_EVENT_TYPES.ASSIGNED
      : eventType;
    patch.ownerUserId = payload.ownerUserId || null;
  }

  return { patch, eventType, message };
}
