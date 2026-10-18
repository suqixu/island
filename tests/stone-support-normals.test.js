import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as pathsModule from '../src/models/island-paths.js';
import { createRestPavilion } from '../src/models/rest-pavilion.js';
import { getIslandPathLayout } from '../src/path-layout.js';

function supportGeometry() {
  const positions = [];
  pathsModule.appendTerracedStoneSkirt([{x:-1,z:-1},{x:1,z:-1},{x:1,z:1},{x:-1,z:1}],
    2, () => 0, (a,b,c) => { for(const p of [a,c,b])positions.push(p.x,p.y,p.z); });
  // 与石裙共用的平顶，必须保留与斜立面的硬边。
  positions.push(-1,2,-1, 1,2,1, 1,2,-1, -1,2,-1, -1,2,1, 1,2,1);
  const geometry = new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}

test('石裙微小三角分面局部平滑，踏面与立面仍保留硬边且不改变几何布局', () => {
  assert.equal(typeof pathsModule.smoothStoneSurfaceNormals,'function');
  const geometry=supportGeometry(), position=geometry.attributes.position, before=position.array.slice();
  const oldNormals=geometry.attributes.normal.array.slice(), oldCount=position.count;
  try {
    assert.equal(pathsModule.smoothStoneSurfaceNormals(geometry),geometry);
    assert.equal(geometry.attributes.position,position);
    assert.deepEqual(position.array,before);
    assert.equal(position.count,oldCount); assert.equal(geometry.index,null);
    const normal=geometry.attributes.normal, snow=geometry.attributes.aSnowNormal;
    assert.ok(snow && snow.count===position.count);
    let changed=0;
    const groups=new Map();
    for(let i=0;i<position.count;i++){
      const current=[normal.getX(i),normal.getY(i),normal.getZ(i)];
      assert.ok(current.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...current)-1)<1e-5);
      if(current.some((value,k)=>Math.abs(value-oldNormals[i*3+k])>.005))changed++;
      if(oldNormals[i*3+1]>.9999)assert.deepEqual(current,[0,1,0],'踏面不能因平滑而变成圆角斜坡');
      assert.deepEqual([snow.getX(i),snow.getY(i),snow.getZ(i)],current);
      const key=[position.getX(i),position.getY(i),position.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
      const group=groups.get(key)??[];group.push(current);groups.set(key,group);
    }
    assert.ok(changed>position.count*.3,'真实石裙大部分微分面应得到平滑法线');
    let seams=0;
    for(const group of groups.values())for(const a of group)for(const b of group){
      if(a[1]>.9999&&b[1]<.6)seams++;
    }
    assert.ok(seams>10,'同位置仍须保留踏面与立面的法线分离');
  }finally{geometry.dispose();}
});

test('石阶材质用插值坡面计算层理和雪覆盖，保留原有石纹', () => {
  const material=new THREE.MeshStandardMaterial();
  try{
    pathsModule.configurePathMaterial(material,{value:1},false,{});
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader,{});
    assert.doesNotMatch(shader.vertexShader,/attribute vec3 aSnowNormal/,'共用石材必须兼容只有标准normal的模型');
    assert.match(shader.vertexShader,/vSnowSmoothNormal=inverseTransformDirection\(transformedNormal,viewMatrix\)/);
    assert.match(shader.vertexShader,/varying vec3 vPathStoneNormal/);
    assert.match(shader.fragmentShader,/float pathUp = abs\(normalize\(vPathStoneNormal\)\.y\)/);
    assert.match(shader.fragmentShader,/pathStrata/);
    assert.match(shader.fragmentShader,/coastalStep\(vPathWorld\)/);
  }finally{material.dispose();}
});

test('真实山径支撑和共享材质的亭门入口石阶都携带平滑雪法线', () => {
  const layout=getIslandPathLayout(), scene=new THREE.Group();
  const paths=pathsModule.createIslandPaths(scene,{layout,heightAt:layout.heightAtRendered});
  let pavilion;
  try{
    const stone=paths.group.getObjectByName('山径天然石阶');
    assert.equal(stone.geometry.attributes.aSnowNormal?.count,stone.geometry.attributes.position.count);
    pavilion=createRestPavilion(scene,{heightAt:x=>.12*x,position:{x:0,z:0},entranceDirection:{x:1,z:0},
      approach:{x:4,y:.518,z:0},stoneSurface:stone});
    const entry=pavilion.group.getObjectByName('山亭入口石阶');
    assert.ok(entry?.isMesh);
    assert.equal(entry.material,stone.material);
    assert.equal(entry.geometry.attributes.aSnowNormal?.count,entry.geometry.attributes.position.count);
  }finally{pavilion?.dispose();paths.dispose();}
});

test('共用石阶材质的灯塔构件必须提供着色器消费的全部顶点属性', async () => {
  const {createLighthouse}=await import('../src/models/lighthouse.js');
  const {LIGHTHOUSE_SITE}=await import('../src/lighthouse-layout.js');
  const layout=getIslandPathLayout(),tower=createLighthouse(new THREE.Scene(),{heightAt:layout.heightAtRendered,...LIGHTHOUSE_SITE});
  try {
    const material=tower.group.getObjectByName('灯塔贴坡石基').material;
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader,{});
    const required=[...shader.vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)].map(match=>match[1]);
    let checked=0;
    tower.group.traverse(mesh=>{
      if(!mesh.isMesh||mesh.material!==material)return;
      checked++;
      for(const name of required){
        const attribute=mesh.geometry.getAttribute(name);
        assert.ok(attribute,`${mesh.name} 缺少石阶着色器必需的 ${name}，会产生无效法线和黑面`);
        assert.equal(attribute.count,mesh.geometry.attributes.position.count);
      }
    });
    assert.ok(checked>=8,'基座、塔脚、门窗石框、露台和入口石阶均须检查');
  } finally {tower.dispose();}
});
