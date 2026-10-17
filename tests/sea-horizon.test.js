import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment } from '../src/simulation.js';

const horizon = await import('../src/sea-horizon.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(horizon?.getSeaHorizonState, '海天应提供共享的线性夜间地平线驱动');
  assert.ok(horizon?.getSeaHorizonSample);
  assert.ok(horizon?.getSeaHorizonOceanWeight);
  return horizon;
};
const clear = { daylight: 0, moonLight: 1, cloudiness: .12, fog: 0, rain: 0, snow: 0, storm: 0 };
const luminance = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} 应接近 ${expected}`);

test('明月深夜完全启用，白天与真实夕阳余晖阶段不改变海天颜色', () => {
  const { getSeaHorizonState } = api();
  for (const hour of [0, 22, 23]) {
    const env = getEnvironment(createSimulation({ hour, windSeed: 1 }));
    assert.equal(getSeaHorizonState(env).night, 1);
  }
  for (const hour of [6, 12, 17.8, 18, 18.2, 18.35]) {
    const env = getEnvironment(createSimulation({ hour, windSeed: 1 }));
    assert.equal(getSeaHorizonState(env).night, 0, String(hour));
  }
  const newMoon = getSeaHorizonState({ ...clear, moonLight: 0 });
  assert.equal(newMoon.night, 1, '新月远处仍需统一接线，亮度由色彩降低');
  assert.ok(luminance(newMoon.color) < luminance(getSeaHorizonState(clear).color) * .5);
});

test('共享线性颜色取真实天空地平线的雾色与低空混色，天气遮月且雷暴只暗化一次', () => {
  const { getSeaHorizonState } = api(), sunny = getSeaHorizonState(clear);
  // 手算旧天空 y=0 的 smoothstep(-.045,.04,0)，权重约 .54406757。
  const expected = [.027997850386, .060102190303, .102318823177];
  sunny.color.forEach((value, channel) => close(value, expected[channel], .000001));
  for (const weather of [{ cloudiness: .86, fog: .1 }, { cloudiness: .92, rain: .75, fog: .24 },
    { cloudiness: 1, rain: 1, fog: .35, storm: 1 }]) {
    assert.ok(luminance(getSeaHorizonState({ ...clear, ...weather }).color) < luminance(sunny.color));
  }
  const storm = getSeaHorizonState({ ...clear, storm: 1 });
  storm.color.forEach((value, channel) => close(value, sunny.color[channel] * .58));
});

test('同一地平线射线得到独立共享色，视线升高后不污染月盘与高空', () => {
  const { getSeaHorizonState, getSeaHorizonSample } = api(), state = getSeaHorizonState(clear);
  const line = getSeaHorizonSample([1, 0, 2], 48, state);
  const scaled = getSeaHorizonSample([7, 0, 14], 48, state);
  line.color.forEach((value, channel) => close(value, scaled.color[channel]));
  close(line.width, scaled.width);
  close(line.skyWeight, scaled.skyWeight);
  assert.equal(line.skyWeight, 1);
  assert.ok(line.width >= .025 && line.width <= .08, '柔雾可见但仍限于低空');
  const low = getSeaHorizonSample([1, .025, 2], 48, state);
  assert.ok(low.skyWeight > .4 && low.skyWeight < 1);
  assert.ok(getSeaHorizonSample([1, .04, 0], 48, state).skyWeight > .35,
    '交界上方约两度仍有柔雾，避免只遮平直的最后一像素');
  assert.equal(getSeaHorizonSample([1, .5, 2], 48, state).skyWeight, 0);
  assert.equal(getSeaHorizonSample([0, 1, 0], 48, state).skyWeight, 0);
  line.color[0] = 99;
  assert.notEqual(state.color[0], 99);
});

test('海雾远距渐融到共享色而近岸160米以内保持清楚', () => {
  const { getSeaHorizonState, getSeaHorizonOceanWeight } = api(), state = getSeaHorizonState(clear);
  for (const distance of [-1, 0, 32, 80, 160]) assert.equal(getSeaHorizonOceanWeight(distance, [1, 0, 0], 7, state), 0);
  let previous = 0;
  for (const distance of [161, 200, 700, 2000, 8000, 24000]) {
    const value = getSeaHorizonOceanWeight(distance, [1, 0, 0], 7, state);
    assert.ok(value >= previous && value <= 1); previous = value;
  }
  assert.ok(previous > .99999);
  assert.equal(getSeaHorizonOceanWeight(24000, [1, 0, 0], 7, getSeaHorizonState({ ...clear, daylight: 1 })), 0);
});

test('方位绕一周与缓慢移动连续，长期时间仍有限且只有微弱颜色变化', () => {
  const { getSeaHorizonState, getSeaHorizonSample } = api(), state = getSeaHorizonState(clear);
  let previous = getSeaHorizonSample([1, 0, 0], 0, state);
  for (let angle = .001; angle <= Math.PI * 2; angle += .001) {
    const sample = getSeaHorizonSample([Math.cos(angle), 0, Math.sin(angle)], 0, state);
    sample.color.forEach((value, channel) => assert.ok(Math.abs(value - previous.color[channel]) < .00002));
    assert.ok(Math.abs(sample.width - previous.width) < .0001); previous = sample;
  }
  const before = getSeaHorizonSample([-1, 0, 1e-8], 0, state), after = getSeaHorizonSample([-1, 0, -1e-8], 0, state);
  before.color.forEach((value, channel) => close(value, after.color[channel], 1e-9));
  const original = getSeaHorizonSample([1, 0, 0], 0, state);
  const later = getSeaHorizonSample([1, 0, 0], 600, state);
  assert.ok(original.color.some((value, channel) => Math.abs(value - later.color[channel]) > 1e-5));
  for (const time of [1e4, 1e7, 3e8]) {
    const sample = getSeaHorizonSample([1, 0, 1], time, state);
    assert.ok(sample.color.every(Number.isFinite));
    sample.color.forEach((value, channel) => assert.ok(value >= state.color[channel] * .94 && value <= state.color[channel] * 1.06));
  }
});

test('真实昼夜转换保持连续，月光与天气输入不被修改', () => {
  const { getSeaHorizonState } = api();
  let previous = getSeaHorizonState({ ...clear, daylight: 0 });
  for (let light = .00001; light <= .011; light += .00001) {
    const state = getSeaHorizonState({ ...clear, daylight: light });
    assert.ok(Math.abs(state.night - previous.night) < .002);
    previous = state;
  }
  const env = Object.freeze({ ...clear, skyCloudCover: .8 });
  const a = getSeaHorizonState(env), b = getSeaHorizonState(env);
  a.color[0] = 99;
  assert.notEqual(b.color[0], 99);
  assert.equal(b.cloudCover, .8);
  assert.equal(env.cloudiness, .12);
});

test('零向量、无效射线时间和缺省环境保守返回有限值', () => {
  const { getSeaHorizonState, getSeaHorizonSample, getSeaHorizonOceanWeight } = api();
  for (const env of [undefined, null, {}, { daylight: NaN, moonLight: Infinity, fog: NaN, skyCloudCover: NaN }]) {
    const state = getSeaHorizonState(env);
    assert.equal(state.night, 0);
    assert.ok(state.color.every(Number.isFinite));
    for (const ray of [undefined, null, [0, 0, 0], [NaN, 1, 0], [1, 2], { x: Infinity, y: 1, z: 1 }]) {
      const sample = getSeaHorizonSample(ray, NaN, state);
      assert.equal(sample.skyWeight, 0);
      assert.ok(sample.color.every(Number.isFinite));
      assert.ok(Number.isFinite(sample.width));
      assert.equal(getSeaHorizonOceanWeight(NaN, ray, Infinity, state), 0);
    }
  }
});
