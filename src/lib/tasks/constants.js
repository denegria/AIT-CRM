export const TASK_TYPES = Object.freeze({
  FIRST_OUTREACH: 'first_outreach',
  FOLLOW_UP: 'follow_up',
  APPOINTMENT: 'appointment',
  DOCUMENT_REQUEST: 'document_request',
  PAYMENT_FOLLOW_UP: 'payment_follow_up',
  MANUAL_REMINDER: 'manual_reminder',
  ARCHIVE_APPROVAL: 'archive_approval',
  TASK_REMOVAL_APPROVAL: 'task_removal_approval',
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
  UPDATED: 'updated',
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

export const FOLLOW_UP_OUTCOMES = Object.freeze({
  REACHED_INTERESTED: 'reached_interested',
  REACHED_NOT_INTERESTED: 'reached_not_interested',
  LEFT_VOICEMAIL: 'left_voicemail',
  NO_ANSWER: 'no_answer',
  WRONG_NUMBER: 'wrong_number',
  DO_NOT_CONTACT: 'do_not_contact',
  APPOINTMENT_SCHEDULED: 'appointment_scheduled',
  ENROLLED_OR_WON: 'enrolled_or_won',
  NEEDS_NEXT_FOLLOW_UP: 'needs_next_follow_up',
});

export const TASK_RECURRENCE_FREQUENCIES = Object.freeze({
  NONE: 'none',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
});

export const TASK_TYPE_VALUES = Object.freeze(Object.values(TASK_TYPES));
export const TASK_STATUS_VALUES = Object.freeze(Object.values(TASK_STATUSES));
export const TASK_PRIORITY_VALUES = Object.freeze(Object.values(TASK_PRIORITIES));
export const TASK_EVENT_TYPE_VALUES = Object.freeze(Object.values(TASK_EVENT_TYPES));
export const TASK_SOURCE_TYPE_VALUES = Object.freeze(Object.values(TASK_SOURCE_TYPES));
export const FOLLOW_UP_OUTCOME_VALUES = Object.freeze(Object.values(FOLLOW_UP_OUTCOMES));
export const TASK_RECURRENCE_FREQUENCY_VALUES = Object.freeze(Object.values(TASK_RECURRENCE_FREQUENCIES));

export const DEFAULT_TASK_STATUS = TASK_STATUSES.OPEN;
export const DEFAULT_TASK_PRIORITY = TASK_PRIORITIES.MEDIUM;
export const DEFAULT_TASK_RECURRENCE_FREQUENCY = TASK_RECURRENCE_FREQUENCIES.NONE;
