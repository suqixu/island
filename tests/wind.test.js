import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindState } from '../src/wind.js';
import { createSimulation, advanceSimulation, getEnvironment, WEATHER } from '../src/simulation.js';

test('固定随机种子可重现风场，不同种子产生不同的风与波群', () => {
  const sample = seed => Array.from({ length: 60 }, (_, index) => getWindState(index * 2, .22, seed));
  assert.deepEqual(sample(173), sample(173));
  assert.notDeepEqual(sample(173), sample(941));
  const samples = sample(173);
  assert.ok(Math.max(...samples.map(value => value.wind)) - Math.min(...samples.map(value => value.wind)) > .07);
  assert.ok(Math.max(...samples.map(value => value.swell)) - Math.min(...samples.map(value => value.swell)) > .20);
});

test('六种天气的随机风速、波群与单位风向始终有效，雷暴平均强于雾天', () => {
  const means = {};
  for (const [weather, parameters] of Object.entries(WEATHER)) {
    let total = 0;
    for (let time = 0; time < 1200; time += .73) {
      const field = getWindState(time, parameters.wind, 391);
      for (const key of ['wind', 'swell', 'gust']) assert.ok(Number.isFinite(field[key]) && field[key] >= 0 && field[key] <= 1);
      assert.ok(field.windSpeed >= 1.5 && field.windSpeed <= 21);
      assert.ok(Math.abs(Math.hypot(...field.windDirection) - 1) < 1e-10);
      total += field.wind;
    }
    means[weather] = total / Math.ceil(1200 / .73);
  }
  assert.ok(means.storm > means.fog * 3);
  assert.ok(means.sunny > means.fog && means.rain > means.sunny);
});

test('风速、风向与波群在帧间平滑，包括随机时间段的边界', () => {
  for (let time = 0; time < 200; time += .071) {
    const a = getWindState(time, .58, 103), b = getWindState(time + 1 / 60, .58, 103);
    assert.ok(Math.abs(a.wind - b.wind) < .004, `风速突变：${time}`);
    assert.ok(Math.abs(a.swell - b.swell) < .004);
    assert.ok(Math.hypot(...b.windDirection.map((value, index) => value - a.windDirection[index])) < .004);
  }
});

test('暂停昼夜后真实风场继续变化，调节模拟时间流速不改变同一真实时刻风场', () => {
  const state = createSimulation({ hour: 22, running: false, windSeed: 37 });
  const before = getEnvironment(state);
  advanceSimulation(state, 30);
  const after = getEnvironment(state);
  assert.equal(after.hour, before.hour);
  assert.notEqual(after.wind, before.wind);
  assert.deepEqual(getEnvironment({ ...state, speed: 8 }).windDirection, after.windDirection);
  assert.equal(getEnvironment({ ...state, speed: 8 }).swell, after.swell);
});

test('无效参数安全回退，不产生无效水面方向或风速', () => {
  for (const input of [NaN, Infinity, -Infinity, undefined]) {
    const value = getWindState(input, input, input);
    assert.ok(Number.isFinite(value.wind) && Number.isFinite(value.swell) && Number.isFinite(value.windSpeed));
    assert.ok(value.windDirection.every(Number.isFinite));
  }
});
