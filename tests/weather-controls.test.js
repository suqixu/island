import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,advanceSimulation,getEnvironment} from '../src/simulation.js';

const controls=await import('../src/weather-controls.js').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  return {};
});

test('雨按钮从普通雨、台风循环到晴天，自动天气开关保持用户选择',()=>{
  assert.equal(typeof controls.selectWeather,'function');
  const state=createSimulation({autoWeather:false});
  for(const expected of ['rain','typhoon','sunny','rain']){
    state.weatherProgress=19;state.weatherDuration=40;
    controls.selectWeather(state,'rain');
    assert.equal(state.weather,expected);
    assert.equal(state.autoWeather,false);
    assert.equal(state.weatherProgress,0);
    assert.equal(state.weatherDuration,undefined);
    const button=controls.getWeatherButtonState(state,'rain');
    assert.equal(button.selected,expected!=='sunny');
    assert.equal(button.icon,expected==='typhoon'?'typhoon':'rain');
  }
});

test('云按钮从仅v1默认档循环全部云形的少、中、多，离开后再次从默认开始',()=>{
  assert.equal(typeof controls.selectWeather,'function');
  const state=createSimulation({autoWeather:false});
  for(const mode of ['default','few','medium','many','default']){
    controls.selectWeather(state,'cloudy');
    assert.equal(state.weather,'cloudy');assert.equal(state.cloudMode,mode);
    assert.equal(controls.getWeatherButtonState(state,'cloudy').icon,
      {default:'cloud',few:'cloud-few',medium:'cloud-medium',many:'cloud-many'}[mode]);
    const env=getEnvironment(state);
    assert.equal(env.cloudMode,mode);
    if(mode!=='default')assert.ok(env.cloudCoverTarget>0&&env.cloudCoverTarget<1);
  }
  controls.selectWeather(state,'cloudy');controls.selectWeather(state,'sunny');
  assert.equal(state.cloudMode,'default');
  controls.selectWeather(state,'cloudy');assert.equal(state.cloudMode,'default');
});

test('自动天气抽到云按钮时也随机选择默认、少、中、多子档位',()=>{
  const outcomes=[];
  for(const sample of [.05,.30,.60,.95]){
    const state=createSimulation({autoSeason:false,speed:1,weather:'sunny',weatherDuration:1});
    const samples=[0,.5,sample];
    advanceSimulation(state,1,()=>samples.shift()??.5);
    assert.equal(state.weather,'cloudy');outcomes.push(state.cloudMode);
  }
  assert.deepEqual(outcomes,['default','few','medium','many']);
});

test('云量档位在真实云量计算中平滑变化，少中多保持可辨别的覆盖率',async()=>{
  const {createCloudCoverState,advanceCloudCover}=await import('../src/cloud-cover.js');
  const cover=createCloudCoverState(42),state=createSimulation({weather:'cloudy',cloudMode:'few'});
  const levels=[];
  for(const mode of ['few','medium','many']){
    state.cloudMode=mode;const env=getEnvironment(state);
    for(let frame=0;frame<300;frame++){
      const before=cover.coverage;
      advanceCloudCover(cover,(levels.length*300+frame)/30,env);
      if(frame>0)assert.ok(Math.abs(cover.coverage-before)<.03);
    }
    levels.push(cover.coverage);
  }
  assert.ok(levels[0]<.3&&levels[1]>.4&&levels[1]<.65&&levels[2]>.8,JSON.stringify(levels));
});
