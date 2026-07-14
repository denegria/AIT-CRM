export const DEFERRED_BOOTSTRAP_LOADERS = Object.freeze({
  TASKS: 'tasks',
});

export function deferBootstrapTasks(payload = {}) {
  const deferredLoaders = new Set(payload.deferredLoaders || []);
  deferredLoaders.add(DEFERRED_BOOTSTRAP_LOADERS.TASKS);

  return {
    ...payload,
    tasks: [],
    deferredLoaders: [...deferredLoaders],
  };
}

export function hasDeferredBootstrapLoader(payload = {}, loader) {
  return (payload.deferredLoaders || []).includes(loader);
}
