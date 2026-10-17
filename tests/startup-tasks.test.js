import test from 'node:test';
import assert from 'node:assert/strict';

const startup = await import('../src/startup-tasks.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(startup?.runStartupGenerator && startup?.nextStartupPaint,
    '启动构建需要在耗时循环中把执行权还给浏览器');
  return startup;
};

test('阶段提示先获得一次绘制机会，批量工作超过预算后真正让出执行权', async () => {
  const { runStartupGenerator } = api();
  const events = [], slices = [];
  let clock = 0;
  function* build() {
    yield { stage: 'terrain' };
    for (let index = 0; index < 6; index++) { clock += 3; events.push(`work-${index}`); yield; }
    yield { stage: 'forest' };
    clock += 4;
    events.push('trees');
    return 42;
  }
  const result = await runStartupGenerator(build(), {
    budgetMs: 8, now: () => clock,
    onProgress: stage => events.push(stage),
    onSlice: slice => slices.push(slice),
    yieldToBrowser: async () => { events.push('paint'); },
  });
  assert.equal(result, 42);
  assert.deepEqual(events, ['terrain', 'paint', 'work-0', 'work-1', 'work-2', 'paint',
    'work-3', 'work-4', 'work-5', 'paint', 'forest', 'paint', 'trees']);
  assert.ok(slices.some(slice => slice.stage === 'terrain' && slice.durationMs === 9));
  assert.ok(slices.some(slice => slice.stage === 'forest' && slice.durationMs === 4));
});

test('构建或让出执行权失败时中止后续阶段，并关闭生成器', async () => {
  const { runStartupGenerator } = api();
  const error = new Error('build failed');
  let closed = false, continued = false;
  function* failedBuild() {
    try { yield { stage: 'terrain' }; throw error; }
    finally { closed = true; }
  }
  await assert.rejects(runStartupGenerator(failedBuild(), { yieldToBrowser: async () => {} }),
    value => value === error);
  assert.equal(closed, true);
  closed = false;
  function* waitingBuild() {
    try { yield { stage: 'terrain' }; continued = true; }
    finally { closed = true; }
  }
  await assert.rejects(runStartupGenerator(waitingBuild(), {
    yieldToBrowser: async () => { throw error; },
  }), value => value === error);
  assert.equal(closed, true);
  assert.equal(continued, false);
});

test('绘制让步跨过动画帧和下一任务，避免只yield微任务继续堵塞首屏', async () => {
  const { nextStartupPaint } = api();
  const events = [];
  let frame, task;
  const done = nextStartupPaint({
    requestFrame: callback => { events.push('request-frame'); frame = callback; },
    scheduleTask: callback => { events.push('schedule-task'); task = callback; },
  }).then(() => events.push('done'));
  await Promise.resolve();
  assert.deepEqual(events, ['request-frame']);
  frame();
  await Promise.resolve();
  assert.deepEqual(events, ['request-frame', 'schedule-task']);
  task();
  await done;
  assert.deepEqual(events, ['request-frame', 'schedule-task', 'done']);
});
