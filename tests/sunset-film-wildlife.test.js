import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {createSceneCapabilities} from '../src/scene-capabilities/index.js';
import {createSceneScheduler} from '../src/scene-capabilities/scheduler.js';
import {createFishWave} from '../src/models/fish-wave.js';
import {createSailboats} from '../src/models/sailboats.js';
import {createSunsetBirds} from '../src/sunset-birds.js';
import {getSunBackdropState} from '../src/sun-framing.js';
import {heightAt} from '../src/terrain.js';

// A missing clip binding leaves the real meshes idle, and sequential-only
// timers break the repeated seek comparison below.
test('影片直接拖入鱼跃、归鸟和渔船片段即可见；倒拖同帧一致，退出撤销调度',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(46,16/9,.5,65000);
 camera.position.set(180,20,260);camera.lookAt(550,5,780);camera.updateMatrixWorld();
 const state=createSimulation({hour:17.65}),env=getEnvironment(state);
 env.sunDirection=new THREE.Vector3(...env.sun).normalize();
 env.sunBackdropDirection=getSunBackdropState(camera,1280,720,env.sunDirection).direction;
 const fish=createFishWave(scene,{heightAt,random:()=>.5}),boats=createSailboats(scene,{heightAt,seed:42}),birds=createSunsetBirds({random:()=>.5});
 const providers={fishWave:fish,sailboat:boats,sunsetBird:birds};
 const registry=createSceneCapabilities({state,providers}),scheduler=createSceneScheduler({registry,random:()=>.25});
 const context={frameAt:()=>camera};
 const frames=localTime=>['fishWave','sailboat','sunsetBird'].map(name=>({id:name,capability:`wildlife.${name}`,start:0,end:24,localTime,progress:localTime/24,parameters:{}}));
 try{
  scheduler.begin(context);
  const draw=localTime=>{scheduler.apply({time:localTime,properties:{},clips:frames(localTime)},context);for(const p of Object.values(providers))p.update(100,env,camera);scene.updateMatrixWorld(true);birds.group.updateMatrixWorld(true);};
  draw(8);
  const bodies=fish.group.getObjectByName('跃浪银鱼'),matrix=new THREE.Matrix4(),position=new THREE.Vector3();
  assert.ok(fish.group.visible&&bodies.count>0,'不等待自然冷却也应出现银鱼');
  let airborne=0;for(let i=0;i<bodies.count;i++){bodies.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);if(position.y>.4)airborne++;assert.ok(heightAt(position.x,position.z)<-4);}
  assert.ok(airborne>20,'应真实跃出水面');
  const ship=boats.group.children.find(s=>s.visible&&s.userData.style==='fishing');assert.ok(ship,'应显示已有短桅渔船模型');
  assert.ok(ship.position.clone().project(camera).lengthSq()<3,'渔船必须在画面里');
  assert.equal(birds.group.children.filter(b=>b.visible).length,2,'应出现朝落日飞行的双鸟');
  const before=bodies.instanceMatrix.array.slice(),birdBefore=birds.group.children.map(b=>b.position.toArray()),shipBefore=ship.position.clone();
  draw(16);assert.ok(ship.position.distanceTo(shipBefore)>1,'船要实际缓慢航行');
  draw(8);assert.deepEqual(bodies.instanceMatrix.array,before);assert.deepEqual(birds.group.children.map(b=>b.position.toArray()),birdBefore);assert.ok(ship.position.distanceTo(shipBefore)<1e-8);
  scheduler.apply({time:24,properties:{},clips:[]},context);for(const p of Object.values(providers))p.update(100,env,camera);
  assert.equal(fish.group.visible,false);assert.equal(birds.group.visible,false);
  draw(8);assert.deepEqual(bodies.instanceMatrix.array,before,'离开片段后再次拖回，鱼群也不可重新换位置');assert.deepEqual(birds.group.children.map(b=>b.position.toArray()),birdBefore);
  scheduler.end(context);for(const p of Object.values(providers))assert.deepEqual(p.getRuntimeOptions(),{});
 }finally{scheduler.end(context);for(const p of Object.values(providers))p.dispose();}
});

test('影片临时接管双鸟后，退出仍能继续此前已在飞行的自然双鸟',()=>{
 const camera=new THREE.PerspectiveCamera(46,16/9,.5,65000);camera.position.set(180,20,260);camera.lookAt(550,5,780);camera.updateMatrixWorld();
 const env=getEnvironment(createSimulation({hour:17.6}));env.sunDirection=new THREE.Vector3(...env.sun).normalize();env.sunBackdropDirection=getSunBackdropState(camera,1280,720,env.sunDirection).direction;
 const birds=createSunsetBirds({random:()=>.5});
 try{
  for(let i=0;i<=160;i++)birds.update(i/20,env,camera);
  assert.equal(birds.group.visible,true);const before=birds.group.children.map(b=>b.position.toArray());
  birds.sampleFilm({id:'temporary',start:0,end:16,localTime:8,progress:.5},{frameAt:()=>camera,seed:4});birds.update(100,env,camera);
  birds.sampleFilm(null);birds.update(100,env,camera);
  assert.equal(birds.group.visible,true,'退出不应把原本仍在飞行的自然双鸟隐藏');assert.deepEqual(birds.group.children.map(b=>b.position.toArray()),before);
 }finally{birds.dispose();}
});
