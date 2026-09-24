import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDetailHref, taskQueueHref, taskQueueReturnHref } from './queue-navigation.js';

test('task detail carries the employee queue filters into a safe return URL', () => {
  const queueHref = taskQueueHref({
    due: 'overdue',
    ownerUserId: '__me',
    taskType: 'follow_up',
    status: 'open',
    link: 'contact',
  }, 'bu-usa');
  const detailUrl = new URL(taskDetailHref('task-1', queueHref), 'https://crm.test');

  assert.equal(detailUrl.pathname, '/tasks/task-1');
  assert.equal(detailUrl.searchParams.get('returnTo'), queueHref);
  assert.equal(taskQueueReturnHref(queueHref, 'bu-usa'), queueHref);
});

test('task return URL discards other paths and enforces the authorized task division', () => {
  assert.equal(
    taskQueueReturnHref('/tasks?businessUnitId=bu-signs&due=today&link=contact', 'bu-usa'),
    '/tasks?businessUnitId=bu-usa&due=today&link=contact',
  );
  assert.equal(taskQueueReturnHref('//evil.example/tasks?due=overdue', 'bu-usa'), '/tasks?businessUnitId=bu-usa');
  assert.equal(taskQueueReturnHref('/contacts?due=overdue', 'bu-usa'), '/tasks?businessUnitId=bu-usa');
});
