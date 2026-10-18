import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, getEnvironment, advanceSimulation } from '../src/simulation.js';

test('自动天气按随机抽样跳转，不再按固定顺序且不会连续重复', () => {
  const outcomes=[];
  for(const sample of [.1,.35,.6,.9]){
    const state=createSimulation({speed:1,autoSeason:false,weather:'sunny',weatherDuration:1});
    advanceSimulation(state,1,()=>sample);outcomes.push(state.weather);
    assert.notEqual(state.weather,'sunny');
  }
  assert.deepEqual(new Set(outcomes),new Set(['cloudy','rain','fog','storm']));
});

test('随机天气遵守季节候选，非冬无雪、冬季无雷暴，换季清理不合季节的天气',()=>{
  for(const seasonIndex of [0,1,2,3]){
    const outcomes=new Set();
    for(const sample of [.1,.35,.6,.9]){
      const state=createSimulation({speed:1,autoSeason:false,seasonIndex,weather:'sunny',weatherDuration:1});
      advanceSimulation(state,1,()=>sample);outcomes.add(state.weather);
    }
    assert.deepEqual(outcomes,new Set(seasonIndex===3?['cloudy','rain','fog','snow']:['cloudy','rain','fog','storm']));
  }
  for(const [seasonIndex,weather]of [[0,'snow'],[1,'snow'],[2,'snow'],[3,'storm']]){
    const state=createSimulation({autoSeason:false,seasonIndex:seasonIndex===3?1:3,weather});
    state.seasonIndex=seasonIndex;
    advanceSimulation(state,0,()=>.5);assert.notEqual(state.weather,weather);
  }
});

test('每轮天气重新随机持续时长，并保留跨轮剩余时间',()=>{
  const fast=createSimulation({speed:1,autoSeason:false,weatherDuration:1});
  const slow=createSimulation({speed:1,autoSeason:false,weatherDuration:1});
  const slowSamples = [.9, .99];
  advanceSimulation(fast,1,()=>0);advanceSimulation(slow,1,()=>slowSamples.shift());
  advanceSimulation(fast,40,()=>.9);advanceSimulation(slow,40,()=>.9);
  assert.equal(fast.weather,'storm','短时长应已进入下一种天气');
  assert.equal(slow.weather,'storm','长时长仍保持首次抽中的天气');
  assert.ok(fast.weatherProgress>0&&fast.weatherProgress<10);
  assert.equal(slow.weatherProgress,40);
  const original=slow.weather;
  advanceSimulation(slow,44,()=>.1);assert.equal(slow.weather,original);
  advanceSimulation(slow,1,()=>.1);assert.notEqual(slow.weather,original);
});

test('关闭天气循环保留手动天气，暂停轮换不推进天气计时',()=>{
  const manual=createSimulation({autoWeather:false,seasonIndex:1,weather:'snow'});
  advanceSimulation(manual,500,()=>0);assert.equal(manual.weather,'snow');
  const paused=createSimulation({running:false,weather:'rain',weatherProgress:30});
  advanceSimulation(paused,500,()=>0);assert.equal(paused.weather,'rain');assert.equal(paused.weatherProgress,30);
});

test('暂停轮换时手动换季仍校正自动天气，但不推进天气计时',()=>{
  for(const [from,to,weather]of [[1,3,'storm'],[3,1,'snow']]){
    const state=createSimulation({running:false,autoSeason:false,seasonIndex:from,weather,weatherProgress:12});
    state.seasonIndex=to;advanceSimulation(state,100,()=>.5);
    assert.notEqual(state.weather,weather,'暂停时也不能把雷暴或飘雪带入不匹配的季节');
    assert.equal(state.weatherProgress,0);
    const corrected=state.weather;advanceSimulation(state,100,()=>0);
    assert.equal(state.weather,corrected);assert.equal(state.weatherProgress,0);
  }
});

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
  assert.equal(getEnvironment(state).dayIndex,1);
});

test('模拟日期只在自然跨午夜时递增，手动调整时刻不重置日期',()=>{
  const state=createSimulation({hour:23,speed:1,dayDuration:24,autoWeather:false,autoSeason:false});
  advanceSimulation(state,50);assert.equal(state.dayIndex,3);assert.equal(state.hour,1);
  state.hour=12;advanceSimulation(state,0);assert.equal(getEnvironment(state).dayIndex,3);
});

test('日食期间保持太阳时刻而环境动画继续，解除后恢复昼夜',()=>{
  const state=createSimulation({hour:12,holdSunClock:true,autoWeather:false,autoSeason:false});
  advanceSimulation(state,30);assert.equal(state.hour,12);assert.equal(state.elapsed,30);assert.equal(state.dayIndex,0);
  state.holdSunClock=false;advanceSimulation(state,30);assert.equal(state.hour,13);assert.equal(state.elapsed,60);
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

test('台风环境独立标记，强风保持归一化并给出真实风速与适中能见度', () => {
  for (const weather of ['sunny', 'cloudy', 'rain', 'fog', 'storm', 'snow', 'typhoon']) {
    for (const elapsed of [0, 7, 30, 65, 120]) {
      const env = getEnvironment(createSimulation({ weather, elapsed, windSeed: 381 }));
      assert.equal(env.typhoon, weather === 'typhoon' ? 1 : 0);
      assert.ok(env.wind >= 0 && env.wind <= 1);
      if (weather === 'typhoon') {
        assert.ok(env.windSpeed >= 35 && env.windSpeed <= 60);
        assert.ok(env.cloudiness >= .95 && env.rain >= .95 && env.storm >= .8);
        assert.ok(env.fog <= .3, '保留巨浪与全岛轮廓');
        assert.ok(env.gust >= .55, '强风持续施加于现有植被风场');
      } else assert.ok(env.windSpeed >= 1.5 && env.windSpeed <= 21);
    }
  }
});

test('自动台风仅在夏秋以约百分之五概率出现，且不会连续重复', () => {
  for (const seasonIndex of [0, 1, 2, 3]) {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      const state = createSimulation({ speed: 1, autoSeason: false, seasonIndex, weather: 'sunny', weatherDuration: 1 });
      advanceSimulation(state, 1, () => (i + .5) / 1000);
      if (state.weather === 'typhoon') count++;
    }
    assert.equal(count, seasonIndex === 1 || seasonIndex === 2 ? 50 : 0);
  }
  const repeated = createSimulation({ speed: 1, autoSeason: false, seasonIndex: 1, weather: 'typhoon', weatherDuration: 1 });
  advanceSimulation(repeated, 1, () => .99);
  assert.notEqual(repeated.weather, 'typhoon');
});

test('手动台风可跨季选择，换入春冬的自动天气会清理台风', () => {
  const manual = createSimulation({ autoSeason: false, autoWeather: false, seasonIndex: 3, weather: 'typhoon' });
  advanceSimulation(manual, 500, () => .99);
  assert.equal(manual.weather, 'typhoon');
  for (const seasonIndex of [0, 3]) {
    const automatic = createSimulation({ running: false, autoSeason: false, seasonIndex: 1, weather: 'typhoon' });
    automatic.seasonIndex = seasonIndex;
    advanceSimulation(automatic, 0, () => .99);
    assert.notEqual(automatic.weather, 'typhoon');
  }
});
