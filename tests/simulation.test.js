import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment, advanceSimulation } from '../src/simulation.js';

test('默认半速推进昼夜，风浪的真实时间继续独立推进', () => {
  const state = createSimulation({ hour: 18 });
  assert.equal(state.speed, .5);
  advanceSimulation(state, 60);
  assert.equal(state.hour, 20);
  assert.equal(state.elapsed, 60);
});

test('16倍速同步推进场景与昼夜，切回普通倍率后累计动画时间连续', () => {
  const state = createSimulation({ hour: 12, speed: 16, autoWeather: false, autoSeason: false });
  advanceSimulation(state, 1);
  assert.equal(state.elapsed, 16);
  assert.ok(Math.abs(state.hour - 13.066666666666666) < 1e-8);
  assert.equal(getEnvironment(state).animationRate, 16);
  state.speed = .5;
  advanceSimulation(state, 1);
  assert.equal(state.elapsed, 17);
  assert.equal(getEnvironment(state).animationRate, 1);
  assert.ok(Math.abs(state.hour - 13.1) < 1e-8);
});

test('16倍速的月夜收束也加速，关闭后恢复十二秒收束', async () => {
  const { finishMoonNight } = await import('../src/simulation.js');
  const state = createSimulation({ hour: 22, speed: 16 });
  finishMoonNight(state); advanceSimulation(state, .75);
  assert.equal(state.hour, 6.5); assert.equal(state.moonNightEnding, null);
  state.hour = 22; state.speed = .5; finishMoonNight(state); advanceSimulation(state, 1);
  assert.ok(state.moonNightEnding && state.hour > 22 && state.hour < 23);
});

test('第一帧的负时间差不能让夏季倒退为春季', () => {
  const state = createSimulation();
  advanceSimulation(state, -.003);
  assert.equal(state.seasonIndex, 1);
  assert.equal(state.hour, 14.5);
  assert.equal(state.elapsed, 0);
  assert.ok(state.seasonProgress >= 0);
});

test('昼夜跨午夜后时间保持有效，并保留循环进度', () => {
  const state = createSimulation({ hour: 23.9, dayDuration: 120, speed: 1 });
  advanceSimulation(state, 1);
  assert.ok(Math.abs(state.hour - 0.1) < 1e-8);
});
test('暂停时间后波浪用的真实时间仍可独立推进', () => {
  const state = createSimulation({ running: false });
  const hour = state.hour;
  advanceSimulation(state, 30);
  assert.equal(state.hour, hour);
  assert.equal(state.elapsed, 30);
});
test('自动四季可以跨越多个季节并循环', () => {
  const state = createSimulation({ seasonIndex: 1, seasonDuration: 60, autoSeason: true, speed: 1 });
  advanceSimulation(state, 180);
  assert.equal(state.seasonIndex, 0);
  assert.equal(getEnvironment(state).season, 'spring');
});
test('不同天气产生实际对应的雨雪雾和雷电状态', () => {
  for (const weather of ['sunny', 'cloudy', 'rain', 'fog', 'storm', 'snow']) {
    const env = getEnvironment(createSimulation({weather}));
    for (const key of ['daylight','cloudiness','rain','snow','fog','storm','wind']) {
      assert.ok(Number.isFinite(env[key]) && env[key] >= 0 && env[key] <= 1, `${weather}: ${key}`);
    }
    if (weather === 'rain') assert.ok(env.rain > 0);
    if (weather === 'storm') assert.ok(env.storm > 0 && env.rain > 0);
    if (weather === 'snow') assert.ok(env.snow > 0);
    if (weather === 'fog') assert.ok(env.fog > 0);
  }
});
test('正午和午夜照明有明显差异，冬季气温低于夏季', () => {
  const noon = getEnvironment(createSimulation({ hour: 12, seasonIndex: 1 }));
  const midnight = getEnvironment(createSimulation({ hour: 0, seasonIndex: 3 }));
  assert.ok(noon.daylight > .95);
  assert.ok(midnight.daylight < .05);
  assert.ok(noon.temperature > midnight.temperature);
});
