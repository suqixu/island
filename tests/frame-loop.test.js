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
