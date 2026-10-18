import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const snow = await import('../src/models/snow-layers.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function roofSurface() {
  // 弧面由独立三角形组成，接缝重复点与山亭屋面相同。
  const geometry = new THREE.PlaneGeometry(3, 3, 8, 8).rotateX(-Math.PI / 2).toNonIndexed();
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const radius = Math.max(Math.abs(position.getX(i)), Math.abs(position.getZ(i))) / 1.5;
    position.setY(i, 3.5 - radius + .3 * radius ** 9);
  }
  geometry.computeVertexNormals();
  return geometry;
}

test('屋面积雪独立生成且来源不变，重复点合并后形成封闭的柔和厚雪壳', () => {
  assert.equal(typeof snow?.createSnowRoofShell, 'function');
  const source = roofSurface(), before = source.clone();
  let disposed = false;
  source.addEventListener('dispose', () => { disposed = true; });
  const shell = snow.createSnowRoofShell(source);
  try {
    assert.notEqual(shell, source);
    assert.deepEqual(source.attributes.position.array, before.attributes.position.array);
    assert.deepEqual(source.attributes.normal.array, before.attributes.normal.array);
    assert.equal(disposed, false);
    const { position, normal, aSnowBase } = shell.attributes;
    assert.ok(aSnowBase && shell.index);
    assert.equal(position.count, aSnowBase.count);
    assert.ok(position.count < source.attributes.position.count, '独立面的重复顶点需要按位置合并');
    const uniquePositions = new Set(), deltas = [];
    for (let i = 0; i < position.count; i++) {
      const point = [position.getX(i), position.getY(i), position.getZ(i)];
      uniquePositions.add(point.map(value => Math.round(value * 1e5)).join(','));
      assert.equal(position.getX(i), aSnowBase.getX(i));
      assert.equal(position.getZ(i), aSnowBase.getZ(i));
      const delta = position.getY(i) - aSnowBase.getY(i);
      assert.ok(delta >= -1e-6, '零厚度基面不能高于满雪顶点');
      deltas.push(delta);
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-5, '法线有限且单位化');
    }
    assert.equal(uniquePositions.size, position.count, '边缘顶点应共享，不能保留导致硬接缝的同位置顶点');
    assert.ok(Math.max(...deltas) >= .16 && Math.max(...deltas) <= .19);
    assert.ok(deltas.some(value => value === 0), '侧壁连接到零厚度底面');
    const edges = new Map();
    const indices = shell.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), '顶面、底面与边缘侧壁应闭合');
    assert.ok(Array.from({ length: normal.count }, (_, i) => Math.abs(normal.getY(i)))
      .some(value => value > .1 && value < .8), '共用边缘法线应平滑过渡至侧壁');
    shell.dispose();
    assert.equal(disposed, false, '释放雪壳不能释放源屋面');
  } finally { source.dispose(); before.dispose(); }
});

test('厚度可调且积雪生成稳定，不调用随机源', () => {
  assert.equal(typeof snow?.createSnowRoofShell, 'function');
  const source = roofSurface(), first = snow.createSnowRoofShell(source), again = snow.createSnowRoofShell(source);
  const thick = snow.createSnowRoofShell(source, { thickness: .3 });
  try {
    assert.deepEqual(first.attributes.position.array, again.attributes.position.array);
    assert.deepEqual(first.index.array, again.index.array);
    const oldRandom = Math.random;
    let randomCalls = 0;
    try {
      // Three 的 BufferGeometry UUID 固定消耗四次；雪形本身不能增加消耗。
      Math.random = () => { randomCalls++; return .3; };
      const stable = snow.createSnowRoofShell(source); stable.dispose();
    } finally { Math.random = oldRandom; }
    assert.equal(randomCalls, 4, '除 Three 资源 UUID 外不应调用随机源');
    const maxDepth = geometry => Math.max(...Array.from({ length: geometry.attributes.position.count }, (_, i) =>
      geometry.attributes.position.getY(i) - geometry.attributes.aSnowBase.getY(i)));
    assert.ok(maxDepth(thick) > maxDepth(first) * 1.8);
  } finally { for (const geometry of [source, first, again, thick]) geometry.dispose(); }
});

test('码头单位雪板的所有零厚度顶点均锚定底部平面', () => {
  assert.equal(typeof snow?.createSnowBoardGeometry, 'function');
  const geometry = snow.createSnowBoardGeometry();
  try {
    const { position, aSnowBase } = geometry.attributes;
    assert.equal(position.count, aSnowBase.count);
    for (let i = 0; i < position.count; i++) {
      assert.equal(aSnowBase.getX(i), position.getX(i));
      assert.equal(aSnowBase.getZ(i), position.getZ(i));
      assert.equal(aSnowBase.getY(i), -.5);
      assert.ok(position.getY(i) >= aSnowBase.getY(i));
    }
    geometry.computeBoundingBox();
    assert.deepEqual(geometry.boundingBox.getSize(new THREE.Vector3()).toArray(), [1, 1, 1]);
  } finally { geometry.dispose(); }
});
