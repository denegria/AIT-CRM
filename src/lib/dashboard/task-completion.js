const COMPLETED_STATUS = 'completed';

function completionError(payload, fallback) {
  return typeof payload?.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : fallback;
}

function taskStatus(task = {}) {
  return String(task.status || task.taskStatus || '').trim().toLowerCase();
}

export function isPersistedTaskCompletion(task, taskId) {
  return Boolean(task && task.id === taskId && (
    taskStatus(task) === COMPLETED_STATUS || task.completed === true
  ));
}

export function toDashboardTaskCompletionReceipt(task = {}) {
  return {
    id: task.id || '',
    status: taskStatus(task),
    completedAt: task.completedAt || null,
    updatedAt: task.updatedAt || null,
  };
}

export async function requestDashboardTaskCompletion(taskId, { fetcher = globalThis.fetch } = {}) {
  if (!taskId) throw new Error('A task id is required.');

  const response = await fetcher('/api/tasks', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: taskId, action: 'complete' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(completionError(payload, 'Task could not be completed.'));
  }
  if (!isPersistedTaskCompletion(payload.task, taskId)) {
    throw new Error('Task completion response could not be verified.');
  }

  return toDashboardTaskCompletionReceipt(payload.task);
}

export async function completeDashboardTaskAndReload({
  taskId,
  dataSource = 'postgres',
  fetcher = globalThis.fetch,
  reloadTasks,
} = {}) {
  if (dataSource !== 'postgres') {
    throw new Error('Task completion is unavailable until the CRM reconnects to durable storage. The task remains open.');
  }
  if (typeof reloadTasks !== 'function') {
    throw new Error('Task reload is required after completion.');
  }

  await requestDashboardTaskCompletion(taskId, { fetcher });
  const reloadedTasks = await reloadTasks({ force: true });
  const reloadedTask = (reloadedTasks || []).find((task) => task.id === taskId);
  if (!isPersistedTaskCompletion(reloadedTask, taskId)) {
    throw new Error('Task completion could not be confirmed after reload.');
  }
  return reloadedTask;
}

export async function runDashboardTaskCompletion({ taskId, complete, onStateChange } = {}) {
  onStateChange?.({ status: 'pending', error: '' });
  try {
    const task = await complete(taskId);
    onStateChange?.({ status: 'success', error: '' });
    return task;
  } catch (error) {
    const message = error?.message || 'Task could not be completed.';
    onStateChange?.({ status: 'error', error: message });
    throw error;
  }
}

export function createDashboardTaskCompletionController({ onStateChange } = {}) {
  const pendingByTaskId = new Map();

  return {
    submit({ taskId, complete } = {}) {
      if (pendingByTaskId.has(taskId)) return pendingByTaskId.get(taskId);

      let request;
      request = runDashboardTaskCompletion({
        taskId,
        complete,
        onStateChange: (state) => onStateChange?.(taskId, state),
      }).finally(() => {
        if (pendingByTaskId.get(taskId) === request) pendingByTaskId.delete(taskId);
      });
      pendingByTaskId.set(taskId, request);
      return request;
    },
  };
}
