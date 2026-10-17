import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment, advanceSimulation } from '../src/simulation.js';
import * as moon from '../src/moon.js';
import { getSunVisibility } from '../src/sun-framing.js';

const lunarCycle = 29.53059;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} ≈ ${expected}`);

test('新月、上弦、满月和下弦分别呈现零、半、全、半的受光面积', () => {
  for (const [age, phase, illumination] of [[0, 0, 0], [7.3826475, .25, .5], [14.765295, .5, 1], [22.1479425, .75, .5]]) {
    const env = getEnvironment(createSimulation({ lunarDay: age }));
    near(env.moonPhase, phase);
    near(env.moonIllumination, illumination);
    near(env.moonAge, age);
  }
});

test('八种月相区分盈亏，并为月相控制提供对应的中文名称', async () => {
  const moon = await import('../src/moon.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(moon, '月相模块应提供八相选项与纯函数');
  assert.equal(typeof moon.getMoonState, 'function');
  assert.equal(moon.LUNAR_CYCLE_DAYS, lunarCycle);
  assert.equal(moon.MOON_PHASES.length, 8);
  for (const option of moon.MOON_PHASES) {
    const result = moon.getMoonState(option.phase * lunarCycle);
    near(result.moonPhase, option.phase);
    assert.equal(result.moonPhaseName, option.name);
    assert.ok(option.name.length > 0);
  }
  const waxing = moon.getMoonState(7.3826475);
  const waning = moon.getMoonState(22.1479425);
  assert.equal(waxing.moonPhaseName, '上弦月');
  assert.equal(waning.moonPhaseName, '下弦月');
  assert.ok(waxing.moonPhase < .5 && waning.moonPhase > .5);
});

test('月龄在整月、多个周期和负月龄处环绕', () => {
  for (const [input, age, phase] of [[29.53059, 0, 0], [88.59177, 0, 0], [66.4438275, 7.3826475, .25], [-7.3826475, 22.1479425, .75]]) {
    const env = getEnvironment(createSimulation({ lunarDay: input }));
    near(env.moonAge, age);
    near(env.moonPhase, phase);
    assert.ok(env.moonPhase >= 0 && env.moonPhase < 1);
  }
});

test('默认月相在午夜呈现满月和完整月光', () => {
  const state = createSimulation({ hour: 0 });
  assert.equal(state.autoMoon, true);
  near(state.lunarDay, 14.765295);
  const env = getEnvironment(state);
  near(env.moonIllumination, 1);
  near(env.moonLight, 1);
});

test('自动月相按速度与模拟日时长推进，并处理跨多个周期的大时间差', () => {
  const state = createSimulation({ lunarDay: 28.53059, speed: 2, dayDuration: 100 });
  advanceSimulation(state, 50);
  near(state.lunarDay, 0);
  advanceSimulation(state, 3153.059);
  near(state.lunarDay, 4);
});

test('暂停、关闭自动月相和零速度时月龄保持，手动调小时不改变月龄', () => {
  for (const override of [{ running: false }, { autoMoon: false }, { speed: 0 }]) {
    const state = createSimulation({ lunarDay: 7.3826475, ...override });
    advanceSimulation(state, 720);
    near(state.lunarDay, 7.3826475);
    assert.equal(state.elapsed, 720);
  }
  const state = createSimulation({ lunarDay: 7.3826475 });
  state.hour = 0;
  getEnvironment(state);
  near(state.lunarDay, 7.3826475);
});

test('月亮在十八点升起、午夜升至三十度、六点落下，正午位于地平线下', () => {
  for (const [hour, altitude] of [[18, 0], [0, Math.PI / 6], [6, 0], [12, -Math.PI / 6]]) {
    const env = getEnvironment(createSimulation({ hour }));
    near(env.moonAltitude, altitude);
    near(Math.hypot(...env.moon), 1);
    near(env.moon[1], Math.sin(altitude));
    assert.ok(env.moon[2] < 0, '月亮始终位于海岛后方天空');
    if (hour !== 0) near(env.moonLight, 0);
  }
  const rising = getEnvironment(createSimulation({ hour: 18 }));
  const setting = getEnvironment(createSimulation({ hour: 6 }));
  assert.ok(Math.hypot(rising.moon[0] - setting.moon[0], rising.moon[2] - setting.moon[2]) > .5);
});

test('月光受月相和高度共同约束，新月不照亮海岛，半月午夜亮度为满月的一半', () => {
  const newMoon = getEnvironment(createSimulation({ hour: 0, lunarDay: 0 }));
  const halfMoon = getEnvironment(createSimulation({ hour: 0, lunarDay: 7.3826475 }));
  const lowMoon = getEnvironment(createSimulation({ hour: 19, lunarDay: 14.765295 }));
  near(newMoon.moonLight, 0);
  near(halfMoon.moonLight, .5);
  assert.ok(lowMoon.moonLight > 0 && lowMoon.moonLight < .5);
});

test('月亮夜间可见度在白天关闭、深夜完全显现，并限制输入范围', () => {
  assert.equal(typeof moon.getMoonNightVisibility, 'function');
  for (const daylight of [.17, .24, 1, 2]) assert.equal(moon.getMoonNightVisibility(daylight), 0);
  for (const daylight of [.04, 0, -.2]) assert.equal(moon.getMoonNightVisibility(daylight), 1);
  near(moon.getMoonNightVisibility(.105), .5);
});

test('暮色中月亮可见度连续淡入，黎明连续淡出', () => {
  const values = Array.from({ length: 131 }, (_, index) => moon.getMoonNightVisibility(.04 + index * .001));
  near(values[0], 1);
  near(values.at(-1), 0);
  for (let index = 1; index < values.length; index++) {
    assert.ok(values[index] <= values[index - 1]);
    assert.ok(values[index - 1] - values[index] < .012);
  }
  assert.ok(values[0] - values[1] < values[64] - values[65]);
  assert.ok(values.at(-2) - values.at(-1) < values[64] - values[65]);
});

test('日出落时月亮与月光关闭，太阳落完后淡入且黎明呈对称淡出', () => {
  for (const hour of [6, 18, 18.1]) {
    const env = getEnvironment(createSimulation({ hour }));
    assert.equal(env.moonVisibility, 0);
    assert.equal(env.moonLight, 0);
  }
  const evening = getEnvironment(createSimulation({ hour: 18.2 }));
  const later = getEnvironment(createSimulation({ hour: 18.3 }));
  const dawn = getEnvironment(createSimulation({ hour: 5.8 }));
  assert.ok(evening.moonVisibility > 0 && evening.moonVisibility < 1);
  assert.ok(later.moonVisibility > evening.moonVisibility);
  assert.ok(evening.moonLight > 0 && evening.moonLight < .05479922624882126);
  near(dawn.moonVisibility, evening.moonVisibility);
  near(dawn.moonLight, evening.moonLight);
});

test('深夜显现不改变十九点、二十二点及午夜既有月光亮度', () => {
  for (const [hour, originalLight] of [[19, .27020584206042925], [22, .8761386779733473], [0, 1]]) {
    const env = getEnvironment(createSimulation({ hour }));
    assert.equal(env.moonVisibility, 1);
    near(env.moonLight, originalLight);
  }
});

test('完整二十四小时逐分钟验证：可见太阳不会和大月亮同时显现', () => {
  let visibleSunSamples = 0;
  let visibleMoonSamples = 0;
  for (let minute = 0; minute <= 24 * 60; minute++) {
    const env = getEnvironment(createSimulation({ hour: minute / 60, weather: 'sunny', windSeed: 17 }));
    assert.ok(env.moonVisibility >= 0 && env.moonVisibility <= 1);
    const sunHeight = env.sun[1] / Math.hypot(...env.sun);
    const sunVisibility = getSunVisibility({ ...env, sunHeight });
    if (sunVisibility >= .001) {
      visibleSunSamples++;
      assert.equal(env.moonVisibility, 0, `${env.hour}点太阳仍可见时应关闭月盘`);
      assert.equal(env.moonLight, 0, `${env.hour}点太阳仍可见时应关闭月光`);
    }
    if (env.moonVisibility > 0) visibleMoonSamples++;
  }
  assert.ok(visibleSunSamples > 700, '应实际覆盖完整日间太阳阶段');
  assert.ok(visibleMoonSamples > 600, '应实际覆盖完整夜间月亮阶段');
});
