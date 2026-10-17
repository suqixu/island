import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const module = await import('../src/detail-focus.js').catch(error => {
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
function setup(){
  assert.equal(typeof module.createDetailFocus,'function','需要双击真实岛屿几何的近景交互');
  class Surface extends EventTarget {getBoundingClientRect(){return {left:40,top:20,width:800,height:600};}}
  const element=new Surface(),camera=new THREE.PerspectiveCamera(46,800/600,.5,65000);
  camera.position.set(0,20,60);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const ground=new THREE.Mesh(new THREE.BoxGeometry(20,2,20),new THREE.MeshBasicMaterial());
  const island=new THREE.Group();island.add(ground);
  const poses=[];
  const focus=module.createDetailFocus({element,camera,roots:[island],onFocus:pose=>poses.push(pose)});
  return {element,camera,island,ground,poses,focus};
}
function emit(surface,type,values={}){
  const {timeStamp=0,...properties}=values;
  const event=new Event(type);Object.defineProperty(event,'timeStamp',{value:timeStamp});
  Object.assign(event,{clientX:440,clientY:320,...properties});surface.dispatchEvent(event);
}
test('双击实际表面后保留准确点击点并靠近，画布偏移不会选错位置',()=>{
  const h=setup();emit(h.element,'dblclick');
  assert.equal(h.poses.length,1);
  const {position,target}=h.poses[0];
  assert.ok(target.distanceTo(new THREE.Vector3(0,1,3))<1e-8);
  assert.ok(position.distanceTo(target)<=12+1e-8&&position.distanceTo(target)>=3.5-1e-8);
  assert.ok(position.distanceTo(h.camera.position)>40);
  assert.ok(position.y>target.y);
  h.focus.dispose();
});
test('天空、隐藏物体和鸟群不作为细节聚焦对象',()=>{
  const h=setup();emit(h.element,'dblclick',{clientX:440,clientY:25});assert.equal(h.poses.length,0);
  h.ground.visible=false;emit(h.element,'dblclick');assert.equal(h.poses.length,0);
  h.ground.visible=true;h.island.visible=false;emit(h.element,'dblclick');assert.equal(h.poses.length,0);
  h.island.visible=true;h.island.name='海鸟-1';emit(h.element,'dblclick');assert.equal(h.poses.length,0);
  h.focus.dispose();
});
test('触屏双击可聚焦，拖动或双指操作不误触发，也不重复响应浏览器双击',()=>{
  const h=setup();
  const touch=(type,t,extra={})=>emit(h.element,type,{pointerId:1,pointerType:'touch',timeStamp:t,...extra});
  touch('pointerdown',100);touch('pointerup',140);touch('pointerdown',280);touch('pointerup',320);
  assert.equal(h.poses.length,1);emit(h.element,'dblclick',{timeStamp:330});assert.equal(h.poses.length,1);
  touch('pointerdown',1000);touch('pointermove',1050,{clientX:485});touch('pointerup',1100,{clientX:485});
  touch('pointerdown',1200);touch('pointerup',1250);assert.equal(h.poses.length,1);
  touch('pointerdown',2000);touch('pointerdown',2010,{pointerId:2});touch('pointerup',2050,{pointerId:2});touch('pointerup',2060);
  touch('pointerdown',2200);touch('pointerup',2240);assert.equal(h.poses.length,1);
  h.focus.dispose();
});
test('持续双击逐步靠近，有最近距离限制，释放交互后不再响应',()=>{
  const h=setup();emit(h.element,'dblclick');
  h.camera.position.copy(h.poses[0].position);h.camera.lookAt(h.poses[0].target);h.camera.updateMatrixWorld();
  emit(h.element,'dblclick');assert.ok(h.poses[1].position.distanceTo(h.poses[1].target)<=3.5+1e-8);
  h.focus.dispose();h.focus.dispose();emit(h.element,'dblclick');assert.equal(h.poses.length,2);
});
