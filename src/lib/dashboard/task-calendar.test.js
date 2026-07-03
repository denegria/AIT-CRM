import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTaskCalendarEvents,
  isOpenTask,
  taskDueKey,
} from './task-calendar.js';

test('task due key normalizes task date values for calendar grouping', () => {
  assert.equal(taskDueKey({ dueAt: '2026-06-12T09:00:00.000Z' }), '2026-06-12');
  assert.equal(taskDueKey({ dueDate: '2026-06-13' }), '2026-06-13');
});

test('task calendar events include open recurring task due dates', () => {
  const events = buildTaskCalendarEvents([
    {
      id: 'task-recurring',
      title: 'Daily account check-in',
      description: 'Review open lead handoffs.',
      status: 'open',
      dueAt: '2026-06-12T09:00:00.000Z',
      businessUnitId: 'bu-usa',
      metadataJson: {
        recurrence: { frequency: 'daily', interval: 1, active: true },
      },
    },
    {
      id: 'task-completed',
      title: 'Completed item',
      status: 'completed',
      dueAt: '2026-06-12T09:00:00.000Z',
    },
  ]);

  assert.deepEqual(events, [
    {
      id: 'task-task-recurring',
      title: 'Task: Daily account check-in',
      description: 'Review open lead handoffs.',
      date: '2026-06-12',
      type: 'deadline',
      href: '/tasks/task-recurring',
      contactId: '',
      businessUnitId: 'bu-usa',
    },
  ]);
});

test('closed tasks are excluded from task calendar events', () => {
  assert.equal(isOpenTask({ status: 'canceled' }), false);
  assert.equal(isOpenTask({ completed: true }), false);
  assert.equal(isOpenTask({ status: 'open' }), true);
});
