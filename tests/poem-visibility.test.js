import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment } from '../src/simulation.js';
import { LUNAR_CYCLE_DAYS } from '../src/moon.js';

const visibility = await import('../src/poem-visibility.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function api() {
  assert.ok(visibility, '明月可见性模块应根据真实环境决定字幕透明度');
  return visibility.getPoemVisibility;
}

const environment = (overrides = {}) => ({...getEnvironment(createSimulation({ hour: 0, weather: 'sunny', ...overrides })),moonInFrame:true});

test('只有画面中的满月呈现诗句，月牙、弦月、凸月和画面外的月亮均不显示',()=>{
  const getPoemVisibility=api();
  for(const phase of [.125,.25,.375,.625,.75,.875]) {
    assert.equal(getPoemVisibility(environment({hour:22,lunarDay:phase*LUNAR_CYCLE_DAYS})),0);
  }
  const full=environment({hour:22,lunarDay:.5*LUNAR_CYCLE_DAYS});
  assert.equal(getPoemVisibility(full),1);
  assert.equal(getPoemVisibility({...full,moonInFrame:false}),0);
  assert.equal(getPoemVisibility({...full,moonInFrame:undefined}),0);
});

test('白天和正午无论月相与天气都不呈现诗', () => {
  const getPoemVisibility = api();
  for (const hour of [8, 12, 16]) {
    for (const phase of [0, .125, .25, .5, .75, .875]) {
      for (const weather of ['sunny', 'cloudy', 'rain', 'storm', 'fog', 'snow']) {
        assert.equal(getPoemVisibility(environment({ hour, lunarDay: phase * LUNAR_CYCLE_DAYS, weather })), 0);
      }
    }
  }
});

test('晴朗夜晚的新月没有可辨亮面，字幕保持隐藏', () => {
  const getPoemVisibility = api();
  for (const hour of [19, 20, 22, 0, 4, 5]) {
    const env = environment({ hour, lunarDay: 0 });
    assert.equal(env.moonIllumination, 0);
    assert.equal(getPoemVisibility(env), 0);
  }
});

test('月亮位于地平线以下或恰在月升月落时字幕为零', () => {
  const getPoemVisibility = api();
  for (const hour of [6, 6.1, 12, 17.9, 18]) {
    const env = environment({ hour });
    assert.ok(env.moonAltitude <= 0);
    assert.equal(getPoemVisibility(env), 0);
  }
});

test('真实浓云、雨、雷雨、浓雾和雪夜预设遮蔽月亮时都隐藏字幕', () => {
  const getPoemVisibility = api();
  for (const weather of ['cloudy', 'rain', 'storm', 'fog', 'snow']) {
    for (const hour of [19, 22, 0, 4]) {
      const env = environment({ hour, weather });
      assert.ok(env.moonLight > 0, '几何月光仍存在，字幕必须考虑天气遮蔽');
      assert.equal(getPoemVisibility(env), 0, `${weather}在${hour}点应遮住字幕`);
    }
  }
});

test('真实黎明与月落过程中字幕经过多个中间透明度连续淡出', () => {
  const getPoemVisibility = api();
  const levels = [4.5, 5.4, 5.5, 5.55, 5.6, 5.65, 5.7, 5.75, 5.8, 6, 6.2]
    .map(hour => getPoemVisibility(environment({ hour })));
  assert.equal(levels[0], 1);
  assert.equal(levels.at(-1), 0);
  assert.ok(levels.filter(level => level > 0 && level < 1).length >= 4, '黎明应保留渐变而非跳变开关');
  for (let index = 1; index < levels.length; index++) assert.ok(levels[index] <= levels[index - 1]);
  const before = getPoemVisibility(environment({ hour: 5.6 }));
  const after = getPoemVisibility(environment({ hour: 5.6001 }));
  assert.ok(Math.abs(after - before) < .002, '极小时间步不能造成透明度跳变');
});

test('真实月升过程从零逐渐显现，淡入不突然跳至完整透明度', () => {
  const getPoemVisibility = api();
  const levels = [18, 18.2, 18.4, 18.5, 18.6, 19, 20]
    .map(hour => getPoemVisibility(environment({ hour })));
  assert.equal(levels[0], 0);
  assert.equal(levels.at(-1), 1);
  assert.ok(levels.some(level => level > 0 && level < 1));
  for (let index = 1; index < levels.length; index++) assert.ok(levels[index] >= levels[index - 1]);
});

test('连续增加云量或雾强度时字幕逐渐减弱，浓云浓雾完全阻断', () => {
  const getPoemVisibility = api();
  const clearNight = environment();
  for (const [key, values] of [['cloudiness', [.58, .62, .66, .7, .74, .76]], ['fog', [.3, .4, .5, .6, .7, .9]]]) {
    const levels = values.map(value => getPoemVisibility({ ...clearNight, [key]: value }));
    assert.equal(levels[0], 1);
    assert.equal(levels.at(-1), 0);
    assert.ok(levels.filter(level => level > 0 && level < 1).length >= 3, `${key}应连续遮蔽月光`);
    for (let index = 1; index < levels.length; index++) assert.ok(levels[index] <= levels[index - 1]);
  }
});

test('缺失或异常环境保守隐藏，有限输入的透明度始终在零到一', () => {
  const getPoemVisibility = api();
  const clearNight = environment();
  for (const env of [undefined, null, {}, 'night', { daylight: 0, moonLight: 1 }]) {
    assert.equal(getPoemVisibility(env), 0);
  }
  for (const key of ['daylight', 'moonLight', 'moonAltitude', 'moonIllumination', 'cloudiness', 'fog']) {
    for (const invalid of [undefined, NaN, Infinity, -Infinity, '0']) {
      assert.equal(getPoemVisibility({ ...clearNight, [key]: invalid }), 0, `${key}缺失时不应冒出字幕`);
    }
  }
  for (const overrides of [{ daylight: 1 }, { moonLight: 0 }, { moonAltitude: -.1 }, { moonIllumination: 0 }]) {
    assert.equal(getPoemVisibility({ ...clearNight, ...overrides }), 0);
  }
  for (const overrides of [{ daylight: -10 }, { daylight: 10 }, { cloudiness: -10 }, { cloudiness: 10 }, { fog: -10 }, { fog: 10 }, { moonLight: Number.MAX_VALUE }]) {
    const level = getPoemVisibility({ ...clearNight, ...overrides });
    assert.ok(Number.isFinite(level) && level >= 0 && level <= 1);
  }
});

test('多云月夜仍看得清月盘时，以实际月盘可见度呈现诗句', () => {
  const getPoemVisibility = api();
  const env = environment({hour:22,weather:'cloudy'});
  assert.ok(getPoemVisibility({...env,moonDiscOpacity:.24})>.8,
    '渲染中的明月清晰可辨，不能被多云预设一律隐藏');
  assert.equal(getPoemVisibility({...env,moonDiscOpacity:0}),0);
  const levels=[0,.10,.14,.18,.22,.26].map(moonDiscOpacity=>getPoemVisibility({...env,moonDiscOpacity}));
  for(let i=1;i<levels.length;i++)assert.ok(levels[i]>=levels[i-1],'月盘逐渐清晰时诗句连续显现');
  assert.ok(levels.some(level=>level>0&&level<.8));
});

test('实际月盘消失或可见度异常时，不因晴夜预设继续显示诗句', () => {
  const getPoemVisibility = api();
  for(const moonDiscOpacity of [0,-1,NaN,Infinity,-Infinity,'1']){
    assert.equal(getPoemVisibility({...environment(),moonDiscOpacity}),0);
  }
});
