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

test('timed follow-up calendar payload exposes only scoped scheduling identifiers and UTC instant', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const [event] = buildTaskCalendarEvents([{
      id: 'task-1', taskType: 'follow_up', status: 'open',
      title: 'Call maria@example.com at 732-555-0199',
      description: 'Private student note and 732-555-0199',
      dueAt: '2026-06-05T00:30:00.000Z',
      ownerUserId: 'user-1', contactId: 'contact-1', businessUnitId: 'bu-1',
      metadataJson: { followUpDueHasTime: true, rawAudit: 'secret' },
    }]);
    assert.deepEqual(event, {
      id: 'task-task-1', title: 'Task: Follow-up', description: '',
      dueAt: '2026-06-05T00:30:00.000Z', ownerUserId: 'user-1',
      date: '2026-06-04', type: 'deadline', href: '/tasks/task-1',
      contactId: 'contact-1', businessUnitId: 'bu-1',
    });
    assert.doesNotMatch(JSON.stringify(event), /@|555|rawAudit|secret/);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
