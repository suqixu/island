import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/sound-gesture.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.startSoundOnFirstGesture, 'function', '默认开声需要等待首次用户交互');
  return module.startSoundOnFirstGesture(options);
};
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('默认关闭时点击页面也不加载音频，默认开启在首次点击前不加载', async () => {
  const page = new EventTarget();
  let starts = 0;
  const stopDisabled = create({ target: page, enabled: false, start: () => starts++ });
  page.dispatchEvent(new Event('click'));
  assert.equal(starts, 0);
  stopDisabled();
  const stopEnabled = create({ target: page, enabled: true, start: () => starts++ });
  assert.equal(starts, 0);
  page.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(starts, 1);
  stopEnabled();
});

test('首次点击尝试启动，连续点击和迟到完成不重复启动', async () => {
  const page = new EventTarget();
  let starts = 0, finish;
  const stop = create({ target: page, enabled: true, start: () => {
    starts++;
    return new Promise(resolve => { finish = resolve; });
  } });
  page.dispatchEvent(new Event('click'));
  page.dispatchEvent(new Event('click'));
  assert.equal(starts, 1);
  finish(); await settle();
  page.dispatchEvent(new Event('click'));
  assert.equal(starts, 1);
  stop();
});

test('声音控件自行处理的首次点击不再次切换开关，之后也不补启动', () => {
  const soundControl = new EventTarget();
  let starts = 0;
  const stop = create({ target: soundControl, enabled: true, ignoredElements: [soundControl], start: () => starts++ });
  soundControl.dispatchEvent(new Event('click'));
  soundControl.dispatchEvent(new Event('click'));
  assert.equal(starts, 0);
  stop();
});

test('控件已开启或正在启动时只消耗首次交互，不重复加载', () => {
  for (const active of [true, 'loading']) {
    const page = new EventTarget();
    let starts = 0, current = active;
    const stop = create({ target: page, enabled: true, isActive: () => current, start: () => starts++ });
    page.dispatchEvent(new Event('click'));
    current = false;
    page.dispatchEvent(new Event('click'));
    assert.equal(starts, 0);
    stop();
  }
});

test('清理后首次点击不会加载；启动失败仅报告一次且不在后续点击重试', async () => {
  const page = new EventTarget();
  let starts = 0;
  const stop = create({ target: page, enabled: true, start: () => starts++ });
  stop(); stop();
  page.dispatchEvent(new Event('click'));
  assert.equal(starts, 0);
  for (const synchronous of [false, true]) {
    const errors = [], problem = new Error('音频启动失败');
    const cleanup = create({ target: page, enabled: true, start: () => {
      starts++;
      if (synchronous) throw problem;
      return Promise.reject(problem);
    }, onError: error => errors.push(error) });
    page.dispatchEvent(new Event('click')); await settle();
    page.dispatchEvent(new Event('click')); await settle();
    assert.deepEqual(errors, [problem]);
    cleanup();
  }
  assert.equal(starts, 2);
});
