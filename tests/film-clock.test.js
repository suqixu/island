import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudCoverState,advanceCloudCover} from '../src/cloud-cover.js';
const api=await import('../src/film-clock.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('重播与退出保持模型时钟单调，云层随即继续更新',()=>{
  assert.equal(typeof api.createFilmClock,'function');
  const state={elapsed:100,hour:12,weather:'sunny'},saved={...state},clock=api.createFilmClock(state),cloud=createCloudCoverState(10);
  advanceCloudCover(cloud,state.elapsed,{weather:'sunny'});
  clock.step(30);advanceCloudCover(cloud,state.elapsed,{weather:'rain'});assert.equal(state.elapsed,130);
  clock.reset();clock.step(0);assert.equal(state.elapsed,130);clock.step(3);assert.equal(state.elapsed,133);
  state.hour=22;state.weather='rain';const advance=clock.restore(saved);
  assert.equal(advance,33);assert.equal(state.elapsed,133);assert.equal(state.hour,12);assert.equal(state.weather,'sunny');
  advanceCloudCover(cloud,state.elapsed,{weather:'sunny'});const age=cloud.age;
  state.elapsed+=.1;advanceCloudCover(cloud,state.elapsed,{weather:'sunny'});assert.ok(cloud.age>age);
});
test('影片分段运动速度累积连续，回拖不使模型时钟倒退',async()=>{const {integrateFilmMotion}=await import('../src/scene-capabilities/sampling.js');const script={duration:20,tracks:[{capability:'scene.motionRate',keyframes:[{at:0,value:1},{at:5,value:4},{at:10,value:.5}]}]};assert.equal(integrateFilmMotion(script,5),5);assert.equal(integrateFilmMotion(script,10),25);assert.equal(integrateFilmMotion(script,20),30);const state={elapsed:100},clock=api.createFilmClock(state);clock.step(integrateFilmMotion(script,10));clock.step(integrateFilmMotion(script,5));assert.equal(state.elapsed,125);});
