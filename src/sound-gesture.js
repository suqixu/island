/** 默认开声只是意愿；必须等用户点击后才尝试加载播放器。 */
export function startSoundOnFirstGesture({
  target, enabled = false, ignoredElements = [], isActive = () => false, start, onError = () => {},
}) {
  let listening = Boolean(enabled);
  function dispose() {
    if (!listening) return;
    listening = false;
    target.removeEventListener('click', activate);
  }
  function activate(event) {
    // 先消费本次机会：启动失败、控件自行处理或连续点击都不自动重试。
    dispose();
    if (isActive() || ignoredElements.some(element => event.composedPath().includes(element))) return;
    try { Promise.resolve(start()).catch(onError); }
    catch (error) { onError(error); }
  }
  if (listening) target.addEventListener('click', activate);
  return dispose;
}
