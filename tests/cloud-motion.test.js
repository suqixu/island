import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, advanceSimulation, getEnvironment } from '../src/simulation.js';

const cloud = await import('../src/cloud-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(cloud?.createCloudMotionState && cloud?.advanceCloudMotion && cloud?.getCloudLayerSpeed,
    '云应提供连续风向积分与分层速度接口');
  return cloud;
};
const wind = { windSpeed: 6.5, gust: .2, windDirection: [1, 0] };
const separation = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('台风云速突破普通上限，快速推进且不同高度保留速度差', () => {
  const { createCloudMotionState, advanceCloudMotion, getCloudLayerSpeed } = api();
  const normal=createCloudMotionState(), storm=createCloudMotionState();
  const env={windSpeed:50,gust:.8,windDirection:[1,0],typhoon:1};
  advanceCloudMotion(normal,0,wind);advanceCloudMotion(storm,0,env);
  for(let frame=1;frame<=600;frame++) {
    advanceCloudMotion(normal,frame/60,wind);advanceCloudMotion(storm,frame/60,env);
  }
  assert.ok(storm.offset[0]>normal.offset[0]*5,'十秒内应有明显扑面而来的云程');
  const low=getCloudLayerSpeed(storm.speed,{height:175,variation:.1},1);
  const high=getCloudLayerSpeed(storm.speed,{height:405,thin:true,variation:.9},1);
  assert.ok(low>25 && high>low*1.2 && high<=72);
});

test('切入台风不缩放旧云程，风速与漂移连续提升，退出后缓慢恢复', () => {
  const {createCloudMotionState,advanceCloudMotion}=api(),state=createCloudMotionState();
  advanceCloudMotion(state,0,wind);advanceCloudMotion(state,.05,wind);
  const previous=[...state.offset];
  const storm={windSpeed:55,gust:1,typhoon:1,windDirection:[1,0]};
  advanceCloudMotion(state,.1,storm);
  assert.ok(separation(previous,state.offset)<.5,'不能乘累计时长跳位');
  for(let frame=3;frame<=240;frame++)advanceCloudMotion(state,frame*.05,storm);
  assert.ok(state.speed>35);
  for(let frame=241;frame<=640;frame++)advanceCloudMotion(state,frame*.05,wind);
  assert.ok(state.speed<9);
});

test('16倍速在30帧画面中仍积分完整云层时间，切回后不跳位', () => {
  const { createCloudMotionState, advanceCloudMotion } = api();
  const state = createCloudMotionState();
  advanceCloudMotion(state, 0, { ...wind, animationRate: 16 });
  for (let frame = 1; frame <= 30; frame++) advanceCloudMotion(state, frame * 16 / 30, { ...wind, animationRate: 16 });
  assert.ok(state.offset[0] > 77 && state.offset[0] < 79, '一秒真实时间完整前行十六秒云程');
  const previous = [...state.offset];
  advanceCloudMotion(state, 16 + 1 / 30, wind);
  assert.ok(separation(previous, state.offset) < .17);
});

test('晴天云十秒漂移约五十米，初次进入场景不按绝对 elapsed 跳位置', () => {
  const { createCloudMotionState, advanceCloudMotion } = api(), state = createCloudMotionState();
  assert.deepEqual(advanceCloudMotion(state, 600, wind).offset, [0, 0]);
  let result;
  for (let frame = 1; frame <= 600; frame++) result = advanceCloudMotion(state, 600 + frame / 60, wind);
  assert.ok(result.offset[0] > 40 && result.offset[0] < 60);
  assert.ok(Math.abs(result.offset[1]) < .001);
  assert.ok(result.speed >= 2 && result.speed <= 9);
});

