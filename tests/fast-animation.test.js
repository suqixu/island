import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';

test('16倍速下岛面湿润与积雪按加速帧推进，地形和阴影仍复用原模型', () => {
  const island=createIsland(new THREE.Scene());
  try {
    const material=island.group.getObjectByName('连续海床与火山岛').material;
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader);
    island.update(16/30,{animationRate:16,rain:1,snow:1,season:'summer'});
    assert.ok(Math.abs(shader.uniforms.uSnow.value-.6369930625013327)<1e-8);
    assert.ok(Math.abs(shader.uniforms.uLandWetness.value-.486582880967408)<1e-8);
    assert.equal(shader.uniforms.uTime.value,16/30);
  } finally {island.dispose();}
});
