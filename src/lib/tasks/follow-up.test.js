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
  followUpOutcomeClosesFollowUp,
  followUpOutcomeSuggestsNextDue,
  followUpQuickDueDate,
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
      channel: 'phone',
      contactMethod: '732-555-0100',
      nextDueAt: '2026-06-04T13:00:00.000Z',
    },
    now,
  });

  assert.equal(payload.outcome, FOLLOW_UP_OUTCOMES.REACHED_INTERESTED);
  assert.equal(payload.eventType, 'follow_up.reached_interested');
  assert.equal(payload.note, 'Asked for a call back tomorrow.');
  assert.equal(payload.channel, 'phone');
  assert.equal(payload.contactMethod, '732-555-0100');
  assert.equal(payload.createNextTask, true);
  assert.equal(payload.nextDueAt.toISOString(), '2026-06-04T13:00:00.000Z');
});

test('requires a written note to complete follow-up tasks', () => {
  assert.throws(
    () => normalizeFollowUpCompletionPayload({
      task: followUpTask(),
      payload: { outcome: FOLLOW_UP_OUTCOMES.NO_ANSWER },
      now,
    }),
    /Follow-up note is required/,
  );
});

test('continuation outcomes recommend but do not require a next date', () => {
  for (const outcome of [
    FOLLOW_UP_OUTCOMES.NO_ANSWER,
    FOLLOW_UP_OUTCOMES.LEFT_VOICEMAIL,
    FOLLOW_UP_OUTCOMES.NEEDS_NEXT_FOLLOW_UP,
  ]) {
    assert.equal(followUpOutcomeSuggestsNextDue(outcome), true);
    const payload = normalizeFollowUpCompletionPayload({
      task: followUpTask(),
      payload: { outcome, note: 'Continue outreach.' },
      now,
    });
    assert.equal(payload.nextDueAt, null);
    assert.equal(payload.createNextTask, false);
  }
  assert.equal(followUpOutcomeSuggestsNextDue(FOLLOW_UP_OUTCOMES.REACHED_INTERESTED), false);
});

test('quick due dates offer tomorrow, two-day, and three-day choices', () => {
  const reference = new Date('2026-07-21T12:00:00.000Z');
  assert.equal(followUpQuickDueDate(1, reference), '2026-07-22');
  assert.equal(followUpQuickDueDate(2, reference), '2026-07-23');
  assert.equal(followUpQuickDueDate(3, reference), '2026-07-24');
});

test('closed follow-up outcomes do not create another follow-up task', () => {
  const payload = normalizeFollowUpCompletionPayload({
    task: followUpTask(),
    payload: {
      outcome: FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT,
      note: 'Asked not to be contacted again.',
      nextDueAt: '2026-06-04T13:00:00.000Z',
    },
    now,
  });

  assert.equal(payload.createNextTask, false);
  assert.equal(payload.nextDueAt, null);
  assert.equal(followUpOutcomeClosesFollowUp(FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT), true);
  assert.equal(followUpOutcomeClosesFollowUp(FOLLOW_UP_OUTCOMES.NO_ANSWER), false);
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
    'Not Interested',
  );
  assert.equal(
    leadStatusForFollowUpOutcome(FOLLOW_UP_OUTCOMES.DO_NOT_CONTACT, { name: 'AIT USA Institute' }),
    'Not Interested',
  );
});

test('rejects structured completion for non-follow-up tasks', () => {
  assert.throws(
    () => normalizeFollowUpCompletionPayload({
      task: followUpTask({ taskType: TASK_TYPES.MANUAL_REMINDER }),
      payload: { outcome: FOLLOW_UP_OUTCOMES.NO_ANSWER, note: 'No answer.' },
      now,
    }),
    /only supports follow-up tasks/,
  );
});
