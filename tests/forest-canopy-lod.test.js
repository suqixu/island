import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createForestCanopy } from '../src/forest-canopy.js';
import { createIsland } from '../src/models/island.js';

const lod = await import('../src/forest-canopy-lod.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const triangle = new THREE.Triangle();
function area(geometry, first, count) {
  let sum = 0;
  for (let offset = first; offset < first + count; offset += 3) {
    triangle.a.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(offset));
    triangle.b.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(offset + 1));
    triangle.c.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(offset + 2));
    sum += triangle.getArea();
  }
  return sum;
}

test('远景保留每片叶及折色属性，用两三角形维持原叶片面积与固定叶根', () => {
  assert.equal(typeof lod.createForestCanopyLod, 'function');
  for (const seed of [1922, 2019, 2116, 2213]) {
    const model = createForestCanopy(seed), near = model.leaves;
    const snapshot = Object.fromEntries(Object.entries(near.attributes).map(([name, value]) => [name, value.array.slice()]));
    const far = lod.createForestCanopyLod(near);
    try {
      const leaves = near.attributes.position.count / 8;
      assert.equal(far.attributes.position.count, leaves * 4);
      assert.equal(far.index.count, leaves * 6, '每片叶两三角形，不能删叶或跨叶片连面');
      assert.deepEqual(Object.keys(far.attributes).sort(), Object.keys(near.attributes).sort());
      for (const [name, source] of Object.entries(near.attributes)) {
        assert.deepEqual(source.array, snapshot[name], '近景数据不得被改写');
        assert.equal(far.attributes[name].itemSize, source.itemSize);
        assert.ok(Array.from(far.attributes[name].array).every(Number.isFinite), `${name} 需要有限数据`);
      }
      for (let leaf = 0; leaf < leaves; leaf++) {
        for (let i = leaf * 6; i < leaf * 6 + 6; i++) {
          assert.equal(Math.floor(far.index.getX(i) / 4), leaf, '每片叶仍独立');
        }
        assert.equal(far.attributes.aFlex.getX(leaf * 4), 0);
        assert.ok(far.attributes.aFlex.getX(leaf * 4 + 3) > .3);
        for (let vertex = 0; vertex < 4; vertex++) {
          assert.equal(far.attributes.aWinterLeaf.getX(leaf * 4 + vertex), near.attributes.aWinterLeaf.getX(leaf * 8));
        }
        for (const [target, sources] of [[0, [0, 1]], [1, [2, 4]], [2, [3, 5]], [3, [6, 7]]]) {
          for (const name of ['color', 'aCover', 'aFlex', 'uv']) {
            const source = near.attributes[name], attribute = far.attributes[name];
            for (let component = 0; component < source.itemSize; component++) {
              const expected = (source.array[(leaf * 8 + sources[0]) * source.itemSize + component]
                + source.array[(leaf * 8 + sources[1]) * source.itemSize + component]) / 2;
              assert.ok(Math.abs(attribute.array[(leaf * 4 + target) * attribute.itemSize + component] - expected) < 1e-7,
                `${name} 应沿用相同叶片的原始顶点属性`);
            }
          }
        }
        assert.ok(Math.abs(area(far, leaf * 6, 6) / area(near, leaf * 18, 18) - 1) < .01,
          '不能因为菱形简化显著减少远景叶面积');
      }
    } finally { near.dispose(); model.branches.dispose(); far.dispose(); }
  }
});

test('相机远近切换有迟滞，保持树与叶密度、实例姿态和近景数据，备用几何各释放一次', () => {
  const island = createIsland(new THREE.Scene());
  const crowns = island.group.children.filter(object => object.name.startsWith('阔叶冠层'));
  const original = crowns.map(mesh => mesh.geometry);
  const matrices = crowns.map(mesh => mesh.instanceMatrix.array.slice());
  const colors = crowns.map(mesh => mesh.instanceColor.array.slice());
  const counts = crowns.map(mesh => mesh.count);
  const disposed = new Map();
  const track = geometry => {
    disposed.set(geometry, 0);
    geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry) + 1));
  };
  original.forEach(track);
  const camera = new THREE.PerspectiveCamera();
  let far;
  try {
    camera.position.set(0, 0, 300); island.update(1, { season: 'summer' }, camera);
    far = crowns.map(mesh => mesh.geometry); far.forEach(track);
    for (let index = 0; index < crowns.length; index++) {
      const mesh = crowns[index];
      assert.notEqual(mesh.geometry, original[index], '远景必须减少实际绘制几何');
      assert.equal(mesh.geometry.index.count, original[index].index.count / 3);
      assert.equal(mesh.count, counts[index], 'LOD不能通过减少树或叶数量达成');
      assert.deepEqual(mesh.instanceMatrix.array, matrices[index]);
      assert.deepEqual(mesh.instanceColor.array, colors[index]);
      for (const name of ['aPlantRoot', 'aPlantHeight']) {
        assert.deepEqual(mesh.geometry.attributes[name].array, original[index].attributes[name].array);
      }
      assert.equal(mesh.castShadow, true, '当前网格及阴影共用当前LOD几何');
    }
    camera.position.z = 200; island.update(2, { season: 'summer' }, camera);
    assert.ok(crowns.every((mesh, i) => mesh.geometry === far[i]), '迟滞区保持远景');
    camera.position.z = 100; island.update(3, { season: 'summer' }, camera);
    assert.ok(crowns.every((mesh, i) => mesh.geometry === original[i]), '近景恢复原始叶片');
    camera.position.z = 200; island.update(4, { season: 'summer' }, camera);
    assert.ok(crowns.every((mesh, i) => mesh.geometry === original[i]), '迟滞区保持近景');
    island.update(5, { season: 'summer' });
    assert.ok(crowns.every((mesh, i) => mesh.geometry === original[i]), '不传相机沿用原近景行为');
    camera.position.z = 300; island.update(6, { season: 'summer' }, camera);
    island.update(7, { season: 'summer' });
    assert.ok(crowns.every((mesh, i) => mesh.geometry === original[i]), '调用方省略相机时恢复原始几何');
    island.dispose(); island.dispose();
    assert.equal(disposed.size, 8);
    assert.ok([...disposed.values()].every(count => count === 1), '挂载与备用几何都只释放一次');
  } finally { island.dispose(); }
});
