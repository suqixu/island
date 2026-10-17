import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const module = await import('../src/rest-pavilion-surface.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

function actualStoneFixture() {
  const group = new THREE.Group();
  group.position.set(10, 2, -7); group.rotation.y = Math.PI / 2;
  const near = new THREE.BoxGeometry(2, .30, 2).toNonIndexed().translate(2, 4, 1);
  const far = new THREE.BoxGeometry(2, .30, 2).toNonIndexed().translate(30, 8, 0);
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.Float32BufferAttribute([4, 0, 0, 4, 40, 0, 4, 40, 2], 3));
  wall.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 2)); wall.computeVertexNormals();
  const geometry = mergeGeometries([near, far, wall]); near.dispose(); far.dispose(); wall.dispose();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const stone = new THREE.Mesh(geometry, material); stone.name = '山径天然石阶'; group.add(stone);
  group.updateWorldMatrix(true, true);
  return { island: { group, heightAtRendered: () => 3 }, stone, dispose() { geometry.dispose(); material.dispose(); } };
}

function sampler(island, sites) {
  assert.equal(typeof module.createPavilionSurfaceSampler, 'function', '应提供真实山路石阶与地形合并的高度采样器');
  return module.createPavilionSurfaceSampler(island, sites);
}

test('柱脚采样合并真实上向石阶顶面并正确处理父节点平移与旋转', () => {
  // Catches using soil alone, forgetting matrixWorld, or counting a vertical retaining wall as a walking top.
  const fixture = actualStoneFixture();
  try {
    const heightAt = sampler(fixture.island, [{ position: { x: 11, z: -9 } }]);
    assert.ok(Math.abs(heightAt(11, -9) - 6.15) < .00001);
    assert.equal(heightAt(12.2, -9), 3, '踏面外应回到实际地形高度');
    assert.equal(heightAt(11, -11), 3, '竖向挡土石壁不应被当成高平台');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const x of [10.7, 11, 11.3]) for (const z of [-9.3, -9, -8.7]) {
      ray.ray.origin.set(x, 100, z);
      const hit = ray.intersectObject(fixture.stone)[0];
      assert.ok(hit && Math.abs(heightAt(x, z) - hit.point.y) < .00001, '纯数值采样应与独立真实几何射线一致');
    }
  } finally { fixture.dispose(); }
});

test('两个亭的采样范围都覆盖真实台阶，区域外只取原地形且不改动源几何', () => {
  // Catches forgetting the second summit, indexing the entire island, or mutating source scene resources.
  const fixture = actualStoneFixture();
  try {
    const geometry = fixture.stone.geometry, position = geometry.attributes.position;
    const sites = [{ position: { x: 11, z: -9 } }, { position: { x: 10, z: -37 } }];
    const heightAt = sampler(fixture.island, sites);
    assert.ok(Math.abs(heightAt(10, -37) - 10.15) < .00001);
    const nearOnly = sampler(fixture.island, sites.slice(0, 1));
    assert.equal(nearOnly(10, -37), 3, '场地范围以外不需要复制全岛石阶索引');
    assert.equal(heightAt(100, 100), 3);
    assert.equal(fixture.stone.geometry, geometry); assert.equal(geometry.attributes.position, position);
    assert.equal(fixture.island.group.children.length, 1);
  } finally { fixture.dispose(); }
});
