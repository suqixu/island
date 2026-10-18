import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNightSky} from '../src/night-sky.js';
test('天空影片状态可直接定位彗星极光，星座连线名称模式与自然状态恢复',()=>{
 const sky=createNightSky(),view=new THREE.PerspectiveCamera(80,1.6,.1,10000);view.lookAt(0,1,-1);view.updateMatrixWorld();
 try{assert.equal(typeof sky.beginFilm,'function');const before=sky.getRuntimeOptions();sky.beginFilm();sky.setRuntimeOptions({constellation:'labels'});
  const ctx={seed:7,filmTime:8,frameAt:()=>view},frame={id:'comet',start:0,localTime:8,parameters:{style:'emerald',duration:16,brightness:1}};
  sky.sampleFilm({comet:frame,aurora:{id:'a',start:0,localTime:8,parameters:{shape:'crown',brightness:1}}},ctx);
  const env={daylight:0,weather:'sunny',seasonIndex:3,season:'winter',cloudiness:.12,fog:0,moonLight:0,hour:22};sky.update(0,env,view);
  assert.equal(sky.group.getObjectByName('aurora-curtains').material.uniforms.uShape.value,3);assert.ok(sky.group.getObjectByName('aurora').visible);assert.equal(sky.group.getObjectByName('comet').userData.variant,'emerald');
  const a=Array.from(sky.group.getObjectByName('comet').geometry.attributes.position.array);sky.sampleFilm({comet:{...frame,localTime:2}},ctx);sky.update(1,env,view);sky.sampleFilm({comet:frame},ctx);sky.update(2,env,view);assert.deepEqual(Array.from(sky.group.getObjectByName('comet').geometry.attributes.position.array),a);
  sky.endFilm();assert.deepEqual(sky.getRuntimeOptions(),before);
 }finally{sky.dispose();}
});
test('彗星片段的零亮度实际进入材质，流星参数退出不污染自然状态',()=>{
 const sky=createNightSky(),camera=new THREE.PerspectiveCamera(80,1.6,.1,10000);camera.lookAt(0,1,-1);camera.updateMatrixWorld();
 const before=sky.getRuntimeOptions();sky.beginFilm();sky.setRuntimeOptions({meteor:{burstCount:32,mode:'off'}});sky.sampleFilm({comet:{id:'zero',start:0,localTime:1,parameters:{brightness:0,duration:16}}},{seed:5,filmTime:1,frameAt:()=>camera});sky.update(1,{daylight:0,cloudiness:0,fog:0,moonLight:0,hour:22,season:'summer'},camera);assert.equal(sky.group.getObjectByName('comet').material.uniforms.uOpacity.value,0);sky.endFilm();assert.deepEqual(sky.getRuntimeOptions(),before);sky.dispose();
});