test('天气和阵风换强时仅改变后续小步速度，不让累计位移跳动', () => {
  const { createCloudMotionState, advanceCloudMotion } = api(), state = createCloudMotionState();
  let before = advanceCloudMotion(state, 0, wind);
  for (let frame = 1; frame <= 60; frame++) before = advanceCloudMotion(state, frame / 60, wind);
  const after = advanceCloudMotion(state, 61 / 60, { windSpeed: 22, gust: 1, windDirection: [1, 0] });
  assert.ok(separation(before.offset, after.offset) < .16);
  assert.ok(after.speed > before.speed && after.speed - before.speed < .05);
  let final = after;
  for (let frame = 62; frame <= 600; frame++) final = advanceCloudMotion(state, frame / 60,
    { windSpeed: 22, gust: 1, windDirection: [1, 0] });
  assert.ok(final.speed > after.speed + 2 && final.speed <= 9);
});

test('风向经过九十度与反向时平滑转弯，方向始终为单位向量', () => {
  const { createCloudMotionState, advanceCloudMotion } = api(), state = createCloudMotionState();
  let previous = advanceCloudMotion(state, 0, wind);
  for (let frame = 1; frame <= 1200; frame++) {
    const direction = frame < 600 ? [0, 1] : [-1, 0];
    const current = advanceCloudMotion(state, frame / 60, { ...wind, windDirection: direction });
    assert.ok(separation(current.direction, previous.direction) < .02);
    assert.ok(Math.abs(Math.hypot(...current.direction) - 1) < 1e-9);
    assert.ok(separation(current.offset, previous.offset) < .16);
    previous = current;
  }
  assert.ok(previous.direction[0] < -.95);
});

test('高层薄云比低层积云更快，个体速度不同且实际速度限制在二至九米每秒', () => {
  const { getCloudLayerSpeed } = api();
  const low = getCloudLayerSpeed(5, { height: 175, thin: false, variation: .2 });
  const high = getCloudLayerSpeed(5, { height: 405, thin: true, variation: .8 });
  assert.ok(high > low * 1.25);
  assert.notEqual(getCloudLayerSpeed(5, { variation: .1 }), getCloudLayerSpeed(5, { variation: .9 }));
  for (const speed of [0, 2, 5, 9, 30, NaN]) for (const thin of [false, true]) {
    const result = getCloudLayerSpeed(speed, { height: 600, thin, variation: 1 });
    assert.ok(result >= 2 && result <= 9);
  }
});

test('暂停昼夜、修改小时和模拟倍速不影响相同真实时间的云速与漂移', () => {
  const { createCloudMotionState, advanceCloudMotion } = api();
  const paused = createSimulation({ running: false, hour: 14.5, speed: 1, windSeed: 2718 });
  const accelerated = createSimulation({ running: true, hour: 17.5, speed: 4, windSeed: 2718,
    autoWeather: false, autoSeason: false });
  const a = createCloudMotionState(), b = createCloudMotionState();
  advanceCloudMotion(a, 0, getEnvironment(paused)); advanceCloudMotion(b, 0, getEnvironment(accelerated));
  let first, second;
  for (let frame = 0; frame < 1200; frame++) {
    advanceSimulation(paused, 1 / 60); advanceSimulation(accelerated, 1 / 60);
    if (frame === 300) paused.hour = 23;
    first = advanceCloudMotion(a, paused.elapsed, getEnvironment(paused));
    second = advanceCloudMotion(b, accelerated.elapsed, getEnvironment(accelerated));
  }
  assert.deepEqual(first.offset, second.offset);
  assert.deepEqual(first.direction, second.direction);
  assert.ok(Math.hypot(...first.offset) > 70);
});

test('异常风场和倒退时间保持有限，重复时间与长间隔不会传送云层', () => {
  const { createCloudMotionState, advanceCloudMotion } = api(), state = createCloudMotionState();
  let previous = advanceCloudMotion(state, 10, wind);
  for (const time of [NaN, Infinity, 0, 10, 10.1, 500]) {
    const current = advanceCloudMotion(state, time, { windSpeed: NaN, gust: Infinity, windDirection: [0, 0] });
    assert.ok(current.offset.every(Number.isFinite) && current.direction.every(Number.isFinite));
    assert.ok(Number.isFinite(current.speed));
    assert.ok(separation(previous.offset, current.offset) <= 9 * .25 + 1e-9);
    previous = current;
  }
});
