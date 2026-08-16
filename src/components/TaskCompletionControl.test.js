import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  completeDashboardTaskAndReload,
  createDashboardTaskCompletionController,
} from '../lib/dashboard/task-completion.js';
import { TaskCompletionControl } from './TaskCompletionControl.js';

const styles = {
  actionCell: 'action-cell',
  actionError: 'action-error',
  actionStatus: 'action-status',
  check: 'check',
  checked: 'checked',
};
const task = {
  id: 'fd4dff2a-a70d-4c94-b03d-7734202d58bf',
  title: 'Call student',
  status: 'open',
  completed: false,
  updatedAt: '2026-08-10T11:59:00.000Z',
};

function render(props = {}) {
  return renderToStaticMarkup(createElement(TaskCompletionControl, {
    task,
    styles,
    ...props,
  }));
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function response(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test('Dashboard task control renders open, pending, success, and failure states', () => {
  const open = render();
  assert.match(open, /aria-label="Mark task complete: Call student"/);
  assert.doesNotMatch(open, /disabled/);

  const pending = render({ mutation: { status: 'pending', error: '' } });
  assert.match(pending, /disabled/);
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /role="status"/);
  assert.match(pending, /Saving…/);

  const success = render({ mutation: { status: 'success', error: '' } });
  assert.match(success, /role="status"/);
  assert.match(success, /Saved/);

  const failure = render({ mutation: { status: 'error', error: 'Task update rejected.' } });
  assert.match(failure, /role="alert"/);
  assert.match(failure, /Task update rejected/);
  assert.doesNotMatch(failure, /disabled/);
  assert.match(failure, /Mark task complete/);
});

test('reload-backed completed task renders as completed instead of local pending state', () => {
  const reloaded = render({
    task: {
      ...task,
      status: 'completed',
      taskStatus: 'completed',
      completed: true,
      completedAt: '2026-08-10T12:00:00.000Z',
    },
    mutation: { status: 'idle', error: '' },
  });

  assert.match(reloaded, /class="check checked"/);
  assert.match(reloaded, /aria-label="Task completed: Call student"/);
  assert.match(reloaded, />✓<\/button>/);
  assert.doesNotMatch(reloaded, /Saving|Task update rejected/);
});

test('TaskList completion controller renders pending, reload-backed success, open failure, and different-row overlap', async () => {
  const taskA = { ...task, id: 'task-a', title: 'Call student A' };
  const taskB = { ...task, id: 'task-b', title: 'Call student B' };
  const tasks = { [taskA.id]: taskA, [taskB.id]: taskB };
  const rendered = {};
  const successReload = deferred();
  const failureResponse = deferred();
  let taskACompletionCalls = 0;
  let duplicateTaskACalls = 0;
  let taskBCompletionCalls = 0;

  const controller = createDashboardTaskCompletionController({
    onStateChange: (taskId, mutation) => {
      rendered[taskId] = render({ task: tasks[taskId], mutation });
    },
  });

  const completionA = controller.submit({
    taskId: taskA.id,
    complete: () => {
      taskACompletionCalls += 1;
      return completeDashboardTaskAndReload({
        taskId: taskA.id,
        expectedUpdatedAt: taskA.updatedAt,
        fetcher: async () => response({ task: { id: taskA.id, status: 'completed' } }),
        reloadTasks: async () => {
          await successReload.promise;
          tasks[taskA.id] = { ...taskA, status: 'completed', taskStatus: 'completed', completed: true };
          return Object.values(tasks);
        },
      });
    },
  });
  const duplicateA = controller.submit({
    taskId: taskA.id,
    complete: async () => {
      duplicateTaskACalls += 1;
      return null;
    },
  });
  const completionB = controller.submit({
    taskId: taskB.id,
    complete: async () => {
      taskBCompletionCalls += 1;
      await failureResponse.promise;
      throw new Error('Task update rejected.');
    },
  });
  const failureAssertion = assert.rejects(completionB, /Task update rejected/);

  assert.equal(duplicateA, completionA);
  assert.equal(taskACompletionCalls, 1);
  assert.equal(duplicateTaskACalls, 0);
  assert.equal(taskBCompletionCalls, 1);
  assert.match(rendered[taskA.id], /disabled/);
  assert.match(rendered[taskA.id], /Saving…/);
  assert.match(rendered[taskB.id], /disabled/);
  assert.match(rendered[taskB.id], /Saving…/);

  successReload.resolve();
  await completionA;
  assert.match(rendered[taskA.id], /class="check checked"/);
  assert.match(rendered[taskA.id], /Saved/);

  failureResponse.resolve();
  await failureAssertion;
  assert.match(rendered[taskB.id], /role="alert"/);
  assert.match(rendered[taskB.id], /Task update rejected/);
  assert.match(rendered[taskB.id], /Mark task complete: Call student B/);
  assert.doesNotMatch(rendered[taskB.id], /disabled/);

  const taskListSource = fs.readFileSync(new URL('./TaskList.js', import.meta.url), 'utf8');
  assert.match(taskListSource, /createDashboardTaskCompletionController/);
  assert.match(taskListSource, /taskCompletionController\.submit\(\{/);
});
