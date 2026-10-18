import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { caveToLocal } from '../src/cave-layout.js';
const module = await import('../src/models/cave-flower-meadow.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('洞口繁花贴合实际地形且留出入口与台阶，两批实例绘制覆盖多种花色', () => {
  assert.equal(typeof module.createCaveFlowerMeadow, 'function');
  const scene=new THREE.Group(),heightAt=(x,z)=>10+.03*(x-30)-.06*(z-36);
  const distanceAt=(x,z)=>Math.abs(caveToLocal({x,y:10,z}).side)-1.25;
  const meadow=module.createCaveFlowerMeadow(scene,{heightAt,distanceAt});
  const meshes=meadow.group.children.filter(o=>o.isMesh);
  assert.equal(meshes.length,2);assert.ok(meshes.every(o=>o.isInstancedMesh));
  const petals=meshes.find(o=>o.instanceColor);assert.ok(petals.count>200);
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),color=new THREE.Color(),colors=new Set();
  for(let i=0;i<petals.count;i++) {
    petals.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
    const local=caveToLocal(point);
    assert.ok(local.forward>1.7&&local.forward<13);
    assert.ok(distanceAt(point.x,point.z)>.5,'保留通道，不在台阶上种花');
    assert.ok(Math.abs(point.y-heightAt(point.x,point.z))<.025,'根部不能悬空或穿坡');
    petals.getColorAt(i,color);colors.add(color.getHexString());
  }
  assert.ok(colors.size>=8,'花色应丰富');
  const resources=meshes.map(mesh=>[mesh.geometry,mesh.material]);
  meadow.update(4,{wind:.9,season:'summer'});meadow.update(8,{wind:.4,season:'winter',snow:1});
  assert.deepEqual(meshes.map(mesh=>[mesh.geometry,mesh.material]),resources,'每帧不重建花丛');
  assert.ok(meshes.every(mesh=>!mesh.visible),'积雪时休眠');
  meadow.update(10,{wind:.3,season:'spring',snow:0});assert.ok(meshes.every(mesh=>mesh.visible));
  meadow.dispose();assert.equal(scene.children.length,0);
});
