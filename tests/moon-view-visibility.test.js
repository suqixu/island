import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let api;try{api=await import('../src/moon-view-visibility.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function setup(){assert.equal(typeof api?.createMoonViewVisibility,'function');const camera=new THREE.PerspectiveCamera(54,1,.5,65000);camera.position.set(0,20,100);camera.lookAt(0,20,0);camera.updateMatrixWorld();const moon=new THREE.Mesh(new THREE.PlaneGeometry(1,1));moon.position.set(0,100,-1800);moon.scale.setScalar(100);return {camera,moon};}
test('月盘在画面中可见，画面外、镜头背后或已隐藏时不能显示诗',()=>{
  const {camera,moon}=setup(),visible=api.createMoonViewVisibility(()=>0);
  assert.equal(visible(camera,moon),true);
  moon.position.set(0,2000,-100);assert.equal(visible(camera,moon),false);
  moon.position.set(0,20,2000);assert.equal(visible(camera,moon),false);
  moon.position.set(0,100,-1800);moon.visible=false;assert.equal(visible(camera,moon),false);
});
test('月盘虽然投影在屏幕内但被山体遮挡时，不显示诗句',()=>{
  const {camera,moon}=setup();
  const visible=api.createMoonViewVisibility((x,z)=>z>=0&&z<=60?80:0);
  assert.equal(visible(camera,moon),false);
  assert.equal(api.createMoonViewVisibility(()=>0)(camera,moon),true);
});
test('日冕扩展透明画布后仍按真实月面判断山体遮挡',()=>{
  const {camera,moon}=setup();
  const visible=api.createMoonViewVisibility((x,z)=>z>=0&&z<=5?26:0);
  assert.equal(visible(camera,moon),false);
  moon.material.uniforms={uDiscUvScale:{value:4.3}};
  moon.scale.multiplyScalar(4.3);
  assert.equal(visible(camera,moon),false,'日冕画布不能被当成越过山脊的月面');
});
