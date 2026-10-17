import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;try {module=await import('../src/lighthouse-music.js');} catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const api=()=>{assert.equal(typeof module?.isLighthouseMusicNearby,'function');return module.isLighthouseMusicNearby;};
const center=new THREE.Vector3(-22,55,-7);
const target=center.clone(), camera=center.clone().add(new THREE.Vector3(16,6,16));
test('夜晚灯塔近景触发，白天全岛远景和观察其他山峰不触发',()=>{
  const near=api();assert.equal(near(camera,target,center,{daylight:0}),true);
  assert.equal(near(camera,target,center,{daylight:1}),false);
  assert.equal(near(new THREE.Vector3(160,68,200),target,center,{daylight:0}),false);
  assert.equal(near(camera,new THREE.Vector3(26,45,28),center,{daylight:0}),false);
});
test('缩放边界有缓冲，避免细微镜头晃动反复切歌，无效输入不触发',()=>{
  const near=api();const edge=center.clone().add(new THREE.Vector3(45,0,0));
  assert.equal(near(edge,target,center,{daylight:0},false),false);
  assert.equal(near(edge,target,center,{daylight:0},true),true);
  assert.equal(near(center.clone().add(new THREE.Vector3(70,0,0)),target,center,{daylight:0},true),false);
  assert.equal(near(camera,target,center,{}),false);
  assert.equal(near(new THREE.Vector3(NaN,0,0),target,center,{daylight:0}),false);
});
