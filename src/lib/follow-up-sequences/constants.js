export const FOLLOW_UP_SEQUENCE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
});

export const FOLLOW_UP_ENROLLMENT_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
});

export const FOLLOW_UP_STEP_ACTIONS = Object.freeze({
  TASK: 'task',
  DRAFT: 'draft',
  TASK_AND_DRAFT: 'task_and_draft',
});

export const FOLLOW_UP_STEP_RUN_STATUSES = Object.freeze({
  CREATED: 'created',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

export const FOLLOW_UP_BLOCK_CODES = Object.freeze({
  CHANNEL_UNSUPPORTED: 'channel_unsupported',
  CONTACT_BLOCKED: 'contact_blocked',
  ENROLLMENT_NOT_ACTIVE: 'enrollment_not_active',
  MAX_TOUCHES_REACHED: 'max_touches_reached',
  MESSENGER_WINDOW_CLOSED: 'messenger_window_closed',
  PRIOR_INBOUND_REQUIRED: 'prior_inbound_required',
  QUIET_HOURS: 'quiet_hours',
  SEQUENCE_NOT_ACTIVE: 'sequence_not_active',
  STEP_NOT_ACTIVE: 'step_not_active',
  TEMPLATE_MISSING: 'template_missing',
  TEMPLATE_NOT_ENABLED: 'template_not_enabled',
  TEMPLATE_NOT_APPROVED: 'template_not_approved',
});

export const FOLLOW_UP_TRIGGER_TYPES = Object.freeze({
  MANUAL: 'manual',
  NEW_LEAD: 'new_lead',
  NO_RESPONSE: 'no_response',
});

export const FOLLOW_UP_SOURCE = 'follow_up_sequence';

export const FOLLOW_UP_SERVICE_WINDOW_HOURS = 24;

export const FOLLOW_UP_SUPPORTED_CHANNELS = Object.freeze(['messenger', 'whatsapp']);

export function isSupportedFollowUpSequenceChannel(value) {
  return FOLLOW_UP_SUPPORTED_CHANNELS.includes(String(value || '').trim().toLowerCase());
}
