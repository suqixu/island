import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createIsland} from '../src/models/island.js';

test('洞前与路旁花瓣共享纹理，沿各自UV显示，茎与花心保持原材质',()=>{
  const island=createIsland(new THREE.Scene()),map=new THREE.Texture();let freed=0;map.addEventListener('dispose',()=>freed++);
  try{
    assert.equal(typeof island.setFlowerMap,'function');island.setFlowerMap(map);island.setFlowerMap(map);
    const leaf=new THREE.Texture();island.setLeafMaps({broadleaf:leaf});const foliage=island.group.getObjectByName('洞前花茎与叶'),leafMask=foliage.geometry.attributes.aLeafTexture.array;
    assert.ok(leafMask.includes(0)&&leafMask.includes(1));const leafShader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};foliage.material.onBeforeCompile(leafShader);assert.equal(leafShader.uniforms.uLeafAlbedo.value,leaf);
    const hearts=island.group.getObjectByName('洞前缤纷花瓣').geometry.attributes.aFlowerCenter;assert.ok(hearts.isInstancedBufferAttribute);assert.equal(hearts.count,island.group.getObjectByName('洞前缤纷花瓣').count);
    for(const name of ['洞前缤纷花瓣','路旁细小野花']){
      const mesh=island.group.getObjectByName(name),geometry=mesh.geometry,uv=geometry.attributes.uv,mask=geometry.attributes.aPetalTexture;
      assert.ok(mask.array.includes(0)&&mask.array.includes(1),'花心和花茎不套花瓣纹理');
      const petalUvs=[];for(let i=0;i<mask.count;i++)if(mask.getX(i)>0)petalUvs.push(uv.getX(i),uv.getY(i));
      assert.ok(Math.max(...petalUvs)>.9&&Math.min(...petalUvs)<.1);assert.ok(petalUvs.every(Number.isFinite));
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};mesh.material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.uPetalMap.value,map);assert.equal(shader.uniforms.uPetalMapEnabled.value,1);assert.ok(shader.uniforms.uPlantAmplitudes,'保留原风摆');assert.ok(shader.fragmentShader.includes('vPetalMask'));
    }
    island.setFlowerMap(null);assert.equal(freed,1);const next=new THREE.Texture();let nextFreed=0;next.addEventListener('dispose',()=>nextFreed++);island.setFlowerMap(next);island.dispose();island.dispose();assert.equal(nextFreed,1);
    const late=new THREE.Texture();let lateFreed=0;late.addEventListener('dispose',()=>lateFreed++);island.setFlowerMap(late);assert.equal(lateFreed,1);
  }finally{island.dispose();}
});

test('花粉表面独立加载、共享并安全释放，迟到资源不重新挂回',()=>{
  const island=createIsland(new THREE.Scene()),map=new THREE.Texture();let freed=0;map.addEventListener('dispose',()=>freed++);
  try{
    assert.equal(typeof island.setFlowerPollenMap,'function');island.setFlowerPollenMap(map);island.setFlowerPollenMap(map);
    const mesh=island.group.getObjectByName('洞前缤纷花瓣'),shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uPollenMap.value,map);assert.equal(shader.uniforms.uPollenMapEnabled.value,1);
    island.dispose();island.dispose();assert.equal(freed,1);
    const late=new THREE.Texture();let lateFreed=0;late.addEventListener('dispose',()=>lateFreed++);island.setFlowerPollenMap(late);assert.equal(lateFreed,1);
  }finally{island.dispose();}
});
