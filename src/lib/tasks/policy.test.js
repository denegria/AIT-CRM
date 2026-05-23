import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_EVENT_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
} from './constants.js';
import {
  buildTaskTransition,
  normalizeTaskPriority,
  normalizeTaskType,
  parseTaskStatusFilter,
  parseTaskTypeFilter,
} from './policy.js';

function task(overrides = {}) {
  return {
    id: 'task-1',
    status: TASK_STATUSES.OPEN,
    ownerUserId: 'user-1',
    dueAt: new Date('2026-05-23T12:00:00.000Z'),
    ...overrides,
  };
}

test('normalizes task type and priority to safe defaults', () => {
  assert.equal(normalizeTaskType(TASK_TYPES.FOLLOW_UP), TASK_TYPES.FOLLOW_UP);
  assert.equal(normalizeTaskType('not-real'), TASK_TYPES.MANUAL_REMINDER);
  assert.equal(normalizeTaskPriority('HIGH'), 'high');
  assert.equal(normalizeTaskPriority('not-real'), 'medium');
});

test('rejects invalid task list filters instead of silently defaulting', () => {
  assert.equal(parseTaskStatusFilter(TASK_STATUSES.OPEN), TASK_STATUSES.OPEN);
  assert.equal(parseTaskStatusFilter(''), '');
  assert.equal(parseTaskTypeFilter(TASK_TYPES.FOLLOW_UP), TASK_TYPES.FOLLOW_UP);
  assert.equal(parseTaskTypeFilter(null), '');

  assert.throws(
    () => parseTaskStatusFilter('not-real'),
    /Invalid task status filter/,
  );
  assert.throws(
    () => parseTaskTypeFilter('not-real'),
    /Invalid task type filter/,
  );
});

test('builds complete transition patch with audit event metadata', () => {
  const now = new Date('2026-05-23T16:00:00.000Z');
  const result = buildTaskTransition({
    task: task({ status: TASK_STATUSES.IN_PROGRESS }),
    action: 'complete',
    now,
  });

  assert.equal(result.eventType, TASK_EVENT_TYPES.COMPLETED);
  assert.equal(result.message, 'Completed task.');
  assert.deepEqual(result.patch, {
    updatedAt: now,
    status: TASK_STATUSES.COMPLETED,
    completedAt: now,
    canceledAt: null,
  });
});

test('requires a target time when snoozing a task', () => {
  assert.throws(
    () => buildTaskTransition({ task: task(), action: 'snooze', payload: {} }),
    /snoozedUntil must be provided/,
  );
});

test('prevents mutating closed tasks before explicit reopen', () => {
  assert.throws(
    () => buildTaskTransition({
      task: task({ status: TASK_STATUSES.COMPLETED }),
      action: 'assign',
      payload: { ownerUserId: 'user-2' },
    }),
    /must be reopened/,
  );
});

test('allows explicit reopen from closed status', () => {
  const now = new Date('2026-05-23T17:00:00.000Z');
  const result = buildTaskTransition({
    task: task({ status: TASK_STATUSES.CANCELED }),
    action: 'reopen',
    now,
  });

  assert.equal(result.eventType, TASK_EVENT_TYPES.STARTED);
  assert.equal(result.message, 'Reopened task.');
  assert.deepEqual(result.patch, {
    updatedAt: now,
    status: TASK_STATUSES.OPEN,
    completedAt: null,
    canceledAt: null,
    snoozedUntil: null,
  });
});
