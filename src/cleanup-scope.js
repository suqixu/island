/** Own partially initialized resources and dispose them once, in reverse order. */
export function createCleanupScope({ onError = error => console.error(error), onFailure = onError } = {}) {
  const callbacks = new Set();
  let disposed = false;
  function invoke(callback) {
    try { callback(); } catch (error) { onError(error); }
  }
  function add(callback) {
    if (disposed) invoke(callback);
    else callbacks.add(callback);
    return () => callbacks.delete(callback);
  }
  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    return add(() => target.removeEventListener(type, listener, options));
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    const pending = [...callbacks].reverse();
    callbacks.clear();
    for (const callback of pending) invoke(callback);
  }
  function fail(error) {
    // Show the original failure before cleanup can stop its loading UI.
    try { onFailure(error); } finally { dispose(); }
  }
  async function run(initialize) {
    try { return await initialize(); } catch (error) { fail(error); }
  }
  return { add, listen, dispose, fail, run };
}
