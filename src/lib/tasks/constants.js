export const TASK_TYPES = Object.freeze({
  FIRST_OUTREACH: 'first_outreach',
  FOLLOW_UP: 'follow_up',
  APPOINTMENT: 'appointment',
  DOCUMENT_REQUEST: 'document_request',
  PAYMENT_FOLLOW_UP: 'payment_follow_up',
  MANUAL_REMINDER: 'manual_reminder',
});

export const TASK_STATUSES = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  SNOOZED: 'snoozed',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
});

export const TASK_PRIORITIES = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
});

export const TASK_EVENT_TYPES = Object.freeze({
  CREATED: 'created',
  ASSIGNED: 'assigned',
  DUE_DATE_CHANGED: 'due_date_changed',
  SNOOZED: 'snoozed',
  STARTED: 'started',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
  AUTOMATION_ACTION: 'automation_action',
});

export const TASK_SOURCE_TYPES = Object.freeze({
  MANUAL: 'manual',
  IMPORT: 'import',
  WEBHOOK: 'webhook',
  AUTOMATION: 'automation',
  SEQUENCE: 'sequence',
  SYSTEM: 'system',
});

export const TASK_TYPE_VALUES = Object.freeze(Object.values(TASK_TYPES));
export const TASK_STATUS_VALUES = Object.freeze(Object.values(TASK_STATUSES));
export const TASK_PRIORITY_VALUES = Object.freeze(Object.values(TASK_PRIORITIES));
export const TASK_EVENT_TYPE_VALUES = Object.freeze(Object.values(TASK_EVENT_TYPES));
export const TASK_SOURCE_TYPE_VALUES = Object.freeze(Object.values(TASK_SOURCE_TYPES));

export const DEFAULT_TASK_STATUS = TASK_STATUSES.OPEN;
export const DEFAULT_TASK_PRIORITY = TASK_PRIORITIES.MEDIUM;
