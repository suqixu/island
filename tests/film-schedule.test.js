import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFilmScript} from '../src/film-script.js';
import preset from '../src/assets/data/films/isola-sunset.json' with {type:'json'};
const api=await import('../src/scene-capabilities/sampling.js').catch(()=>({}));
test('第二版轨道与片段按绝对时间采样、片尾不残留，未知和越界参数拒绝',()=>{
 const s={...structuredClone(preset),schemaVersion:2,tracks:[{capability:'scene.moonPhase',interpolation:'step',keyframes:[{at:0,value:0},{at:10,value:.5}]}],clips:[{id:'shower',capability:'sky.meteor',start:5,end:15,parameters:{burstCount:18,maxActive:24}}]};
 const parsed=parseFilmScript(s);assert.equal(typeof api.sampleFilmSchedule,'function');
 assert.equal(api.sampleFilmSchedule(parsed,9).properties['scene.moonPhase'],0);assert.equal(api.sampleFilmSchedule(parsed,10).properties['scene.moonPhase'],.5);
 assert.equal(api.sampleFilmSchedule(parsed,10).clips[0].localTime,5);assert.equal(api.sampleFilmSchedule(parsed,15).clips.length,0);
 for(const change of [v=>v.tracks[0].capability='unknown',v=>v.clips[0].parameters.burstCount=33,v=>v.clips[0].parameters.extra=1,v=>v.tracks.push(v.tracks[0]),v=>v.clips.push({...v.clips[0],id:'overlap'})]){const bad=structuredClone(s);change(bad);assert.throws(()=>parseFilmScript(bad));}
 const legacy={...preset,schemaVersion:1,tracks:undefined,clips:undefined};assert.equal(parseFilmScript(legacy).schemaVersion,1);
});
test('同一月相轨道可在关键点指定连续变化，其他区间保持不变',()=>{
 const script={duration:20,tracks:[{capability:'scene.moonPhase',interpolation:'step',keyframes:[{at:0,value:.5},{at:5,value:0,interpolation:'linear'},{at:6,value:.25,interpolation:'linear'},{at:7,value:.5},{at:10,value:0}]}]};
 api.validateFilmSchedule(script);assert.equal(api.sampleFilmSchedule(script,4).properties['scene.moonPhase'],.5);assert.equal(api.sampleFilmSchedule(script,5.5).properties['scene.moonPhase'],.125);assert.equal(api.sampleFilmSchedule(script,6.5).properties['scene.moonPhase'],.375);assert.equal(api.sampleFilmSchedule(script,9).properties['scene.moonPhase'],.5);
});
