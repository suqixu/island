// One animation loop, with no queued work while its page is hidden.
export function createFrameLoop(update, {
  request = callback => requestAnimationFrame(callback),
  cancel = token => cancelAnimationFrame(token),
  hidden = () => document.hidden,
  maxFps = 0,
} = {}) {
  let token = null, disposed = false, lastUpdate = null;
  function start() {
    if (disposed || hidden() || token !== null) return;
    token = request(tick);
  }
  function tick(time) {
    token = null;
    if (disposed || hidden()) return;
    start();
    const limit = typeof maxFps === 'function' ? maxFps(time) : maxFps;
    const interval = Number.isFinite(limit) && limit > 0 ? 1000 / limit : 0;
    const elapsed = lastUpdate === null ? Infinity : time - lastUpdate;
    // Keep the target clock aligned on 60/90/120 Hz displays without rendering
    // catch-up frames. Half a millisecond tolerates rAF timestamp rounding.
    if (elapsed >= 0 && elapsed + .5 < interval) return;
    if (lastUpdate === null || interval === 0 || elapsed < 0) lastUpdate = time;
    else lastUpdate += Math.max(1, Math.floor((elapsed + .5) / interval)) * interval;
    update(time);
  }
  function pause() {
    if (token !== null) cancel(token);
    token = null;
    lastUpdate = null;
  }
  function dispose() { pause(); disposed = true; }
  return { start, pause, dispose };
}
