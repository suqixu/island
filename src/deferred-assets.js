import { DEFAULTS } from './runtime-config.js';

/** Keep decode/pixel derivation jobs apart instead of flooding the first landscape. */
export function createDeferredAssets({
  schedule = callback => typeof globalThis.requestIdleCallback === 'function'
    ? globalThis.requestIdleCallback(callback, { timeout: DEFAULTS.loading.deferredIdleTimeoutMs })
    : globalThis.setTimeout(callback, 32),
  cancel = token => typeof globalThis.cancelIdleCallback === 'function'
    ? globalThis.cancelIdleCallback(token) : globalThis.clearTimeout(token),
} = {}) {
  const known = new Set(), pending = [];
  let token = null, busy = false, disposed = false;
  function pump() {
    if (disposed || busy || token !== null || !pending.length) return;
    token = schedule(() => {
      token = null;
      if (disposed) return;
      const job = pending.shift(); busy = true;
      Promise.resolve().then(() => { if (!disposed) return job.load(); }).catch(error => {
        if (!disposed) { try { job.onError?.(error); } catch { /* An optional detail cannot stop the scene. */ } }
      }).finally(() => { busy = false; pump(); });
    });
  }
  function enqueue(key, load, { priority = false, onError } = {}) {
    if (disposed || known.has(key)) return;
    known.add(key);
    const job = { load, onError };
    if (priority) pending.unshift(job); else pending.push(job);
    pump();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; if (token !== null) cancel(token);
    token = null; pending.length = 0; known.clear();
  }
  return { enqueue, dispose };
}

export function needsSnowTextures(environment = {}) {
  return (environment.snow ?? 0) > .01 || (environment.snowCover ?? 0) > .005
    || environment.weather === 'snow' || environment.weather === 'blizzard';
}
