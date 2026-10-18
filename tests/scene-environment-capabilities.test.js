import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {createSceneCapabilities} from '../src/scene-capabilities/index.js';
import {createSceneScheduler} from '../src/scene-capabilities/scheduler.js';
test('只接管脚本指定能力，退出恢复月相、画质和诗文',()=>{
 const state=createSimulation(),saved=structuredClone(state);let quality='high',poem=true;
 const atmosphere={getRuntimeOptions:()=>({constellation:'off'}),setRuntimeOptions(){},beginFilm(){},sampleFilm(){},endFilm(){}};
 const r=createSceneCapabilities({state,atmosphere,getQuality:()=>quality,applyQuality:q=>quality=q,poetry:{get enabled(){return poem},setEnabled:v=>poem=v}});
 const s=createSceneScheduler({registry:r});s.begin();s.apply({time:0,properties:{'scene.moonPhase':0,'environment.rain':0,'environment.windSpeed':0,'lights.path.intensity':0,'render.quality':'low','presentation.poetry':false},clips:[]});
 const env=s.composeEnvironment(getEnvironment(state));assert.equal(state.lunarDay,0);assert.equal(env.rain,0);assert.equal(env.windSpeed,0);assert.equal(env.pathLightIntensity,0);assert.equal(quality,'low');assert.equal(poem,false);
 assert.equal(env.cloudiness,getEnvironment(state).cloudiness);s.end();assert.deepEqual(state,saved);assert.equal(quality,'high');assert.equal(poem,true);
});
test('天空片段直接拖入月食中段，并同时启用星座名称与连线',()=>{
 const state=createSimulation();state.hour=22;let mode='off',ended=0,frames;
 const atmosphere={getRuntimeOptions:()=>({constellation:mode}),setRuntimeOptions:p=>{if(p.constellation)mode=p.constellation},beginFilm(){},sampleFilm:f=>frames=f,endFilm(){mode='off';ended++}};
 const r=createSceneCapabilities({state,atmosphere});const s=createSceneScheduler({registry:r});s.begin();s.apply({time:338,properties:{'scene.moonPhase':.5,'sky.constellation.mode':'labels'},clips:[{id:'e',capability:'sky.lunarEclipse',start:290,end:386,localTime:48,progress:.5,parameters:{duration:96}}]});
 const env=s.composeEnvironment(getEnvironment(state));assert.equal(mode,'labels');assert.equal(env.lunarEclipse.totality,1);assert.ok(env.lunarBloodStrength>.9);assert.deepEqual(frames,{});s.end();assert.equal(ended,1);assert.equal(mode,'off');
});
