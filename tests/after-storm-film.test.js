import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {parseFilmScript,sampleFilmScript} from '../src/film-script.js';
import {sampleFilmSchedule} from '../src/scene-capabilities/sampling.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {createSceneCapabilities} from '../src/scene-capabilities/index.js';
import {createSceneScheduler} from '../src/scene-capabilities/scheduler.js';
import {createSunsetBirds} from '../src/sunset-birds.js';
import {createNightSky} from '../src/night-sky.js';

const source=()=>readFileSync(new URL('../src/assets/data/films/isola-after-storm.json',import.meta.url),'utf8');

// 缺失的天气轨道或有历史依赖的彩虹会使直接跳到片尾得不到晴天和彩虹。
test('彩虹全片有效，天气渐强再转晴，直接定位片尾可见彩虹',()=>{
 const film=parseFilmScript(source());
 assert.equal(film.duration,60);assert.equal(film.music.trackId,'pingsha');
 for(let t=0;t<=60;t+=.25)assert.doesNotThrow(()=>sampleFilmScript(film,t));
 const at=t=>sampleFilmSchedule(film,t);
 assert.equal(at(3).properties['environment.rain'],0);
 assert.ok(at(12).properties['environment.rain']>0);
 assert.ok(at(20).properties['environment.cloudiness']>.85);
 assert.ok(at(30).properties['environment.typhoon']>.9);
 assert.ok(at(38).properties['environment.roughSea']>.9);
 assert.ok(at(38).properties['audio.musicVolume']<at(3).properties['audio.musicVolume']);
 assert.equal(at(55).properties['environment.rain'],0);
 assert.equal(at(55).properties['environment.typhoon'],0);
 assert.ok(at(55).properties['sky.rainbow.strength']>.8);
 assert.equal(at(30).properties['sky.rainbow.strength'],0);
 assert.equal(at(31).clips.filter(c=>c.capability==='wildlife.sunsetBird').length,1);
 assert.equal(at(35).clips.length,0);
 assert.ok(sampleFilmScript(film,58).captions.some(c=>c.text.includes('风雨之后')));
});

// 仍套用落日透光门槛会让暴雨中的飞鸟完全透明；顺序计时会破坏回拖。
test('暴风雨中只出现一只逆风鸟，振翅与偏移可回看，离开片段后隐藏',()=>{
 const birds=createSunsetBirds({random:()=>.5}),camera=new THREE.PerspectiveCamera(52,16/9,.5,65000);
 camera.position.set(180,70,260);camera.lookAt(0,35,0);camera.updateMatrixWorld();
 const env={...getEnvironment(createSimulation({hour:14.5,weather:'typhoon'})),skyCloudCover:1};
 const context={seed:42,frameAt:()=>camera,environmentAt:()=>({hour:14.5})};
 const draw=localTime=>{
  birds.sampleFilm({id:'storm-bird',start:28,end:34,localTime,parameters:{count:1,flight:'crosswind'}},context);
  birds.update(100,env,camera);birds.group.updateMatrixWorld(true);
  return birds.group.children.filter(b=>b.visible);
 };
 try{
  const visible=draw(3);assert.equal(visible.length,1);assert.ok(visible[0].material.opacity>.8);
  const bird=visible[0],position=bird.position.clone(),vertices=bird.geometry.attributes.position.array.slice(),quaternion=bird.quaternion.clone();
  assert.ok(Math.abs(quaternion.length()-1)<1e-10,'倾斜修正仍应保持有效的单位旋转');
  const projected=bird.getWorldPosition(new THREE.Vector3()).project(camera);
  assert.ok(Math.abs(projected.x)<.9&&projected.y>0&&projected.y<.9,'飞鸟应在天空中可见');
  const points=bird.geometry.attributes.position,outline=[];
  for(let i=0;i<points.count;i++)outline.push(new THREE.Vector3().fromBufferAttribute(points,i).applyMatrix4(bird.matrixWorld).project(camera));
  const width=(Math.max(...outline.map(p=>p.x))-Math.min(...outline.map(p=>p.x)))*1440/2;
  assert.ok(width>=34,`暴雨中的翼展应清晰可辨，实际只有 ${width.toFixed(1)} 像素`);
  draw(3.4);assert.ok(bird.position.distanceTo(position)>1);assert.notDeepEqual(bird.geometry.attributes.position.array,vertices);
  assert.ok(bird.quaternion.angleTo(quaternion)>.01,'阵风应带来倾斜与修正');
  draw(3);assert.deepEqual(bird.position,position);assert.deepEqual(bird.geometry.attributes.position.array,vertices);
  birds.sampleFilm(null,context);birds.update(100,env,camera);assert.equal(birds.group.visible,false);
  draw(3);assert.deepEqual(bird.position,position,'重新进入同一片段仍为同一条航线');
 }finally{birds.dispose();}
});

test('彩虹强度与台风浪高进入真实环境，倒拖更新，退出恢复原设置',()=>{
 const state=createSimulation({hour:14.5}),saved=structuredClone(state),sky=createNightSky();
 const registry=createSceneCapabilities({state,atmosphere:sky}),scheduler=createSceneScheduler({registry});
 try{
  scheduler.begin();
  scheduler.apply({time:55,properties:{'sky.rainbow.strength':.95,'environment.typhoon':.4,'environment.roughSea':.6},clips:[]});
  let env=scheduler.composeEnvironment(getEnvironment(state));
  assert.equal(env.rainbowStrength,.95);assert.equal(env.typhoon,.4);assert.equal(env.roughSea,.6);
  scheduler.apply({time:30,properties:{'sky.rainbow.strength':0,'environment.typhoon':1,'environment.roughSea':1},clips:[]});
  env=scheduler.composeEnvironment(getEnvironment(state));assert.equal(env.rainbowStrength,0);
  scheduler.end();env=scheduler.composeEnvironment(getEnvironment(state));assert.equal(env.rainbowStrength,undefined);assert.deepEqual(state,saved);
 }finally{scheduler.end();sky.dispose();}
});
