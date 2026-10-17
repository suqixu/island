const messages = [
  '正在搭建海岛',
  '正在栽树',
  '正在覆盖植被',
  '正在呼叫鲸鱼和海豚',
  '正在摆动太阳和月亮',
  '正在种植椰子树',
  '正在放生龙虾和鱼群',
  '正在驾驶渔船',
  '正在耐心等待天气变化',
  '正在向海水加盐',
  '正在开凿山洞',
  '正在建设凉亭',
  '正在搭建灯塔',
  '正在装修山洞',
  '正在召集鸟群',
  '正在调整海风',
  '正在制作雪花',
  '正在制作雨水',
  '正在产生雾气',
];

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
    return `${previous}……`;
  };
}

export function createLoadingScreen({
  root,
  message,
  phase,
  random = Math.random,
  intervalMs = 1800,
  schedule = globalThis.setInterval.bind(globalThis),
  cancel = globalThis.clearInterval.bind(globalThis),
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
}) {
  const nextMessage = createLoadingMessageCycle({ random });
  let state = 'idle';
  let timer = null;
  let animation;

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
        { duration: 450, easing: 'ease-out' },
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
    },
    setStage(text) {
      if (state !== 'loading' || !phase) return;
      phase.textContent = text;
    },
    fail(text = '海岛未能加载，请刷新页面重试。') {
      if (state !== 'idle' && state !== 'loading') return;
      state = 'error';
      stop();
      root.setAttribute('aria-busy', 'false');
      root.classList.add('error');
      message.textContent = text;
      if (phase) phase.textContent = '';
    },
    dispose() {
      state = 'disposed';
      stop();
    },
  };
}
