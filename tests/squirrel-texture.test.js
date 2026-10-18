import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWoodlandWildlife} from '../src/woodland-wildlife.js';
test('松鼠身体、蓬尾与四肢共享毛皮，头部可独立观察，释放与迟到加载安全',()=>{
  const trees=[0,5].map(x=>({root:new THREE.Vector3(x,2,0),height:4,available:()=>true,sampleTrunk(t,f,a,d,target,normal){normal.set(Math.cos(a),0,Math.sin(a));return target.copy(this.root).addScaledVector(normal,.3+d).add(new THREE.Vector3(0,4*f,0));}}));
  const life=createWoodlandWildlife(new THREE.Group(),{trees,heightAt:()=>2,random:()=>.2}),map=new THREE.Texture();let freed=0;map.addEventListener('dispose',()=>freed++);
  try{assert.equal(typeof life.setFurMap,'function');life.setFurMap(map);
    for(let i=0;i<300;i++)life.update(i/20,{daylight:1,rain:0,windSpeed:4});
    for(const name of ['松鼠身体','松鼠蓬尾','松鼠左前爪']){
      const mesh=life.group.getObjectByName(name),uv=mesh.geometry.attributes.uv;assert.ok(uv&&uv.count===mesh.geometry.attributes.position.count);assert.ok(uv.array.every(Number.isFinite));
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};mesh.material.onBeforeCompile(shader);assert.equal(shader.uniforms.uSquirrelFur.value,map);assert.equal(shader.uniforms.uSquirrelFurEnabled.value,1);assert.ok(shader.vertexShader.includes('aSquirrelLook'));
    }
    const look=life.group.getObjectByName('松鼠身体').geometry.attributes.aSquirrelLook;assert.ok(look.array.some(value=>Math.abs(value)>.001));
    life.dispose();life.dispose();assert.equal(freed,1);const late=new THREE.Texture();let lateFreed=0;late.addEventListener('dispose',()=>lateFreed++);life.setFurMap(late);assert.equal(lateFreed,1);
  }finally{life.dispose();}
});
