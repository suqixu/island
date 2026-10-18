import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as winter from '../src/winter-foliage.js';
import { createForestCanopy } from '../src/forest-canopy.js';
import { createForestCanopyLod } from '../src/forest-canopy-lod.js';
import { createIsland } from '../src/models/island.js';

function prepare(geometry, indicesPerLeaf) {
  assert.equal(typeof winter.createWinterLeafDrawRange, 'function', '冬季应在提交顶点前排除必然被discard的整片叶');
  return winter.createWinterLeafDrawRange(geometry, indicesPerLeaf);
}
const gpuThreshold = cover => Math.fround(1 - Math.fround(Math.fround(.88) * Math.fround(Math.max(0, Math.min(1, cover)))));
const visibleIndices = (geometry, threshold, count = geometry.index.count) => {
  const result = [];
  for (let i = 0; i < count; i++) {
    const vertex = geometry.index.getX(i);
    if (geometry.attributes.aWinterLeaf.getX(vertex) < threshold) result.push(vertex);
  }
  return result.sort((a, b) => a - b);
};

test('近远景提交相同可见整叶，排序保留原三角形、属性与稳定索引缓存', () => {
  for (const seed of [1922, 2019, 2116, 2213]) {
    const model = createForestCanopy(seed), far = createForestCanopyLod(model.leaves);
    try {
      for (const [geometry, stride] of [[model.leaves, 18], [far, 6]]) {
        const attributes = new Map(Object.entries(geometry.attributes));
        const snapshots = new Map([...attributes].map(([name, attribute]) => [name, { array: attribute.array.slice(), version: attribute.version }]));
        const original = geometry.index.array.slice();
        const originalArray = Array.from(original);
        const ranks = geometry.attributes.aWinterLeaf;
        const update = prepare(geometry, stride), sorted = geometry.index.array.slice(), index = geometry.index;
        const version = index.version;
        for (let start = 0; start < sorted.length; start += stride) {
          const originalStart = originalArray.indexOf(sorted[start]);
          assert.deepEqual(sorted.slice(start, start + stride), original.slice(originalStart, originalStart + stride), '保留整片叶的顶点顺序与绕向');
          const rank = ranks.getX(sorted[start]);
          if (start) assert.ok(rank >= ranks.getX(sorted[start - stride]));
          for (let i = start; i < start + stride; i++) assert.equal(ranks.getX(sorted[i]), rank);
        }
        for (const cover of [0, .1, .5, .8, 1, .3, -1, 2, 0]) {
          update(cover);
          const threshold = gpuThreshold(cover);
          const expected = [];
          for (const vertex of original) if (ranks.getX(vertex) < threshold) expected.push(vertex);
          assert.deepEqual(visibleIndices(geometry, threshold, geometry.drawRange.count), expected.sort((a, b) => a - b));
          assert.equal(geometry.drawRange.start, 0);
          assert.equal(geometry.drawRange.count % stride, 0);
          assert.equal(geometry.index, index);
          assert.equal(index.version, version, '冬态渐变不应重新上传索引');
          assert.deepEqual(index.array, sorted);
          for (const [name, attribute] of attributes) assert.equal(geometry.attributes[name], attribute);
        }
        assert.equal(geometry.drawRange.count, original.length, '回到夏天恢复全部原始叶片');
        for (const [name, attribute] of attributes) {
          assert.deepEqual(attribute.array, snapshots.get(name).array, '排序不得改变原始顶点属性');
          assert.equal(attribute.version, snapshots.get(name).version, '冬态更新不得上传顶点属性');
        }
      }
    } finally { model.leaves.dispose(); far.dispose(); model.branches.dispose(); }
  }
});

test('浮点阈值邻近的叶片保守提交，由现有shader裁定边界且不漏叶', () => {
  const marks = [.7, .11999995, .12000000, .12000005, .12001, .1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aWinterLeaf', new THREE.Float32BufferAttribute(marks.flatMap(value => [value, value, value]), 1));
  geometry.setIndex(marks.flatMap((_value, i) => [i * 3, i * 3 + 1, i * 3 + 2]));
  try {
    const update = prepare(geometry, 3);
    update(1);
    assert.equal(geometry.drawRange.count, 12, '阈值±小量三片叶保留给GPU，明显越界的叶片不提交');
    assert.deepEqual(visibleIndices(geometry, gpuThreshold(1), geometry.drawRange.count),
      visibleIndices(geometry, gpuThreshold(1)));
    update(0);
    assert.equal(geometry.drawRange.count, marks.length * 3);
  } finally { geometry.dispose(); }
});

test('岛屿冬态渐变与距离迟滞共用近远景裁剪，回暖恢复且备用几何各释放一次', () => {
  const island = createIsland(new THREE.Scene()), camera = new THREE.PerspectiveCamera();
  const crowns = island.group.children.filter(mesh => mesh.name.startsWith('阔叶冠层'));
  const near = crowns.map(mesh => mesh.geometry), matrices = crowns.map(mesh => mesh.instanceMatrix.array.slice());
  const counts = crowns.map(mesh => mesh.count), materials = crowns.map(mesh => mesh.material);
  const released = new Map(), track = geometry => { released.set(geometry, 0); geometry.addEventListener('dispose', () => released.set(geometry, released.get(geometry) + 1)); };
  near.forEach(track);
  let time = 0;
  const advance = (steps, env) => { for (let i = 0; i < steps; i++) island.update(time += .08, env, camera); };
  try {
    camera.position.z = 300;
    advance(1, { seasonIndex: 3 });
    const far = crowns.map(mesh => mesh.geometry); far.forEach(track);
    const indices = [...near, ...far].map(geometry => [geometry.index, geometry.index.version, geometry.index.array.slice()]);
    advance(150, { seasonIndex: 3 });
    for (let i = 0; i < crowns.length; i++) {
      for (const [geometry, stride] of [[near[i], 18], [far[i], 6]]) {
        assert.ok(geometry.drawRange.count < geometry.index.count * .15, '严冬只提交剩余叶片');
        assert.ok(geometry.drawRange.count > geometry.index.count * .07);
        assert.equal(geometry.drawRange.count % stride, 0);
      }
      assert.equal(near[i].drawRange.count / 18, far[i].drawRange.count / 6, '切换距离前两档应已同步相同叶片阈值');
      assert.equal(crowns[i].material, materials[i]);
      assert.equal(crowns[i].count, counts[i]);
      assert.deepEqual(crowns[i].instanceMatrix.array, matrices[i]);
      assert.equal(crowns[i].castShadow, true);
    }
    camera.position.z = 200; advance(1, { seasonIndex: 3 });
    assert.ok(crowns.every((mesh, i) => mesh.geometry === far[i]));
    camera.position.z = 100; advance(1, { seasonIndex: 3 });
    assert.ok(crowns.every((mesh, i) => mesh.geometry === near[i]));
    advance(150, { seasonIndex: 1 });
    for (const geometry of [...near, ...far]) assert.equal(geometry.drawRange.count, geometry.index.count);
    for (const [index, version, array] of indices) { assert.equal(index.version, version); assert.deepEqual(index.array, array); }
    island.dispose(); island.dispose();
    assert.equal(released.size, 8);
    assert.ok([...released.values()].every(count => count === 1));
  } finally { island.dispose(); }
});
