/** A microtask alone does not let the loading screen paint. */
export function nextStartupPaint({
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  scheduleTask = globalThis.setTimeout.bind(globalThis),
} = {}) {
  return new Promise(resolve => {
    if (requestFrame) requestFrame(() => scheduleTask(resolve, 0));
    else scheduleTask(resolve, 0);
  });
}

/** Yield CPU batches without requiring an otherwise empty animation frame. */
export function nextStartupWork({
  scheduler = globalThis.scheduler,
  scheduleTask = globalThis.setTimeout.bind(globalThis),
} = {}) {
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise(resolve => scheduleTask(resolve, 0));
}

/** Consume the same construction iterator used by the synchronous scene API. */
export async function runStartupGenerator(iterator, {
  budgetMs = 8,
  now = () => performance.now(),
  yieldToBrowser = nextStartupPaint,
  yieldForBudget = yieldToBrowser,
  onProgress = () => {},
  onSlice = () => {},
} = {}) {
  let stage, finished = false, sliceStart = now();
  const reportSlice = end => {
    if (stage) onSlice({ stage, durationMs: Math.max(0, end - sliceStart) });
  };
  try {
    while (true) {
      const result = iterator.next();
      const end = now();
      if (result.done) {
        finished = true;
        reportSlice(end);
        return result.value;
      }
      if (result.value?.stage && result.value.stage !== stage) {
        reportSlice(end);
        stage = result.value.stage;
        onProgress(stage);
        // Paint the new phase before starting its work, even on a fast machine.
        await yieldToBrowser();
        sliceStart = now();
      } else if (end - sliceStart >= budgetMs) {
        reportSlice(end);
        await yieldForBudget();
        sliceStart = now();
      }
    }
  } finally {
    if (!finished) iterator.return?.();
  }
}
