import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandCave } from '../src/models/island-cave.js';
import { heightAt } from '../src/terrain.js';

test('洞内只有转角处的局部暖光，光照范围不触及洞口，外侧无灯具',()=>{
  const cave=createIslandCave(new THREE.Group(),{heightAt});
  const lights=[];cave.group.traverse(object=>{if(object.isLight)lights.push(object);assert.ok(!object.name.includes('火把'));});
  assert.equal(lights.length,1);const lamp=lights[0];
  const origin=new THREE.Vector3(30,9.9,36),direction=new THREE.Vector3(160,0,200).normalize();
  const inward=-lamp.position.clone().sub(origin).dot(direction);
  assert.ok(inward>=7,'光源应藏在洞内转角');assert.ok(lamp.distance<inward,'光照范围不能照到洞口');
  assert.equal(lamp.castShadow,false,'局部灯不新增阴影渲染');
  for(const daylight of [1,.2,0])for(const quality of ['low','medium','high']) {
    cave.update(7,{daylight,quality,artificialLightsOff:false});assert.ok(lamp.intensity>=24 && lamp.intensity<=36,'只保留将熄未熄的微光');
    cave.update(8,{daylight,quality,artificialLightsOff:true});assert.equal(lamp.intensity,0);assert.equal(lamp.visible,false);
  }
  cave.update(4,{artificialLightsOff:false});const first=lamp.intensity;cave.update(9,{artificialLightsOff:false});assert.notEqual(lamp.intensity,first,'微光随时间轻微变化');
  assert.equal(cave.count.lights,1);assert.equal(cave.count.lamps,0);cave.dispose();
});

test('洞内转角光不影响实际洞壁和植被，释放与更新幂等',()=>{
  const parent=new THREE.Group(),cave=createIslandCave(parent,{heightAt});
  assert.ok(cave.group.getObjectByName('天然岩洞内壁'));
  assert.ok(cave.group.getObjectByName('洞口贴岩苔草与小蕨'));
  const meshes=[];cave.group.traverse(object=>{if(object.isMesh)meshes.push(object);});
  assert.equal(cave.count.meshes,meshes.length);
  cave.dispose();cave.dispose();cave.update(8,{daylight:0});assert.equal(parent.children.length,0);
});
