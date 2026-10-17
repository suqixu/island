import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameLoop } from '../src/frame-loop.js';

test('不可见页面不排动画帧，恢复时保留唯一循环，销毁后不再计算', () => {
  let hidden = false, id = 0;
  const queue = new Map(), frames = [];
  const loop = createFrameLoop(time => frames.push(time), {
    request: callback => { queue.set(++id, callback); return id; },
    cancel: token => queue.delete(token),
    hidden: () => hidden,
  });
  const tick = time => {
    const [token, callback] = queue.entries().next().value;
    queue.delete(token); callback(time);
  };
  loop.start(); loop.start(); assert.equal(queue.size, 1);
  tick(16); assert.deepEqual(frames, [16]); assert.equal(queue.size, 1);
  hidden = true; loop.pause(); assert.equal(queue.size, 0);
  loop.start(); assert.equal(queue.size, 0);
  hidden = false; loop.start(); loop.start(); tick(1000);
  assert.deepEqual(frames, [16, 1000]); assert.equal(queue.size, 1);
  loop.dispose(); loop.dispose(); loop.start(); assert.equal(queue.size, 0);
  assert.deepEqual(frames, [16, 1000]);
});

function simulation(maxFps) {
  let id = 0;
  const queue = new Map(), frames = [];
  const loop = createFrameLoop(time => frames.push(time), {
    request: callback => { queue.set(++id, callback); return id; },
    cancel: token => queue.delete(token), hidden: () => false, maxFps,
  });
  loop.start();
  return { loop, frames, tick(time) {
    const [token, callback] = queue.entries().next().value;
    queue.delete(token); callback(time);
    assert.equal(queue.size, 1, '限帧也只保留一个待执行回调');
  } };
}

test('高刷新率屏幕静观时仅更新30帧，不因120Hz回调重复渲染', () => {
  const run = simulation(30);
  try {
    for (let i = 0; i < 120; i++) run.tick(i * 1000 / 120);
    assert.equal(run.frames.length, 30);
    for (let i = 1; i < run.frames.length; i++) assert.ok(run.frames[i] - run.frames[i - 1] >= 32);
  } finally { run.loop.dispose(); }
});

test('交互帧率即时升到60并能恢复30，长帧不补播，暂停恢复立即呈现', () => {
  let interacting = false;
  const run = simulation(() => interacting ? 60 : 30);
  try {
    for (let i = 0; i < 60; i++) run.tick(i * 1000 / 120);
    assert.equal(run.frames.length, 15);
    interacting = true;
    for (let i = 60; i < 120; i++) run.tick(i * 1000 / 120);
    assert.equal(run.frames.length, 45, '半秒交互增加30帧');
    interacting = false;
    for (let i = 120; i < 180; i++) run.tick(i * 1000 / 120);
    assert.equal(run.frames.length, 60, '半秒静观仅增加15帧');
    const before = run.frames.length;
    run.tick(10000); assert.equal(run.frames.length, before + 1, '长间隔不能补算所有错过的帧');
    run.loop.pause(); run.loop.start(); run.tick(10001);
    assert.equal(run.frames.length, before + 2, '恢复时不能等旧的节流截止时间');
  } finally { run.loop.dispose(); }
});
