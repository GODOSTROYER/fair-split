// timersBeforeCommit: the order a loaded machine gives now and then, every time. Until the returned function is
// called, a zero-delay timer fires at the end of the task that set it (a microtask) rather than in a later task,
// so before React commits an update scheduled in that same task (React's scheduler keeps its own timers). Code
// that waits a timer for React's commit (to see a control gone, say) fails under it on every run.

export function timersBeforeCommit(): () => void {
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  const cleared = new Set<unknown>();
  const early = ((run: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms) return setTimer(run, ms, ...args);
    const handle = setTimer(() => undefined, 0);
    queueMicrotask(() => {
      if (!cleared.has(handle)) run(...args);
    });
    return handle;
  }) as typeof setTimeout;
  const clear = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    cleared.add(handle);
    clearTimer(handle);
  }) as typeof clearTimeout;
  globalThis.setTimeout = early;
  globalThis.clearTimeout = clear;
  return () => {
    globalThis.setTimeout = setTimer;
    globalThis.clearTimeout = clearTimer;
  };
}
