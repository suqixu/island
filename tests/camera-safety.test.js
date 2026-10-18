import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {caveToWorld} from '../src/cave-layout.js';
import * as cave from '../src/models/island-cave.js';
import {createOcean} from '../src/ocean.js';

const module=await import('../src/camera-safety.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;
});
function setup(position,target,options={}) {
  assert.ok(module?.createCameraSafety,'相机应在平移、旋转和缩放后保持在可见表面上方');
  const camera=new THREE.PerspectiveCamera(54,1,.5,65000);
  camera.position.fromArray(position);
  const controls={target:new THREE.Vector3(...target)};
  camera.lookAt(controls.target);camera.updateMatrixWorld();
  return {camera,controls,guard:module.createCameraSafety(camera,controls,options)};
}
test('向下平移和低角度绕行不能让镜头或焦点钻入海平面',()=>{
  const {camera,controls,guard}=setup([100,-12,100],[10,-20,10],{heightAt:()=>-30});
  guard.update();
  assert.ok(camera.position.y>=2);
  assert.ok(controls.target.y>=0);
  const before=camera.position.clone();guard.update();assert.deepEqual(camera.position,before);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(controls.target.clone().sub(camera.position).normalize())<1e-8);
});
test('山体内部和临近陡坡的近裁切面会被抬到真实地表上方',()=>{
  const {camera,guard}=setup([0,3,0],[0,6,-10],{heightAt:x=>x>.4?35:30});
  guard.update();assert.ok(camera.position.y>=36.25,'镜头边缘也不能插入山坡');
});
test('海浪高度变化也会托起低位镜头，安全的高空和赏月视角保持不变',()=>{
  let water=8;
  const h=setup([200,1,200],[0,0,0],{heightAt:()=>-40,waterHeightAt:()=>water});
  h.guard.update();assert.ok(h.camera.position.y>=9.25);
  const high=setup([150,24,200],[0,65,0],{heightAt:()=>-40,waterHeightAt:()=>water});
  const original=high.camera.position.clone();assert.equal(high.guard.update(),false);
  assert.deepEqual(high.camera.position,original);assert.equal(high.controls.target.y,65);
});
test('洞内使用实际通道的地板，洞顶和洞外仍由山体保护',()=>{
  assert.equal(typeof cave.getCaveCameraFloor,'function');
  const inside=caveToWorld(0,2,-2),outside=caveToWorld(8,2,-2),above=caveToWorld(0,9,-2);
  assert.ok(Number.isFinite(cave.getCaveCameraFloor(inside)));
  assert.equal(cave.getCaveCameraFloor(outside),null);
  assert.equal(cave.getCaveCameraFloor(above),null);
  const h=setup([inside.x,inside.y,inside.z],[30,12,36],{
    heightAt:()=>40,interiorFloorAt:cave.getCaveCameraFloor});
  h.guard.update();assert.ok(h.camera.position.y<15,'不能把合法的洞内视角推到山顶');
});
test('镜头水面高度随当前浪相更新，海岸陆地不会把水浪当成山体',()=>{
  const ocean=createOcean(new THREE.Group(),{heightAt:x=>x<0?20:-30});
  try {
    assert.equal(typeof ocean.cameraWaterHeightAt,'function');
    let maximum=0,minimum=Infinity;
    for(let frame=0;frame<300;frame++) {
      ocean.update(frame*.05,{typhoon:1,wind:1,windSpeed:48,swell:1,storm:1,windDirection:[1,0]});
      assert.equal(ocean.cameraWaterHeightAt(-20,0),0);
      const height=ocean.cameraWaterHeightAt(80,30);
      assert.ok(Number.isFinite(height)&&height>=0&&height<25);
      maximum=Math.max(maximum,height);minimum=Math.min(minimum,height);
    }
    assert.ok(maximum>7&&maximum-minimum>5,'不能只用固定海平面防止镜头钻入巨浪');
  } finally {ocean.dispose();}
});

test('台风边缘深水的镜头保护覆盖水平位移后的实际网格水面',async()=>{
  const {createCameraWaterSampler}=await import('../src/ocean-height.js');
  assert.equal(typeof createCameraWaterSampler,'function');
  const ocean=createOcean(new THREE.Group(),{heightAt:()=>-24.858});
  try {
    const sample=createCameraWaterSampler(ocean.mesh.geometry,ocean.bathymetry);
    const weather={wind:1,storm:1,typhoon:1,swell:.95,gust:.85};
    const height=sample(-85.733,-233.264,30,30,Math.atan2(-.714,-.7),weather);
    assert.ok(height>=4.201,'边缘深水混合、三角插值及水平位移后的浪峰都必须在保护范围内');
    assert.ok(height<20);
    assert.ok(sample(-85.733,-233.264,0,0,Math.atan2(-.714,-.7),weather)<height-5,
      '保护随当地浪相变化，不使用整个海域固定的最高浪');
  } finally {ocean.dispose();}
});
