import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const snow = await import('../src/models/snow-normals.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

test('非索引岩石的同位置顶点共享单位积雪法线，原岩石属性保持不变', () => {
  assert.equal(typeof snow?.addSmoothSnowNormals, 'function');
  const geometry = new THREE.IcosahedronGeometry(2, 1);
  geometry.computeVertexNormals();
  const originalAttributes = { ...geometry.attributes }, before = geometry.clone(), originalIndex = geometry.index;
  try {
    assert.equal(snow.addSmoothSnowNormals(geometry), geometry);
    const smooth = geometry.attributes.aSnowNormal, position = geometry.attributes.position;
    assert.equal(smooth.count, position.count);
    const shared = new Map();
    let differentNormals = 0, duplicated = 0;
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map(value => Math.round(value * 1e5)).join(',');
      const normal = [smooth.getX(i), smooth.getY(i), smooth.getZ(i)];
      assert.ok(normal.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
      if (shared.has(key)) { assert.deepEqual(normal, shared.get(key)); duplicated++; }
      else shared.set(key, normal);
      if (normal.some((value, axis) => Math.abs(value - geometry.attributes.normal.array[i * 3 + axis]) > .01)) differentNormals++;
    }
    assert.ok(duplicated > 50, '验证真正共享的位置副本');
    assert.ok(differentNormals > position.count * .5, '不能继续使用岩石原有逐面法线');
    for (const [name, attribute] of Object.entries(originalAttributes)) {
      assert.equal(geometry.attributes[name], attribute);
      assert.deepEqual(attribute.array, before.attributes[name].array);
    }
    assert.equal(geometry.index, originalIndex);
    const firstAttribute = geometry.attributes.aSnowNormal, firstArray = firstAttribute.array;
    snow.addSmoothSnowNormals(geometry);
    assert.equal(geometry.attributes.aSnowNormal, firstAttribute);
    assert.equal(geometry.attributes.aSnowNormal.array, firstArray);
  } finally { geometry.dispose(); before.dispose(); }
});

test('索引几何不改拓扑，零法线与无原法线的退化输入也不会产生NaN', () => {
  assert.equal(typeof snow?.addSmoothSnowNormals, 'function');
  const indexed = new THREE.BoxGeometry(1, 1, 1), oldIndex = indexed.index, indexValues = indexed.index.array.slice();
  const degenerate = new THREE.BufferGeometry();
  degenerate.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 1, 0, 0], 3));
  degenerate.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const noNormal = new THREE.BufferGeometry();
  noNormal.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  try {
    for (const geometry of [indexed, degenerate, noNormal]) {
      snow.addSmoothSnowNormals(geometry);
      const normal = geometry.attributes.aSnowNormal;
      assert.ok(Array.from(normal.array).every(Number.isFinite));
      for (let i = 0; i < normal.count; i++) assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-6);
    }
    assert.equal(indexed.index, oldIndex);
    assert.deepEqual(indexed.index.array, indexValues);
    assert.equal(noNormal.attributes.normal, undefined, '缺失原法线时也不能修改原有属性集合');
  } finally { indexed.dispose(); degenerate.dispose(); noNormal.dispose(); }
});
