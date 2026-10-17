// One animation loop, with no queued work while its page is hidden.
export function createFrameLoop(update, {
  request = callback => requestAnimationFrame(callback),
  cancel = token => cancelAnimationFrame(token),
  hidden = () => document.hidden,
} = {}) {
  let token = null, disposed = false;
  function start() {
    if (disposed || hidden() || token !== null) return;
    token = request(tick);
  }
  function tick(time) {
    token = null;
    if (disposed || hidden()) return;
    start();
    update(time);
  }
  function pause() {
    if (token !== null) cancel(token);
    token = null;
  }
  function dispose() { pause(); disposed = true; }
  return { start, pause, dispose };
}
