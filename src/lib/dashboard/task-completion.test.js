import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  completeDashboardTaskAndReload,
  requestDashboardTaskCompletion,
  runDashboardTaskCompletion,
} from './task-completion.js';

const taskId = 'fd4dff2a-a70d-4c94-b03d-7734202d58bf';

function response({ ok = true, payload = {} } = {}) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test('Dashboard completion submits only the task id and existing complete action', async () => {
  const requests = [];
  const receipt = await requestDashboardTaskCompletion(taskId, {
    fetcher: async (...args) => {
      requests.push(args);
      return response({
        payload: {
          task: {
            id: taskId,
            status: 'completed',
            completedAt: '2026-08-10T12:00:00.000Z',
            updatedAt: '2026-08-10T12:00:00.000Z',
            organizationId: 'must-not-cross-the-dashboard-boundary',
            auditEvents: [{ actorUserId: 'other-employee' }],
            secret: 'must-not-cross-the-dashboard-boundary',
          },
          employees: [{ id: 'other-employee' }],
        },
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/tasks');
  assert.deepEqual(requests[0][1], {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: taskId, action: 'complete' }),
  });
  assert.deepEqual(receipt, {
    id: taskId,
    status: 'completed',
    completedAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  });
  for (const forbidden of ['organizationId', 'auditEvents', 'secret', 'employees', 'contactId']) {
    assert.equal(Object.hasOwn(receipt, forbidden), false);
  }
});

test('Dashboard completion resolves only after reload returns the persisted completed task', async () => {
  const reloadCalls = [];
  const reloadedTask = {
    id: taskId,
    status: 'completed',
    taskStatus: 'completed',
    completed: true,
  };
  const result = await completeDashboardTaskAndReload({
    taskId,
    fetcher: async () => response({ payload: { task: { id: taskId, status: 'completed' } } }),
    reloadTasks: async (options) => {
      reloadCalls.push(options);
      return [reloadedTask];
    },
  });

  assert.deepEqual(reloadCalls, [{ force: true }]);
  assert.equal(result, reloadedTask);
});

test('rejected completion stays failed and does not run a success reload', async () => {
  let reloadCount = 0;
  await assert.rejects(
    completeDashboardTaskAndReload({
      taskId,
      fetcher: async () => response({
        ok: false,
        payload: {
          error: 'Regular coordinators can only access tasks assigned to them.',
          task: { id: 'other-task', contactId: 'unrelated-contact' },
          auditDetails: { actorUserId: 'other-employee' },
        },
      }),
      reloadTasks: async () => {
        reloadCount += 1;
        return [];
      },
    }),
    /Regular coordinators can only access tasks assigned to them/,
  );
  assert.equal(reloadCount, 0);
});

test('completion fails closed when reload does not confirm the completed state', async () => {
  await assert.rejects(
    completeDashboardTaskAndReload({
      taskId,
      fetcher: async () => response({ payload: { task: { id: taskId, status: 'completed' } } }),
      reloadTasks: async () => [{ id: taskId, status: 'open', completed: false }],
    }),
    /could not be confirmed after reload/,
  );
});

test('unavailable durable persistence produces an error state without any local task mutation', async () => {
  let fetchCount = 0;
  let reloadCount = 0;
  const states = [];

  await assert.rejects(
    runDashboardTaskCompletion({
      taskId,
      complete: () => completeDashboardTaskAndReload({
        taskId,
        dataSource: 'local',
        fetcher: async () => {
          fetchCount += 1;
          return response({ payload: { task: { id: taskId, status: 'completed' } } });
        },
        reloadTasks: async () => {
          reloadCount += 1;
          return [{ id: taskId, status: 'completed' }];
        },
      }),
      onStateChange: (state) => states.push(state),
    }),
    /unavailable until the CRM reconnects to durable storage/,
  );

  assert.equal(fetchCount, 0);
  assert.equal(reloadCount, 0);
  assert.deepEqual(states, [
    { status: 'pending', error: '' },
    {
      status: 'error',
      error: 'Task completion is unavailable until the CRM reconnects to durable storage. The task remains open.',
    },
  ]);

  const dashboardSource = fs.readFileSync(new URL('../../app/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboardSource, /\bupdateTask\b/);
  assert.match(dashboardSource, /completeDashboardTaskAndReload\(\{\s*taskId,\s*dataSource,\s*reloadTasks: loadTasks,/s);
});

test('completion interaction exposes pending then success or failure without swallowing the error', async () => {
  const successStates = [];
  const completedTask = { id: taskId, status: 'completed', completed: true };
  const result = await runDashboardTaskCompletion({
    taskId,
    complete: async () => completedTask,
    onStateChange: (state) => successStates.push(state),
  });
  assert.equal(result, completedTask);
  assert.deepEqual(successStates, [
    { status: 'pending', error: '' },
    { status: 'success', error: '' },
  ]);

  const failureStates = [];
  await assert.rejects(
    runDashboardTaskCompletion({
      taskId,
      complete: async () => { throw new Error('Task update rejected.'); },
      onStateChange: (state) => failureStates.push(state),
    }),
    /Task update rejected/,
  );
  assert.deepEqual(failureStates, [
    { status: 'pending', error: '' },
    { status: 'error', error: 'Task update rejected.' },
  ]);
});
