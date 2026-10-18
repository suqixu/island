/** Drag within the scene without sharing pointer gestures with its canvas. */
export function createDraggablePanel(panel, handle, { viewport = window } = {}) {
  let drag = null;
  let positioned = false;
  let disposed = false;

  function place(left, top) {
    const bounds = panel.offsetParent.getBoundingClientRect();
    const minLeft = Math.max(0, -bounds.left);
    const minTop = Math.max(0, -bounds.top);
    const maxLeft = Math.max(minLeft, Math.min(bounds.right, viewport.innerWidth) - bounds.left - panel.offsetWidth);
    const maxTop = Math.max(minTop, Math.min(bounds.bottom, viewport.innerHeight) - bounds.top - panel.offsetHeight);
    panel.style.left = `${Math.min(maxLeft, Math.max(minLeft, left))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(minTop, top))}px`;
    panel.style.right = 'auto';
    positioned = true;
  }

  function stop() {
    const pointerId = drag?.pointerId;
    drag = null;
    panel.classList.remove('dragging');
    if (pointerId !== undefined && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  }

  function start(event) {
    if (drag || event.isPrimary === false || event.button !== 0 || panel.inert || panel.classList.contains('closed')) return;
    if (event.target.closest('button, a, input, select, textarea, [contenteditable]')) return;
    event.preventDefault();
    event.stopPropagation();
    // Offsets exclude the separate transform used by the close transition.
    place(panel.offsetLeft, panel.offsetTop);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: panel.offsetLeft, top: panel.offsetTop };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  }

  function end(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    stop();
  }

  function resize() {
    stop();
    if (positioned) place(panel.offsetLeft, panel.offsetTop);
  }

  const listeners = [
    [handle, 'pointerdown', start],
    [handle, 'pointermove', move],
    [handle, 'pointerup', end],
    [handle, 'pointercancel', end],
    [handle, 'lostpointercapture', end],
    [viewport, 'resize', resize],
    [viewport, 'blur', stop],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    },
  };
}
