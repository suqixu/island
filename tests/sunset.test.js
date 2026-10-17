import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment } from '../src/simulation.js';

const sunset = await import('../src/sunset.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const stateAt = (hour, weather = 'sunny') => {
  assert.ok(sunset?.getSunsetState, '晚霞应提供共享的纯数值驱动');
  const env = getEnvironment(createSimulation({ hour, weather, windSeed: 1 }));
  return sunset.getSunsetState({ ...env, sunHeight: env.sun[1] / Math.hypot(...env.sun) });
};

test('正午与深夜关闭晚霞混合，正午保留暖白日盘亮度', () => {
  const noon = stateAt(12), night = stateAt(23);
  for (const state of [noon, night]) {
    assert.equal(state.glow, 0);
    assert.equal(state.horizonMix, 0);
    assert.equal(state.zenithMix, 0);
  }
  assert.equal(noon.discIntensity, 3.6);
  assert.ok(noon.sunColor[1] > .85 && noon.sunColor[2] > .7);
});

test('真实十七点至十八点的日盘连续从金橙转朱红，地平线附近不烧成白盘', () => {
  let previousRatio = Infinity;
  for (const hour of [17, 17.4, 17.8, 17.95, 18]) {
    const state = stateAt(hour), ratio = state.sunColor[1] / state.sunColor[0];
    assert.ok(ratio <= previousRatio + 1e-9);
    previousRatio = ratio;
  }
  const golden = stateAt(17), horizon = stateAt(18);
  assert.ok(golden.sunColor[1] / golden.sunColor[0] > .35);
  assert.ok(horizon.sunColor[1] / horizon.sunColor[0] < .08);
  assert.ok(horizon.sunColor[2] / horizon.sunColor[0] < .025);
  assert.ok(horizon.discIntensity < 1.4);
  assert.ok(horizon.sunColor[1] * horizon.discIntensity < .12);
});

test('十七点八分段晚霞鲜明，落后保留火色与玫紫余晖，十八点八恢复夜色', () => {
  assert.ok(stateAt(17.8).glow > .8);
  const burnt = stateAt(18.05), rose = stateAt(18.2);
  assert.ok(burnt.glow > .8 && rose.glow > .8);
  assert.ok(rose.afterglow > burnt.afterglow);
  assert.ok(burnt.cloudGold[0] > burnt.cloudShadow[0] * 3);
  assert.ok(burnt.cloudShadow[2] > burnt.cloudShadow[0]);
  assert.ok(rose.horizonColor[2] > burnt.horizonColor[2]);
  assert.equal(stateAt(18.8).glow, 0);
});

test('阴云与雨雾雪雷共同遮蔽晚霞，不把余晖错误地绑在可见日盘上', () => {
  const clear = stateAt(18.05);
  assert.ok(clear.glow > .8);
  assert.ok(stateAt(18.05, 'cloudy').glow < clear.glow * .4);
  for (const weather of ['rain', 'fog', 'snow', 'storm']) {
    assert.ok(stateAt(18.05, weather).glow < clear.glow * .2, weather);
  }
});

test('日落前后逐秒颜色、霞光和日盘亮度没有跳变', () => {
  let previous = stateAt(16);
  for (let second = 1; second <= 3 * 3600; second++) {
    const current = stateAt(16 + second / 3600);
    for (const key of ['glow', 'horizonMix', 'zenithMix', 'redness', 'discIntensity', 'afterglow']) {
      assert.ok(Math.abs(current[key] - previous[key]) < .012, key);
    }
    for (const key of ['sunColor', 'horizonColor', 'zenithColor', 'cloudGold', 'cloudRose', 'cloudShadow']) {
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(current[key][channel] - previous[key][channel]) < .012, key);
    }
    previous = current;
  }
});

test('异常输入保守关闭霞光，数值有效且不同结果的颜色数组独立', () => {
  assert.ok(sunset?.getSunsetState);
  const first = sunset.getSunsetState({ sunHeight: NaN, daylight: NaN });
  assert.equal(first.glow, 0);
  for (const value of Object.values(first)) {
    if (Array.isArray(value)) assert.ok(value.every(Number.isFinite));
    else assert.ok(Number.isFinite(value));
  }
  const a = stateAt(17.8), b = stateAt(17.8);
  a.sunColor[0] = 99;
  assert.notEqual(b.sunColor[0], 99);
});
