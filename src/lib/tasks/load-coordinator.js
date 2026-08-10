export function createTaskLoadCoordinator() {
  let activePromise = null;
  let queuedForcePromise = null;

  function start(load) {
    let trackedPromise;
    trackedPromise = Promise.resolve()
      .then(load)
      .finally(() => {
        if (activePromise === trackedPromise) activePromise = null;
      });
    activePromise = trackedPromise;
    return trackedPromise;
  }

  function run(load, { force = false } = {}) {
    if (typeof load !== 'function') {
      return Promise.reject(new Error('A task load function is required.'));
    }
    if (queuedForcePromise) return queuedForcePromise;
    if (!activePromise) return start(load);
    if (!force) return activePromise;

    const predecessor = activePromise;
    let queuedPromise;
    queuedPromise = (async () => {
      try {
        await predecessor;
      } catch {
        // A post-mutation refresh must still run after an earlier read fails.
      }
      const successor = start(load);
      if (queuedForcePromise === queuedPromise) queuedForcePromise = null;
      return successor;
    })();
    queuedForcePromise = queuedPromise;
    return queuedPromise;
  }

  return { run };
}
