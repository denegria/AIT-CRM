import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTaskCompletedToday,
  isTaskCurrentWork,
  isTaskDueToday,
  isTaskOpen,
  isTaskOverdue,
  isTaskUpcoming,
  taskDueKey,
} from './visibility.js';

const today = '2026-06-13';

test('current work includes open tasks due today or earlier', () => {
  assert.equal(isTaskCurrentWork({ status: 'open', dueAt: '2026-06-13T09:00:00.000Z' }, today), true);
  assert.equal(isTaskCurrentWork({ status: 'in_progress', dueAt: '2026-06-12T09:00:00.000Z' }, today), true);
  assert.equal(isTaskDueToday({ status: 'open', dueDate: '2026-06-13' }, today), true);
  assert.equal(isTaskOverdue({ status: 'open', dueAt: '2026-06-12T09:00:00.000Z' }, today), true);
});

test('next recurring occurrence is upcoming, not current work', () => {
  const nextDailyTask = {
    status: 'open',
    dueAt: '2026-06-14T09:00:00.000Z',
    metadataJson: {
      recurrence: { frequency: 'daily', interval: 1, active: true },
    },
  };

  assert.equal(taskDueKey(nextDailyTask), '2026-06-14');
  assert.equal(isTaskCurrentWork(nextDailyTask, today), false);
  assert.equal(isTaskUpcoming(nextDailyTask, today), true);
});

test('completed daily task stays in done-today backlog only', () => {
  const completedTask = {
    status: 'completed',
    completedAt: '2026-06-13T15:30:00.000Z',
    dueAt: '2026-06-13T09:00:00.000Z',
  };

  assert.equal(isTaskOpen(completedTask), false);
  assert.equal(isTaskCurrentWork(completedTask, today), false);
  assert.equal(isTaskCompletedToday(completedTask, today), true);
});

test('closed tasks are excluded from active visibility buckets', () => {
  assert.equal(isTaskCurrentWork({ status: 'canceled', dueDate: today }, today), false);
  assert.equal(isTaskDueToday({ completed: true, dueDate: today }, today), false);
  assert.equal(isTaskUpcoming({ status: 'completed', dueDate: '2026-06-14' }, today), false);
});
