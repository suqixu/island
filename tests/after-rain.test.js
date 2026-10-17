import test from 'node:test';
import assert from 'node:assert/strict';
import { createAfterRainState, advanceAfterRain } from '../src/after-rain.js';
import { createSimulation, advanceSimulation, getEnvironment } from '../src/simulation.js';

const environment = (weather = 'sunny', overrides = {}) => ({
  weather, daylight: 1, rain: 0, storm: 0, fog: 0, snow: 0,
  cloudiness: .12, sunVisibility: 1, ...overrides,
});
const sample = (state, time, weather = 'sunny', overrides = {}) =>
  advanceAfterRain(state, time, environment(weather, overrides));

test('首次晴天和没有雨后条件的夜、云、雾、雪都没有彩虹', () => {
  for (const [weather, overrides] of [
    ['sunny', {}], ['sunny', { daylight: 0 }], ['cloudy', {}],
    ['fog', { fog: .9 }], ['snow', { snow: 1 }],
  ]) {
    const state = createAfterRainState();
    for (const time of [0, 10, 60, 150]) assert.equal(sample(state, time, weather, overrides), 0);
  }
});

test('实际雨或雷暴后转晴淡入彩虹，下午较高的太阳不会禁止触发', () => {
  for (const weather of ['rain', 'storm']) {
    const state = createAfterRainState();
    assert.equal(sample(state, 0, weather, { rain: .75, storm: weather === 'storm' ? 1 : 0 }), 0);
    assert.equal(sample(state, 10, 'sunny', { sunAltitude: 48 * Math.PI / 180 }), 0);
    assert.ok(sample(state, 15) > 0);
    assert.ok(sample(state, 30) > .7);
  }
});

test('非雨天天气里的平滑雨和雷暴残值不会凭空蓄积水汽', () => {
  const state = createAfterRainState();
  for (const weather of ['sunny', 'cloudy']) {
    assert.equal(sample(state, 0, weather, { rain: .9, storm: .6 }), 0);
    assert.equal(sample(state, 3, weather, { rain: .8, storm: .4 }), 0);
    assert.equal(sample(state, 20), 0);
  }
});

test('转晴时容许降水残值渐消，最多等待三秒就开始淡入', () => {
  const state = createAfterRainState();
  sample(state, 0, 'rain', { rain: 1 });
  assert.equal(sample(state, 1, 'sunny', { rain: .7, storm: .4 }), 0);
  assert.equal(sample(state, 3.9, 'sunny', { rain: .7, storm: .4 }), 0);
  assert.equal(sample(state, 4, 'sunny', { rain: .7, storm: .4 }), 0);
  assert.ok(sample(state, 4.5, 'sunny', { rain: .7, storm: .4 }) > 0);
});

test('彩虹约九十真实秒完成一次平滑淡入和淡出，不会持续重启', () => {
  const state = createAfterRainState();
  sample(state, 0, 'rain');
  sample(state, 10);
  const early = sample(state, 15);
  const peak = sample(state, 30);
  const fading = sample(state, 85);
  assert.ok(early > 0 && early < peak);
  assert.ok(peak > .7);
  assert.ok(fading > 0 && fading < peak);
  assert.ok(sample(state, 99) < .03);
  assert.equal(sample(state, 100), 0);
  assert.equal(sample(state, 200), 0);
  assert.equal(sample(state, 1000), 0);
});

test('云、雾、雪和夜晚遮蔽彩虹，但其后晴天只恢复事件剩余时间', () => {
  for (const [weather, overrides] of [
    ['cloudy', {}], ['fog', { fog: .9 }], ['snow', { snow: 1 }],
    ['sunny', { daylight: .3 }],
  ]) {
    const state = createAfterRainState();
    sample(state, 0, 'rain');
    sample(state, 1);
    const peak = sample(state, 21);
    assert.ok(peak > .7);
    assert.equal(sample(state, 40, weather, overrides), 0);
    const remaining = sample(state, 81);
    assert.ok(remaining > 0 && remaining < peak * .5);
    assert.equal(sample(state, 91), 0);
    assert.equal(sample(state, 120), 0);
  }
});

