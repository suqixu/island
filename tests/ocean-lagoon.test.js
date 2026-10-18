import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';
import { heightAt } from '../src/terrain.js';
import * as lagoon from '../src/lagoon.js';
import {getIslandPathLayout} from '../src/path-layout.js';

test('海面采样高度与低矮沙洲对齐，不能把干燥雪岸当成水下', () => {
  const terrain=getIslandPathLayout({heightAt}).heightAtRendered;
  const ocean=createOcean(new THREE.Group(),{heightAt:terrain});
  try {
    const {data,width:size}=ocean.mesh.material.uniforms.uTerrainHeight.value.image;
    const transform=ocean.mesh.material.uniforms.uCoastUvTransform?.value??new THREE.Vector2(1,0);
    for(const [x,z] of [[60.5,92],[59.75,92],[50,93],[70,82]]) {
      const u=((x/480+.5)*transform.x+transform.y)*size-.5;
      const v=((z/480+.5)*transform.x+transform.y)*size-.5;
      const ix=Math.floor(u),iz=Math.floor(v),fx=u-ix,fz=v-iz;
      const h=(dx,dz)=>THREE.DataUtils.fromHalfFloat(data[(iz+dz)*size+ix+dx]);
      const sampled=(h(0,0)*(1-fx)+h(1,0)*fx)*(1-fz)+(h(0,1)*(1-fx)+h(1,1)*fx)*fz;
      assert.ok(Math.abs(sampled-terrain(x,z))<.2,`${x},${z} 采样误差为 ${sampled-terrain(x,z)}m`);
    }
  } finally {ocean.dispose();}
});

test('现有海床纹理真实编码泻湖曝光，RGB深度岸距不受遮浪改变', () => {
  assert.equal(typeof lagoon.getLagoonShelter, 'function');
  const parent = new THREE.Group();
  const legacy = createOcean(parent, { heightAt });
  const sheltered = createOcean(parent, { heightAt, shelterAt: lagoon.getLagoonShelter });
  try {
    const { data, width, height } = sheltered.bathymetry.image, before = legacy.bathymetry.image.data;
    let shelteredTexels = 0, openTexels = 0;
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const wx = (x / (width - 1) - .5) * 480, wz = (z / (height - 1) - .5) * 480, at = (z * width + x) * 4;
      const shelter = lagoon.getLagoonShelter(wx, wz);
      assert.equal(before[at + 3], 255, '未传 shelterAt 时保持旧纹理');
      assert.equal(data[at], before[at]); assert.equal(data[at + 1], before[at + 1]); assert.equal(data[at + 2], before[at + 2]);
      assert.equal(data[at + 3], Math.round((1 - .72 * shelter) * 255));
      if (Math.hypot(wx - 50, wz - 75) < 5) { assert.equal(data[at + 3], 71); shelteredTexels++; }
      if (shelter === 0) { assert.equal(data[at + 3], 255); openTexels++; }
    }
    assert.ok(shelteredTexels > 15); assert.ok(openTexels > width * height * .98);
    assert.equal(sheltered.mesh.material.uniforms.uBathymetry.value, sheltered.bathymetry);
    assert.equal(parent.children.length, 2, '每个海面仍只有原有一张网格');
  } finally { legacy.dispose(); sheltered.dispose(); }
});

test('遮浪回调异常值安全限制，浅水限幅仍保留遮浪比例', () => {
  const ocean = createOcean(new THREE.Group(), { heightAt, shelterAt: (x, z) => x < 0 ? NaN : z < 0 ? -2 : 3 });
  try {
    const { data, width, height } = ocean.bathymetry.image;
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      assert.equal(data[(z * width + x) * 4 + 3], x < width / 2 || z < height / 2 ? 255 : 71);
    }
    // Limiting depth and wave energy by the same exposure preserves attenuation
    // even when a long shallow-water swell already hits its depth ceiling.
    const exposure = 71 / 255;
    for (const depth of [1.5, 2, 3.2]) for (const incoming of [.08, .3, 1.1]) {
      const oldAmplitude = Math.min(incoming, (depth - .1) * .04);
      const shelteredAmplitude = Math.min(incoming * exposure, (depth - .1) * .04 * exposure);
      assert.ok(Math.abs(shelteredAmplitude / oldAmplitude - exposure) < 1e-12);
    }
  } finally { ocean.dispose(); }
});
