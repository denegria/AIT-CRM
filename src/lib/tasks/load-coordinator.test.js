import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { completeDashboardTaskAndReload } from '../dashboard/task-completion.js';
import { createTaskLoadCoordinator } from './load-coordinator.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function response(task) {
  return {
    ok: true,
    async json() {
      return { task };
    },
  };
}

test('normal task loads coalesce while force queues at most one fresh successor', async () => {
  const coordinator = createTaskLoadCoordinator();
  const firstGate = deferred();
  const executions = [];
  const first = coordinator.run(async () => {
    executions.push('first');
    return firstGate.promise;
  });
  await Promise.resolve();

  const normal = coordinator.run(async () => {
    throw new Error('normal overlap must reuse the active load');
  });
  const forced = coordinator.run(async () => {
    executions.push('forced');
    return ['fresh'];
  }, { force: true });
  const coalescedForce = coordinator.run(async () => {
    throw new Error('queued force overlap must reuse the fresh successor');
  }, { force: true });

  assert.equal(normal, first);
  assert.equal(coalescedForce, forced);
  assert.deepEqual(executions, ['first']);

  firstGate.resolve(['initial']);
  assert.deepEqual(await first, ['initial']);
  assert.deepEqual(await forced, ['fresh']);
  assert.deepEqual(executions, ['first', 'forced']);

  const storeSource = fs.readFileSync(new URL('../store.js', import.meta.url), 'utf8');
  assert.match(storeSource, /createTaskLoadCoordinator/);
  assert.match(storeSource, /tasksLoadCoordinator\.run\(\(\) => \{/);
  assert.match(storeSource, /\}, \{ force \}\);/);
  assert.doesNotMatch(storeSource, /tasksLoadPromiseRef/);
});

test('normal caller in the predecessor handoff joins the reserved forced successor', async () => {
  const coordinator = createTaskLoadCoordinator();
  const firstGate = deferred();
  const executions = [];
  let normalPromise;

  const first = coordinator.run(async () => {
    executions.push('first-start');
    await firstGate.promise;
    executions.push('first-end');
    return ['initial'];
  });
  await Promise.resolve();

  const normalHandoff = first.then(() => {
    normalPromise = coordinator.run(async () => {
      executions.push('normal-start');
      return ['parallel-stale'];
    });
    return normalPromise;
  });
  const forced = coordinator.run(async () => {
    executions.push('forced-start');
    executions.push('forced-end');
    return ['fresh'];
  }, { force: true });

  firstGate.resolve();
  const [normalResult, forcedResult] = await Promise.all([normalHandoff, forced]);

  assert.equal(normalPromise, forced);
  assert.deepEqual(normalResult, ['fresh']);
  assert.deepEqual(forcedResult, ['fresh']);
  assert.deepEqual(executions, [
    'first-start',
    'first-end',
    'forced-start',
    'forced-end',
  ]);
});

test('queued force refresh recovers after predecessor failure and releases the reservation', async () => {
  const coordinator = createTaskLoadCoordinator();
  const firstGate = deferred();
  const executions = [];
  const first = coordinator.run(async () => {
    executions.push('failed-start');
    await firstGate.promise;
    executions.push('failed-end');
    throw new Error('Initial task load failed.');
  });
  const firstFailure = assert.rejects(first, /Initial task load failed/);
  await Promise.resolve();

  const forced = coordinator.run(async () => {
    executions.push('forced-recovery');
    return ['recovered'];
  }, { force: true });
  const coalescedNormal = coordinator.run(async () => {
    throw new Error('normal caller must join queued recovery');
  });

  firstGate.resolve();
  await firstFailure;
  assert.equal(coalescedNormal, forced);
  assert.deepEqual(await forced, ['recovered']);

  const later = coordinator.run(async () => {
    executions.push('later-load');
    return ['later'];
  });
  assert.deepEqual(await later, ['later']);
  assert.deepEqual(executions, [
    'failed-start',
    'failed-end',
    'forced-recovery',
    'later-load',
  ]);
});

test('overlapping different-task completions each confirm against a reload started after their PATCH', async () => {
  const taskA = 'task-a';
  const taskB = 'task-b';
  const taskAVersion = '2026-08-10T11:58:00.000Z';
  const taskBVersion = '2026-08-10T11:59:00.000Z';
  let serverTasks = [
    { id: taskA, status: 'open', completed: false, updatedAt: taskAVersion },
    { id: taskB, status: 'open', completed: false, updatedAt: taskBVersion },
  ];
  let renderedTasks = serverTasks.map((task) => ({ ...task }));
  let reloadRequests = 0;
  let reloadExecutions = 0;
  const reloadSnapshots = [];
  let completionAResolved = false;
  const firstReloadStarted = deferred();
  const releaseFirstReload = deferred();
  const secondReloadRequested = deferred();
  const taskBCommitted = deferred();
  const coordinator = createTaskLoadCoordinator();

  function commit(taskId) {
    serverTasks = serverTasks.map((task) => (
      task.id === taskId
        ? { ...task, status: 'completed', completed: true, completedAt: '2026-08-10T12:00:00.000Z' }
        : task
    ));
    return serverTasks.find((task) => task.id === taskId);
  }

  const fetcher = async (_url, options) => {
    const { id } = JSON.parse(options.body);
    if (id === taskB) await firstReloadStarted.promise;
    const completedTask = commit(id);
    if (id === taskB) taskBCommitted.resolve();
    return response(completedTask);
  };

  const reloadTasks = (options) => {
    reloadRequests += 1;
    if (reloadRequests === 2) secondReloadRequested.resolve();
    return coordinator.run(async () => {
      reloadExecutions += 1;
      const snapshot = serverTasks.map((task) => ({ ...task }));
      reloadSnapshots.push(snapshot.map((task) => [task.id, task.status]));
      if (reloadExecutions === 1) {
        firstReloadStarted.resolve();
        await releaseFirstReload.promise;
      }
      renderedTasks = snapshot;
      return snapshot;
    }, options);
  };

  const completionA = completeDashboardTaskAndReload({
    taskId: taskA,
    expectedUpdatedAt: taskAVersion,
    fetcher,
    reloadTasks,
  });
  completionA.then(() => { completionAResolved = true; });
  const completionB = completeDashboardTaskAndReload({
    taskId: taskB,
    expectedUpdatedAt: taskBVersion,
    fetcher,
    reloadTasks,
  });

  await firstReloadStarted.promise;
  await taskBCommitted.promise;
  await secondReloadRequested.promise;
  assert.equal(completionAResolved, false, 'task A should still be waiting on its earlier reload');
  assert.deepEqual(renderedTasks.map((task) => task.status), ['open', 'open']);

  releaseFirstReload.resolve();
  const [confirmedA, confirmedB] = await Promise.all([completionA, completionB]);

  assert.equal(confirmedA.id, taskA);
  assert.equal(confirmedA.status, 'completed');
  assert.equal(confirmedB.id, taskB);
  assert.equal(confirmedB.status, 'completed');
  assert.equal(reloadRequests, 2);
  assert.equal(reloadExecutions, 2);
  assert.deepEqual(reloadSnapshots, [
    [[taskA, 'completed'], [taskB, 'open']],
    [[taskA, 'completed'], [taskB, 'completed']],
  ]);
  assert.deepEqual(renderedTasks.map((task) => [task.id, task.status]), [
    [taskA, 'completed'],
    [taskB, 'completed'],
  ]);
});
