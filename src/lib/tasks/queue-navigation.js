const QUEUE_FILTER_KEYS = ['due', 'ownerUserId', 'taskType', 'status', 'link'];

export function taskQueueHref(filters = {}, businessUnitId = '') {
  const params = new URLSearchParams();
  if (businessUnitId && businessUnitId !== 'all') params.set('businessUnitId', businessUnitId);
  for (const key of QUEUE_FILTER_KEYS) {
    const value = String(filters[key] || '');
    if (value && value !== 'all' && !(key === 'due' && value === 'open')) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `/tasks?${query}` : '/tasks';
}

export function taskQueueReturnHref(returnTo = '', businessUnitId = '') {
  let params = new URLSearchParams();
  if (typeof returnTo === 'string' && returnTo.startsWith('/tasks?')) {
    params = new URLSearchParams(returnTo.slice('/tasks?'.length));
  }
  const filters = Object.fromEntries(QUEUE_FILTER_KEYS.map((key) => [key, params.get(key) || '']));
  return taskQueueHref(filters, businessUnitId);
}

export function taskDetailHref(taskId, returnTo = '') {
  const path = `/tasks/${encodeURIComponent(taskId)}`;
  return returnTo ? `${path}?${new URLSearchParams({ returnTo })}` : path;
}
