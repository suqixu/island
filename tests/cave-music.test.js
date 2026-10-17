import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;try{module=await import('../src/cave-music.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const api=()=>{assert.equal(typeof module?.isCaveMusicNearby,'function');return module.isCaveMusicNearby;};
test('山洞预设镜头和洞内观察触发，远景与邻近山坡不触发',()=>{
  const near=api();
  assert.equal(near(new THREE.Vector3(42.5,16,51.6),new THREE.Vector3(30,12.2,36)),true);
  assert.equal(near(new THREE.Vector3(30,13,36),new THREE.Vector3(26,12,31)),true);
  assert.equal(near(new THREE.Vector3(160,68,200),new THREE.Vector3(30,12,36)),false);
  assert.equal(near(new THREE.Vector3(31,18,40),new THREE.Vector3(44,13,28)),false);
});
test('洞口缩放设退出缓冲，山顶和无效位置不触发',()=>{
  const near=api(),target=new THREE.Vector3(30,12,36),camera=new THREE.Vector3(63,12,36);
  assert.equal(near(camera,target,false),false);assert.equal(near(camera,target,true),true);
  assert.equal(near(new THREE.Vector3(30,50,36),new THREE.Vector3(30,45,36)),false);
  assert.equal(near(new THREE.Vector3(NaN,0,0),target),false);
});
