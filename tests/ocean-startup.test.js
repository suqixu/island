import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import * as oceanModule from '../src/ocean.js';
import { createOceanSpray } from '../src/ocean-spray.js';

const asyncOcean = (...args) => {
  assert.equal(typeof oceanModule.createOceanAsync, 'function', '海底构建需要可分片的异步入口');
  return oceanModule.createOceanAsync(...args);
};
const fixture = { heightAt: (x, z) => 3 - Math.hypot(x, z) * .18, shelterAt: x => x < 0 ? .7 : 0 };
const hash = data => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

test('分片和同步构建保留原海底与半浮点高度的每个像素', async () => {
  const sync = oceanModule.createOcean(new THREE.Scene(), fixture);
  const async = await asyncOcean(new THREE.Scene(), { ...fixture, yieldToBrowser: async () => {} });
  try {
    for (const key of ['uBathymetry', 'uTerrainHeight']) {
      assert.deepEqual(async.mesh.material.uniforms[key].value.image, sync.mesh.material.uniforms[key].value.image);
    }
    assert.equal(hash(async.bathymetry.image.data), 'ace770da7442ae6f0cdfbfc1b783923a63860aa7142c6a47767c0c559587b712');
    assert.equal(hash(async.mesh.material.uniforms.uTerrainHeight.value.image.data), 'e8eda348fcceebd4f6f91d96bdb3914836fb0bb0a9204441a6808b3f54283592');
  } finally { sync.dispose(); async.dispose(); }
});

test('每段海底采样按预算让出执行权，完成前不发布场景', async () => {
  const scene = new THREE.Scene(), stages = new Set(), samplesPerTurn = [];
  let clock = 0, sampled = 0;
  const ocean = await asyncOcean(scene, {
    heightAt: () => { clock += .01; sampled++; return -2; },
    now: () => clock, budgetMs: 8,
    onProgress: stage => stages.add(stage),
    yieldToBrowser: async () => { assert.equal(scene.children.length, 0); samplesPerTurn.push(sampled); sampled = 0; },
  });
  try {
    assert.ok(samplesPerTurn.filter(count => count > 0).length > 100, '不能把整个采样循环留在同一任务');
    assert.ok(Math.max(...samplesPerTurn) <= 1536, '最多允许预算到期后的一个采样行');
    assert.equal(stages.size, 4, '采样、双向距离传播和像素打包都可独立让步');
    assert.equal(scene.children.length, 1);
  } finally { ocean.dispose(); }
});

test('取消分片构建后停止采样且不发布任何资源', async () => {
  const scene = new THREE.Scene(), controller = new AbortController();
  let samples = 0;
  const failure = new Error('取消海面初始化');
  await assert.rejects(asyncOcean(scene, {
    signal: controller.signal, budgetMs: 0,
    heightAt: () => { samples++; return -2; },
    yieldToBrowser: async () => { if (samples) controller.abort(failure); },
  }), error => error === failure);
  assert.ok(samples > 0 && samples < 768 * 768);
  assert.equal(scene.children.length, 0);
});

test('喷浪初始化中的同步回调取消后也不发布海面', async () => {
  const scene = new THREE.Scene(), controller = new AbortController(), failure = new Error('取消后续初始化');
  let sampled = 0;
  await assert.rejects(asyncOcean(scene, {
    signal: controller.signal, yieldToBrowser: async () => {},
    heightAt: () => { if (++sampled > 768 * 768) controller.abort(failure); return -2; },
  }), error => error === failure);
  assert.equal(scene.children.length, 0);
});

test('让步失败时终止后续采样并保留原始异常', async () => {
  const scene = new THREE.Scene(), failure = new Error('浏览器已离开');
  let samples = 0;
  await assert.rejects(asyncOcean(scene, {
    budgetMs: 0, heightAt: () => { samples++; return -2; },
    yieldToBrowser: async () => { if (samples) throw failure; },
  }), error => error === failure);
  assert.equal(samples, 768);
  assert.equal(scene.children.length, 0);
});

test('喷浪源采样失败前不创建图集或启动浏览器图片请求', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const sampleFailure = new Error('地形采样失效'), browserFailure = new Error('不应提前读取图片环境');
  Object.defineProperty(globalThis, 'document', { configurable: true, get() { throw browserFailure; } });
  try {
    assert.throws(() => createOceanSpray(new THREE.Scene(), { heightAt: () => { throw sampleFailure; } }),
      error => error === sampleFailure);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});

test('场景发布失败后移除海面并释放已创建纹理、材质与几何', async () => {
  const scene = new THREE.Scene(), failure = new Error('场景拒绝新海面'), released = new Map();
  const add = scene.add;
  scene.add = function (mesh) {
    const resources = new Set([mesh.geometry, mesh.material,
      ...Object.values(mesh.material.uniforms).map(uniform => uniform.value).filter(value => value?.isTexture)]);
    for (const resource of resources) {
      released.set(resource, 0);
      resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
    }
    add.call(this, mesh);
    throw failure;
  };
  await assert.rejects(asyncOcean(scene, { ...fixture, yieldToBrowser: async () => {} }), error => error === failure);
  assert.equal(scene.children.length, 0);
  assert.ok(released.size >= 5);
  assert.ok([...released.values()].every(count => count === 1), '未发布对象的所有资源应恰好释放一次');
});
