import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;try{module=await import('../src/dock-music.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const api=()=>{assert.equal(typeof module?.isDockMusicNearby,'function');return module.isDockMusicNearby;};
test('整段码头双击近景都能触发，远景和附近海水不触发',()=>{
  const near=api();
  for(const z of [65,83,101])assert.equal(near(new THREE.Vector3(8,8,z+8),new THREE.Vector3(0,2,z)),true);
  assert.equal(near(new THREE.Vector3(40,12,128),new THREE.Vector3(5,5,60)),false);
  assert.equal(near(new THREE.Vector3(25,6,90),new THREE.Vector3(20,0,90)),false);
});
test('码头缩放与观察方向设退出缓冲，山顶和无效镜头不触发',()=>{
  const near=api();const target=new THREE.Vector3(0,2,83),camera=new THREE.Vector3(40,2,83);
  assert.equal(near(camera,target,false),false);assert.equal(near(camera,target,true),true);
  assert.equal(near(new THREE.Vector3(0,62,83),target,true),false);
  assert.equal(near(new THREE.Vector3(NaN,0,0),target),false);
});
