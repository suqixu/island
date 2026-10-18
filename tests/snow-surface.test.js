import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as snow from '../src/snow-surface.js';

test('同一场景共享雪纹理，替换与迟到的纹理仅释放一次，场景互不影响', () => {
  assert.equal(typeof snow.createSnowSurfaceState,'function');
  const first=snow.createSnowSurfaceState(),second=snow.createSnowSurfaceState();
  const a=new THREE.Texture(),b=new THREE.Texture(),late=new THREE.Texture();
  let releasedA=0,releasedB=0,releasedLate=0;
  a.addEventListener('dispose',()=>releasedA++);b.addEventListener('dispose',()=>releasedB++);
  late.addEventListener('dispose',()=>releasedLate++);
  first.setMap(a);assert.equal(first.uniforms.uSnowMapEnabled.value,1);
  const materials=[new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial()];
  for(const material of materials){
    snow.attachSnowSurface(material,{value:.8},{surface:first});
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uSnowMap,first.uniforms.uSnowMap);
  }
  first.setMap(a);assert.equal(releasedA,0);
  first.setMap(b);assert.equal(releasedA,1);assert.equal(second.uniforms.uSnowMapEnabled.value,0);
  first.dispose();first.dispose();assert.equal(releasedB,1);
  first.setMap(late);first.setMap(late);assert.equal(releasedLate,1);
  for(const material of materials)material.dispose();second.dispose();
});
