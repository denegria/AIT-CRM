import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFollowUpSummary, scopedFollowUpTasksFromPayload } from './contact-follow-up-summary.js';

const visibleTask = Object.freeze({
  id: 'task-visible', contactId: 'contact-1', leadId: 'lead-1', taskType: 'follow_up', status: 'open',
  ownerUserId: 'owner-1', title: 'Call student', dueAt: '2026-09-16T14:00:00.000Z',
});

test('Follow-up summary uses the latest structured outcome and one exact permitted task', () => {
  const summary = buildFollowUpSummary({
    events: [
      { eventType: 'note.created', text: 'Callback requested in prose', occurredAt: '2026-09-18T10:00:00.000Z' },
      { eventType: 'follow_up.left_voicemail', metadataJson: { outcome: 'left_voicemail' }, occurredAt: '2026-09-15T10:00:00.000Z' },
    ],
    tasks: [visibleTask],
    ownerOptions: [{ id: 'owner-1', label: 'Assigned coordinator' }],
    now: new Date('2026-09-14T00:00:00.000Z'),
  });
  assert.equal(summary.latest.label, 'Left voicemail');
  assert.equal(summary.commitment.kind, 'exact');
  assert.equal(summary.commitment.task.id, 'task-visible');
  assert.equal(summary.commitment.ownerLabel, 'Assigned coordinator');
});

test('Follow-up summary preserves ambiguity, scope-safe absence, restrictions, and snoozes', () => {
  const multiple = buildFollowUpSummary({ tasks: [visibleTask, { ...visibleTask, id: 'task-2' }] });
  assert.deepEqual(multiple.commitment, { kind: 'multiple', count: 2, label: '2 follow-ups need review' });

  const regular = buildFollowUpSummary({
    events: [{ eventType: 'follow_up.no_answer', metadataJson: { outcome: 'no_answer' } }],
    isPrivileged: false,
  });
  assert.equal(regular.commitment.label, 'No follow-up assigned to you');
  assert.equal(regular.commitment.detail, 'Latest outcome suggests another follow-up');

  const blocked = buildFollowUpSummary({ tasks: [visibleTask], contactability: { canFollowUp: false } });
  assert.equal(blocked.commitment.kind, 'blocked');
  assert.equal(blocked.commitment.label, 'Outreach blocked — review task');

  const snoozed = buildFollowUpSummary({ tasks: [{ ...visibleTask, status: 'snoozed', snoozedUntil: '2026-09-20T14:00:00.000Z' }] });
  assert.equal(snoozed.commitment.label, 'Snoozed until');
  assert.equal(snoozed.commitment.dueAt, '2026-09-20T14:00:00.000Z');
  assert.equal(snoozed.commitment.originalDueAt, null, 'the task payload has no historical pre-snooze due date to display');
});

test('serialized task payload boundary ignores route users and timeline-linked task records', () => {
  const restrictedPayload = {
    tasks: [],
    users: [{ id: 'other-owner', name: 'Other employee' }],
    timeline: [{ linkedRecords: [{ type: 'task', id: 'hidden-task', label: 'Other employee task' }] }],
    completedTask: { ...visibleTask, id: 'hidden-completed-task' },
    nextTask: { ...visibleTask, id: 'hidden-next-task' },
  };
  assert.deepEqual(scopedFollowUpTasksFromPayload(restrictedPayload), []);

  const privilegedPayload = { tasks: [visibleTask], users: [{ id: 'other-owner', name: 'Unrelated employee' }] };
  assert.deepEqual(scopedFollowUpTasksFromPayload(privilegedPayload), [visibleTask]);
});
