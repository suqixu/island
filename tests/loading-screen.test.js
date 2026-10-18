import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadingMessageCycle, createLoadingScreen } from '../src/loading-screen.js';

const requestedMessages = [
  '正在搭建海岛……', '正在栽树……', '正在覆盖植被……', '正在呼叫鲸鱼和海豚……',
  '正在摆动太阳和月亮……', '正在种植椰子树……', '正在放生龙虾和鱼群……', '正在驾驶渔船……',
  '正在耐心等待天气变化……', '正在向海水加盐……', '正在开凿山洞……', '正在建设凉亭……',
  '正在搭建灯塔……', '正在装修山洞……', '正在召集鸟群……', '正在调整海风……',
  '正在制作雪花……', '正在制作雨水……', '正在产生雾气……',
  '正在绘制云朵……', '正在点燃星辰……', '正在连接星座……',
  '正在酝酿台风……', '正在准备日食……',
];

test('随机文案每轮完整出现，跨轮也不会连续重复', () => {
  let seed = 31;
  const next = createLoadingMessageCycle({ random: () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  } });
  let previous;
  const rounds = [];
  for (let round = 0; round < 8; round += 1) {
    const messages = [];
    for (let index = 0; index < requestedMessages.length; index += 1) {
      const message = next();
      assert.notEqual(message, previous);
      messages.push(message);
      previous = message;
    }
    assert.deepEqual([...messages].sort(), [...requestedMessages].sort());
    rounds.push(messages);
  }
  assert.notDeepEqual(rounds[0], rounds[1]);
});

test('下一轮洗牌首句碰到上一轮尾句时，调整顺序避免重复', () => {
  let draw = 0;
  // 第一轮保留顺序，第二轮把尾句交换到首位，确定触发跨轮碰撞。
  const next = createLoadingMessageCycle({ random: () => draw++ === requestedMessages.length - 1 ? 0 : .999 });
  let previous;
  for (let index = 0; index < requestedMessages.length * 4; index += 1) {
    const message = next();
    assert.notEqual(message, previous);
    previous = message;
  }
});

function screenFixture() {
  const classes = new Set();
  const attributes = new Map();
  const root = {
    classList: { add: (...names) => names.forEach(name => classes.add(name)) },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const message = { textContent: '正在搭建海岛……' }, phase = { textContent: '' };
  const scheduled = new Map();
  let nextId = 0;
  const loadingScreen = createLoadingScreen({
    root,
    message,
    phase,
    random: () => 0,
    schedule: (callback, delay) => {
      assert.equal(delay, 1800);
      const id = nextId++;
      scheduled.set(id, callback);
      return id;
    },
    cancel: id => scheduled.delete(id),
  });
  return { loadingScreen, root, message, phase, classes, attributes, scheduled,
    tick: () => [...scheduled.values()].forEach(callback => callback()) };
}

test('加载失败后提供可用的重试按钮，离开页面后解除监听', () => {
  const listeners = new Map();
  const retryButton = {hidden:true,
    addEventListener:(name, callback)=>listeners.set(name, callback),
    removeEventListener:(name)=>listeners.delete(name)};
  let retried = 0;
  const screen = createLoadingScreen({root:{setAttribute(){},classList:{add(){}}},
    message:{}, retryButton, onRetry:()=>retried++, schedule:()=>1, cancel(){}});
  screen.start();
  listeners.get('click')?.();
  assert.equal(retried,0);
  screen.fail();
  assert.equal(retryButton.hidden,false);
  listeners.get('click')?.();
  assert.equal(retried,1);
  screen.dispose();
  assert.equal(listeners.size,0);
});

test('开始后马上显示文案，重复开始不会创建多余定时器', () => {
  const { loadingScreen, message, scheduled, attributes, tick } = screenFixture();
  loadingScreen.start();
  assert.ok(requestedMessages.includes(message.textContent));
  assert.equal(attributes.get('aria-busy'), 'true');
  const first = message.textContent;
  loadingScreen.start();
  assert.equal(scheduled.size, 1);
  tick();
  assert.notEqual(message.textContent, first);
});

test('真实场景完成时立即淡出并停止更新，不人为增加等待时间', () => {
  const { loadingScreen, message, scheduled, classes, attributes, tick } = screenFixture();
  loadingScreen.start();
  loadingScreen.complete();
  assert.ok(classes.has('done'));
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(scheduled.size, 0);
  const finished = message.textContent;
  loadingScreen.start();
  tick();
  assert.equal(message.textContent, finished);
  assert.equal(scheduled.size, 0);
});

test('失败信息持续可见，轮播和后续完成不会盖掉错误', () => {
  const { loadingScreen, message, scheduled, classes, attributes, tick } = screenFixture();
  loadingScreen.start();
  loadingScreen.fail('资源暂时无法加载，请刷新页面重试。');
  assert.equal(scheduled.size, 0);
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.ok(classes.has('error'));
  tick();
  loadingScreen.complete();
  assert.equal(message.textContent, '资源暂时无法加载，请刷新页面重试。');
  assert.ok(!classes.has('done'));
});

test('页面离开时清除轮播，重复清理及迟到的回调不再更新文案', () => {
  const { loadingScreen, message, scheduled, tick } = screenFixture();
  loadingScreen.start();
  const lateCallback = [...scheduled.values()][0];
  assert.equal(typeof lateCallback, 'function');
  const last = message.textContent;
  loadingScreen.dispose();
  loadingScreen.dispose();
  loadingScreen.start();
  lateCallback();
  tick();
  assert.equal(scheduled.size, 0);
  assert.equal(message.textContent, last);
});

test('实际启动阶段独立更新，保留随机轮播且完成或出错后拒绝迟到状态', () => {
  const { loadingScreen, message, phase, tick } = screenFixture();
  loadingScreen.start();
  const original = message.textContent;
  loadingScreen.setStage('正在铺设地形');
  assert.equal(phase.textContent, '正在铺设地形');
  assert.equal(message.textContent, original);
  tick();
  assert.ok(requestedMessages.includes(message.textContent));
  assert.equal(phase.textContent, '正在铺设地形');
  loadingScreen.fail('加载失败');
  loadingScreen.setStage('迟到的完成状态');
  assert.equal(phase.textContent, '');
  const completed = screenFixture();
  completed.loadingScreen.start();
  completed.loadingScreen.setStage('正在准备第一眼风景');
  completed.loadingScreen.complete();
  completed.loadingScreen.setStage('迟到的阶段');
  assert.equal(completed.phase.textContent, '正在准备第一眼风景');
});
