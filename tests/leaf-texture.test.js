import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createIsland} from '../src/models/island.js';

test('阔叶、椰叶和蕨叶共享贴图且沿自身叶片坐标显示，茎不套叶脉',()=>{
  const island=createIsland(new THREE.Scene());
  const broad=new THREE.Texture(),palm=new THREE.Texture();let broadFreed=0,palmFreed=0;
  broad.addEventListener('dispose',()=>broadFreed++);palm.addEventListener('dispose',()=>palmFreed++);
  try{
    assert.equal(typeof island.setLeafMaps,'function');
    island.setLeafMaps({broadleaf:broad,palm});island.setLeafMaps({broadleaf:broad,palm});
    for(const [name,map]of [['阔叶冠层-1',broad],['椰树羽状叶',palm],['林下蕨类',palm],['洞口下垂藤蔓',broad]]){
      const mesh=island.group.getObjectByName(name);assert.ok(mesh,name);
      const uv=mesh.geometry.attributes.uv;assert.ok(uv&&uv.count===mesh.geometry.attributes.position.count);
      assert.ok(Array.from(uv.array).every(Number.isFinite));
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      mesh.material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.uLeafAlbedo.value,map);
      assert.equal(shader.uniforms.uLeafAlbedoEnabled.value,1);
      assert.ok(shader.uniforms.uSnow||shader.uniforms.uCavePlantSnow,'保留季节积雪');
    }
    for(const name of ['椰树羽状叶','林下蕨类','洞口下垂藤蔓']){
      const mask=island.group.getObjectByName(name).geometry.attributes.aLeafTexture.array;
      assert.ok(mask.includes(0)&&mask.includes(1),name+'将茎和叶片分开');
    }
    island.setLeafMaps({broadleaf:null});assert.equal(broadFreed,1);assert.equal(palmFreed,0);
    island.dispose();island.dispose();assert.equal(broadFreed,1);assert.equal(palmFreed,1);
    const late=new THREE.Texture();let lateFreed=0;late.addEventListener('dispose',()=>lateFreed++);
    island.setLeafMaps({palm:late});assert.equal(lateFreed,1);
  }finally{island.dispose();}
});
