import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlyphMotion } from '../src/poem-motion.js';
import { createCloudMotionState, advanceCloudMotion } from '../src/cloud-motion.js';

test('诗字运动可写入同一个输出，并在飞散模式与减少动态模式之间清除旧位移', () => {
  const output = { opacity: -1, drift: -1, lift: -1, depth: -1, rotation: -1, scale: -1 };
  const flying = getGlyphMotion(8.2, 0, 0, 1, false, output);
  assert.equal(flying, output, '高频字幕更新复用调用方输出，不产生逐字新对象');
  assert.ok(Math.abs(output.drift - 10) < 1e-12);
  assert.ok(Math.abs(output.lift - 7) < 1e-12);
  assert.ok(Math.abs(output.depth - 8) < 1e-12);
  assert.ok(Math.abs(output.rotation - .16) < 1e-12);
  assert.ok(Math.abs(output.scale - .58) < 1e-12);
  getGlyphMotion(4, 0, 0, 2, true, output);
  assert.deepEqual(output, { opacity: 1, drift: 0, lift: 0, depth: 0, rotation: 0, scale: 1 },
    '重新使用输出不能让上一字的飞散值留给静止字');
  const snapshot = getGlyphMotion(4, 0, 0);
  getGlyphMotion(8.2, 0, 0);
  assert.deepEqual(snapshot, { opacity: 1, drift: 0, lift: 0, depth: 0, rotation: 0, scale: 1 },
    '省略输出时，原有接口仍返回独立快照');
});

test('云风积分可复用输出及两组数组，不将输出数组与累计状态共享', () => {
  const state = createCloudMotionState();
  const wind = { windSpeed: 6.5, gust: .2, windDirection: [1, 0] };
  const output = { delta: -1, speed: -1, direction: [9, 9], offset: [9, 9] };
  const direction = output.direction, offset = output.offset;
  assert.equal(advanceCloudMotion(state, 0, wind, output), output);
  assert.equal(output.direction, direction); assert.equal(output.offset, offset);
  assert.deepEqual(output.direction, [1, 0]); assert.deepEqual(output.offset, [0, 0]);
  assert.ok(Math.abs(output.speed - 4.86) < 1e-12);
  const snapshot = advanceCloudMotion(state, .1, wind);
  advanceCloudMotion(state, .2, wind, output);
  assert.equal(output.direction, direction); assert.equal(output.offset, offset);
  assert.ok(Math.abs(output.offset[0] - .972) < 1e-12);
  assert.deepEqual(snapshot.direction, [1, 0]);
  assert.ok(Math.abs(snapshot.offset[0] - .486) < 1e-12);
  output.offset[0] = -999;
  assert.ok(Math.abs(state.offset[0] - .972) < 1e-12, '调用方临时输出不改变实际累计漂移');
});
