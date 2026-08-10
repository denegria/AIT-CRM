import {
  FOLLOW_UP_CHANNEL_VALUES,
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_OUTCOME_VALUES,
  TASK_TYPES,
} from './constants.js';
import {
  normalizeLifecycleStatus,
  workflowKeyForBusinessUnit,
  WORKFLOW_KEYS,
} from '../crm/lifecycle.js';

const FOLLOW_UP_OUTCOME_LABELS = Object.freeze({
  [FOLLOW_UP_OUTCOMES.REACHED_INTERESTED]: 'Reached - interested',
  [FOLLOW_UP_OUTCOMES.REACHED_NOT_INTERESTED]: 'Reached - not interested',
  [FOLLOW_UP_OUTCOMES.LEFT_VOICEMAIL]: 'Left voicemail',
  [FOLLOW_UP_OUTCOMES.NO_ANSWER]: 'No answer',
  [FOLLOW_UP_OUTCOMES.WRONG_NUMBER]: 'Wrong number',
  [FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT]: 'Do not contact',
  [FOLLOW_UP_OUTCOMES.APPOINTMENT_SCHEDULED]: 'Appointment scheduled',
  [FOLLOW_UP_OUTCOMES.ENROLLED_OR_WON]: 'Enrolled / won',
  [FOLLOW_UP_OUTCOMES.NEEDS_NEXT_FOLLOW_UP]: 'Needs next follow-up',
});

function followUpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeFollowUpOutcome(value) {
  const outcome = String(value || '').trim();
  if (!outcome) {
    throw followUpError('Follow-up outcome is required.');
  }
  if (!FOLLOW_UP_OUTCOME_VALUES.includes(outcome)) {
    throw followUpError('Select a valid follow-up outcome.');
  }
  return outcome;
}

export function normalizeFollowUpChannel(value) {
  const channel = String(value || '').trim();
  if (!channel) {
    throw followUpError('Follow-up channel is required.');
  }
  if (!FOLLOW_UP_CHANNEL_VALUES.includes(channel)) {
    throw followUpError('Select a valid follow-up channel.');
  }
  return channel;
}

export function followUpOutcomeLabel(outcome) {
  return FOLLOW_UP_OUTCOME_LABELS[outcome] || cleanText(outcome).replaceAll('_', ' ');
}

export function followUpEventTypeForOutcome(outcome) {
  return `follow_up.${normalizeFollowUpOutcome(outcome)}`;
}

export function followUpOutcomeSuggestsNextDue(outcome) {
  return [
    FOLLOW_UP_OUTCOMES.NO_ANSWER,
    FOLLOW_UP_OUTCOMES.LEFT_VOICEMAIL,
    FOLLOW_UP_OUTCOMES.NEEDS_NEXT_FOLLOW_UP,
  ].includes(outcome);
}

export function followUpQuickDueDate(days, now = new Date()) {
  const offset = Number(days);
  const date = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isInteger(offset) || offset < 1 || Number.isNaN(date.getTime())) {
    throw followUpError('Quick follow-up date requires a positive day offset and valid date.');
  }
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function followUpOutcomeClosesFollowUp(outcome) {
  return [
    FOLLOW_UP_OUTCOMES.REACHED_NOT_INTERESTED,
    FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT,
    FOLLOW_UP_OUTCOMES.WRONG_NUMBER,
    FOLLOW_UP_OUTCOMES.ENROLLED_OR_WON,
  ].includes(outcome);
}

export function normalizeFollowUpCompletionPayload({
  task,
  payload = {},
  now = new Date(),
}) {
  if (task.taskType !== TASK_TYPES.FOLLOW_UP) {
    throw followUpError('Structured follow-up completion only supports follow-up tasks.');
  }

  const outcome = normalizeFollowUpOutcome(payload.outcome || payload.followUpOutcome);
  const note = cleanText(payload.note || payload.followUpNote || payload.message);
  const channel = normalizeFollowUpChannel(payload.channel || payload.followUpChannel);
  const contactMethod = cleanText(payload.contactMethod || payload.phone || payload.email);
  const closesFollowUp = followUpOutcomeClosesFollowUp(outcome);
  const nextDueAt = !closesFollowUp && (payload.nextDueAt || payload.nextFollowUpAt)
    ? parseFollowUpDateTime(payload.nextDueAt || payload.nextFollowUpAt, 'nextDueAt')
    : null;
  const occurredAt = payload.occurredAt
    ? parseFollowUpDateTime(payload.occurredAt, 'occurredAt')
    : now;
  const createNextTask = Boolean(nextDueAt);

  if (!note) {
    throw followUpError('Follow-up note is required to complete this task.');
  }
  return {
    outcome,
    outcomeLabel: followUpOutcomeLabel(outcome),
    eventType: followUpEventTypeForOutcome(outcome),
    note,
    channel,
    contactMethod,
    occurredAt,
    nextDueAt,
    createNextTask,
  };
}

export function parseFollowUpDateTime(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw followUpError(`${fieldName} must be a valid date/time.`);
  }
  return date;
}

export function followUpActivityMessage({ outcomeLabel, note, nextDueAt }) {
  const parts = [`Follow-up completed: ${outcomeLabel}.`];
  if (note) parts.push(note);
  if (nextDueAt) {
    parts.push(`Next follow-up ${nextDueAt.toISOString().slice(0, 10)}.`);
  }
  return parts.join(' ');
}

export function contactPatchForFollowUpOutcome(outcome, now = new Date()) {
  if (outcome === FOLLOW_UP_OUTCOMES.WRONG_NUMBER) {
    return { isWrongNumber: true, updatedAt: now };
  }
  if (outcome === FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT) {
    return { isDoNotCall: true, updatedAt: now };
  }
  return null;
}

export function leadStatusForFollowUpOutcome(outcome, businessUnit = null) {
  const workflowKey = workflowKeyForBusinessUnit(businessUnit);
  if ([
    FOLLOW_UP_OUTCOMES.REACHED_INTERESTED,
    FOLLOW_UP_OUTCOMES.LEFT_VOICEMAIL,
    FOLLOW_UP_OUTCOMES.APPOINTMENT_SCHEDULED,
    FOLLOW_UP_OUTCOMES.NEEDS_NEXT_FOLLOW_UP,
  ].includes(outcome)) {
    return normalizeLifecycleStatus('follow up', { workflowKey }) ||
      normalizeLifecycleStatus('contacted', { workflowKey });
  }
  if (outcome === FOLLOW_UP_OUTCOMES.ENROLLED_OR_WON) {
    return normalizeLifecycleStatus('won', { workflowKey });
  }
  if (
    workflowKey === WORKFLOW_KEYS.AIT_USA &&
    [FOLLOW_UP_OUTCOMES.REACHED_NOT_INTERESTED, FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT].includes(outcome)
  ) {
    return normalizeLifecycleStatus('not interested', { workflowKey });
  }
  if (
    workflowKey === WORKFLOW_KEYS.DEFAULT &&
    [FOLLOW_UP_OUTCOMES.REACHED_NOT_INTERESTED, FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT].includes(outcome)
  ) {
    return normalizeLifecycleStatus('lost', { workflowKey });
  }
  return null;
}
