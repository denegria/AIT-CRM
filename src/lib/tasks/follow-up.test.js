import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_UP_OUTCOMES,
  TASK_TYPES,
} from './constants.js';
import {
  contactPatchForFollowUpOutcome,
  followUpActivityMessage,
  followUpEventTypeForOutcome,
  leadStatusForFollowUpOutcome,
  normalizeFollowUpCompletionPayload,
} from './follow-up.js';

const now = new Date('2026-06-03T14:00:00.000Z');

function followUpTask(overrides = {}) {
  return {
    id: 'task-1',
    taskType: TASK_TYPES.FOLLOW_UP,
    ...overrides,
  };
}

test('normalizes structured follow-up completion payloads', () => {
  const payload = normalizeFollowUpCompletionPayload({
    task: followUpTask(),
    payload: {
      outcome: FOLLOW_UP_OUTCOMES.REACHED_INTERESTED,
      note: '  Asked for a call back tomorrow.  ',
      nextDueAt: '2026-06-04T13:00:00.000Z',
    },
    now,
  });

  assert.equal(payload.outcome, FOLLOW_UP_OUTCOMES.REACHED_INTERESTED);
  assert.equal(payload.eventType, 'follow_up.reached_interested');
  assert.equal(payload.note, 'Asked for a call back tomorrow.');
  assert.equal(payload.createNextTask, true);
  assert.equal(payload.nextDueAt.toISOString(), '2026-06-04T13:00:00.000Z');
});

test('requires next date for explicit next-follow-up outcome', () => {
  assert.throws(
    () => normalizeFollowUpCompletionPayload({
      task: followUpTask(),
      payload: { outcome: FOLLOW_UP_OUTCOMES.NEEDS_NEXT_FOLLOW_UP },
      now,
    }),
    /Next follow-up date is required/,
  );
});

test('maps follow-up outcomes to stable event types and readable messages', () => {
  assert.equal(
    followUpEventTypeForOutcome(FOLLOW_UP_OUTCOMES.WRONG_NUMBER),
    'follow_up.wrong_number',
  );
  assert.equal(
    followUpActivityMessage({
      outcomeLabel: 'Wrong number',
      note: 'Phone belongs to a different person.',
      nextDueAt: null,
    }),
    'Follow-up completed: Wrong number. Phone belongs to a different person.',
  );
});

test('keeps lifecycle updates conservative and explicit', () => {
  assert.deepEqual(
    contactPatchForFollowUpOutcome(FOLLOW_UP_OUTCOMES.WRONG_NUMBER, now),
    { isWrongNumber: true, updatedAt: now },
  );
  assert.deepEqual(
    contactPatchForFollowUpOutcome(FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT, now),
    { isDoNotCall: true, updatedAt: now },
  );
  assert.equal(
    leadStatusForFollowUpOutcome(FOLLOW_UP_OUTCOMES.REACHED_INTERESTED, { name: 'AIT USA Institute' }),
    'Follow Up',
  );
  assert.equal(
    leadStatusForFollowUpOutcome(FOLLOW_UP_OUTCOMES.ENROLLED_OR_WON, { name: 'AIT USA Institute' }),
    'Enrolled',
  );
  assert.equal(
    leadStatusForFollowUpOutcome(FOLLOW_UP_OUTCOMES.REACHED_NOT_INTERESTED, { name: 'AIT USA Institute' }),
    null,
  );
});

test('rejects structured completion for non-follow-up tasks', () => {
  assert.throws(
    () => normalizeFollowUpCompletionPayload({
      task: followUpTask({ taskType: TASK_TYPES.MANUAL_REMINDER }),
      payload: { outcome: FOLLOW_UP_OUTCOMES.NO_ANSWER },
      now,
    }),
    /only supports follow-up tasks/,
  );
});