test('未触发的水汽在夜、雾、雪中自然过期，不能等到很久以后再形成彩虹', () => {
  for (const [weather, overrides] of [
    ['sunny', { daylight: 0 }], ['fog', { fog: .9 }], ['snow', { snow: 1 }],
  ]) {
    const state = createAfterRainState();
    sample(state, 0, 'storm', { rain: 1, storm: 1 });
    assert.equal(sample(state, 10, weather, overrides), 0);
    assert.equal(sample(state, 119, weather, overrides), 0);
    assert.equal(sample(state, 121), 0);
    assert.equal(sample(state, 140), 0);
  }
});

test('新一轮降雨会收起旧彩虹，随后转晴重新形成完整事件', () => {
  const state = createAfterRainState();
  sample(state, 0, 'rain');
  sample(state, 1);
  assert.ok(sample(state, 21) > .7);
  assert.equal(sample(state, 25, 'storm', { rain: 1, storm: 1 }), 0);
  assert.equal(sample(state, 26), 0);
  assert.ok(sample(state, 31) > 0);
  assert.ok(sample(state, 100) > 0);
  assert.equal(sample(state, 116), 0);
});

test('连续降雨刷新近期水汽，长时间的雨后仍可转晴出现一次彩虹', () => {
  const state = createAfterRainState();
  for (const time of [0, 100, 200]) assert.equal(sample(state, time, 'rain', { rain: .75 }), 0);
  sample(state, 210);
  assert.ok(sample(state, 215) > 0);
  assert.equal(sample(state, 300), 0);
  assert.equal(sample(state, 400), 0);
});

test('晴天仍有浓雾或雪时暂不触发，条件恢复后使用尚未过期的水汽', () => {
  for (const blocked of [{ fog: .9 }, { snow: .8 }]) {
    const state = createAfterRainState();
    sample(state, 0, 'rain');
    assert.equal(sample(state, 1, 'sunny', blocked), 0);
    assert.equal(sample(state, 20, 'sunny', blocked), 0);
    sample(state, 30);
    assert.ok(sample(state, 35) > 0);
  }
});

test('暂停模拟小时后，真实 elapsed 仍使彩虹完成淡入和淡出', () => {
  const simulation = createSimulation({ hour: 14.5, running: false, weather: 'rain' });
  const state = createAfterRainState();
  advanceAfterRain(state, simulation.elapsed, getEnvironment(simulation));
  simulation.weather = 'sunny';
  advanceSimulation(simulation, 1);
  advanceAfterRain(state, simulation.elapsed, getEnvironment(simulation));
  advanceSimulation(simulation, 20);
  assert.ok(advanceAfterRain(state, simulation.elapsed, getEnvironment(simulation)) > .7);
  advanceSimulation(simulation, 70);
  assert.equal(simulation.hour, 14.5);
  assert.equal(advanceAfterRain(state, simulation.elapsed, getEnvironment(simulation)), 0);
});

test('异常或倒退时间不会产生 NaN，也不会倒放或重启彩虹', () => {
  const state = createAfterRainState();
  sample(state, 0, 'rain');
  sample(state, 1);
  const current = sample(state, 21);
  for (const time of [20, -10, NaN, Infinity, -Infinity, undefined]) {
    const intensity = sample(state, time);
    assert.equal(intensity, current);
    assert.ok(Number.isFinite(intensity) && intensity >= 0 && intensity <= 1);
  }
  assert.equal(sample(state, 91), 0);
  assert.equal(sample(state, 1), 0);
});

test('不同实例不共享雨后事件，可选天气数值缺失或异常时强度仍有效', () => {
  const wetState = createAfterRainState(), dryState = createAfterRainState();
  sample(wetState, 0, 'rain');
  sample(wetState, 1);
  assert.ok(sample(wetState, 21) > 0);
  assert.equal(sample(dryState, 21), 0);
  for (const env of [
    { weather: 'sunny', daylight: 1 },
    { weather: 'sunny', daylight: 1, rain: NaN, storm: Infinity, sunVisibility: NaN },
    { weather: 'sunny', daylight: Infinity, fog: NaN, snow: -1, cloudiness: Infinity },
    undefined,
  ]) {
    const intensity = advanceAfterRain(wetState, 22, env);
    assert.ok(Number.isFinite(intensity) && intensity >= 0 && intensity <= 1);
  }
});
