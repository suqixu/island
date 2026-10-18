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

test('进度阶段仍等待绘制，计算分片可单独让步而不必每片空等下一帧', async () => {
  let clock=0,paints=0,tasks=0;
  function* build(){yield {stage:'ocean'};for(let i=0;i<10;i++){clock+=3;yield;}return 9;}
  const value=await startup.runStartupGenerator(build(),{budgetMs:8,now:()=>clock,
    yieldToBrowser:async()=>paints++,yieldForBudget:async()=>tasks++});
  assert.equal(value,9);assert.equal(paints,1);assert.ok(tasks>=3);
});

test('计算让步使用浏览器调度器，旧浏览器仍跨到下一任务', async () => {
  assert.equal(typeof startup.nextStartupWork,'function');
  let yielded=0;await startup.nextStartupWork({scheduler:{yield(){yielded++;return Promise.resolve();}}});assert.equal(yielded,1);
  let task,done=false;const waiting=startup.nextStartupWork({scheduler:null,scheduleTask:callback=>task=callback}).then(()=>done=true);
  await Promise.resolve();assert.equal(done,false);task();await waiting;assert.equal(done,true);
});
