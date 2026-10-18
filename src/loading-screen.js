import loadingConfig from './config/loading.json' with {type:'json'};

const {messages}=loadingConfig;

export function createLoadingMessageCycle({ random = Math.random } = {}) {
  let round = [];
  let position = 0;
  let previous;
  return () => {
    if (position === round.length) {
      round = [...messages];
      for (let index = round.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [round[index], round[other]] = [round[other], round[index]];
      }
      // 保留每轮的完整覆盖，同时避免上一轮尾句紧接着再次出现。
      if (round[0] === previous) [round[0], round[1]] = [round[1], round[0]];
      position = 0;
    }
    previous = round[position++];
    return `${previous}${loadingConfig.suffix}`;
  };
}

export function createLoadingScreen({
  root,
  message,
  phase,
  retryButton,
  onRetry = () => {},
  random = Math.random,
  intervalMs = loadingConfig.messageIntervalMs,
  schedule = globalThis.setInterval.bind(globalThis),
  cancel = globalThis.clearInterval.bind(globalThis),
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
}) {
  const nextMessage = createLoadingMessageCycle({ random });
  let state = 'idle';
  let timer = null;
  let animation;
  const retry = () => { if (state === 'error') onRetry(); };
  retryButton?.addEventListener('click', retry);

  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
    animation?.cancel();
    animation = undefined;
  }

  function updateMessage() {
    if (state !== 'loading') return;
    message.textContent = nextMessage();
    if (!reducedMotion) {
      animation?.cancel();
      animation = message.animate?.(
        [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: loadingConfig.messageAnimationMs, easing: 'ease-out' },
      );
    }
  }

  return {
    start() {
      if (state !== 'idle') return;
      state = 'loading';
      root.setAttribute('aria-busy', 'true');
      updateMessage();
      timer = schedule(updateMessage, intervalMs);
    },
    complete() {
      if (state !== 'loading') return;
      state = 'done';
      stop();
      root.setAttribute('aria-busy', 'false');
      root.setAttribute('aria-hidden', 'true');
      root.classList.add('done');
      if (retryButton) retryButton.hidden = true;
    },
    setStage(text) {
      if (state !== 'loading' || !phase) return;
      phase.textContent = text;
    },
    fail(text = loadingConfig.errors.default) {
      if (state !== 'idle' && state !== 'loading') return;
      state = 'error';
      stop();
      root.setAttribute('aria-busy', 'false');
      root.classList.add('error');
      message.textContent = text;
      if (phase) phase.textContent = '';
      if (retryButton) retryButton.hidden = false;
    },
    dispose() {
      state = 'disposed';
      stop();
      retryButton?.removeEventListener('click', retry);
    },
  };
}
