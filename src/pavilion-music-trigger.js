/** 按设定点击次数切换隐藏音乐；切换视角、手动选曲或远离观察点后解除。 */
export function createPavilionMusicTrigger(center, viewId = 'south-pavilion', steps = [3], { repeat = true, maxCameraDistance = 45 } = {}) {
  let count = 0, activeStep = 0;
  function cancel() { count = 0; activeStep = 0; }
  function selectView(id) {
    if (id !== viewId) { cancel(); return false; }
    if (!steps.includes(++count)) return false;
    activeStep = count;
    if (repeat && count === steps.at(-1)) count = 0;
    return true;
  }
  function isActive(cameraPosition, target, cameraMoving = false, step) {
    if (activeStep && !cameraMoving) {
      const distance = cameraPosition.distanceToSquared(center), focus = target.distanceToSquared(center);
      if (!Number.isFinite(distance) || !Number.isFinite(focus) || distance > maxCameraDistance ** 2 || focus > 16 ** 2) cancel();
    }
    return activeStep > 0 && (step === undefined || step === activeStep);
  }
  return {selectView, isActive, cancel};
}
