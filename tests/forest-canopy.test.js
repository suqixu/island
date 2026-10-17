import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const forest = await import('../src/forest-canopy.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const create = seed => {
  assert.equal(typeof forest?.createForestCanopy, 'function', '普通树冠需要真实细枝与独立叶片，而不是封闭的球形冠团');
  return forest.createForestCanopy(seed);
};
const dispose = model => { model.leaves.dispose(); model.branches.dispose(); };
const crossXZ = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function projectedOutline(position) {
  const points = Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getZ(i)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [], upper = [];
  for (const point of points) {
    while (lower.length > 1 && crossXZ(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of [...points].reverse()) {
    while (upper.length > 1 && crossXZ(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

test('树冠由叶片组成，没有跨叶片的大块封闭表面，叶根附着实际细枝', () => {
  const model = create(1922);
  try {
    const geometry = model.leaves, { position, aFlex, color, normal } = geometry.attributes;
    const parent = Array.from({ length: position.count }, (_, i) => i);
    const find = value => parent[value] === value ? value : (parent[value] = find(parent[value]));
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      parent[find(index[i + 1])] = find(index[i]); parent[find(index[i + 2])] = find(index[i]);
    }
    const components = new Map();
    for (let i = 0; i < position.count; i++) {
      const key = find(i), box = components.get(key) ?? new THREE.Box3();
      box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, i)); components.set(key, box);
      assert.ok([position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)]
        .every(Number.isFinite));
    }
    assert.ok(components.size >= 280 && components.size <= 420, `叶片数量 ${components.size}，需兼顾枝叶细节与实例预算`);
    const span = new THREE.Vector3();
    for (const box of components.values()) assert.ok(box.getSize(span).length() < .75, '不能重新长出大块塑料冠团');
    const wood = model.branches.attributes.position, woodIndex = model.branches.index.array;
    const base = new THREE.Vector3(), point = new THREE.Vector3(), triangle = new THREE.Triangle();
    let roots = 0, maximumGap = 0, darkest = Infinity, brightest = -Infinity;
    for (let i = 0; i < position.count; i++) {
      darkest = Math.min(darkest, color.getX(i)); brightest = Math.max(brightest, color.getX(i));
      if (aFlex.getX(i) !== 0) continue;
      base.fromBufferAttribute(position, i); let gap = Infinity;
      for (let j = 0; j < woodIndex.length; j += 3) {
        triangle.a.fromBufferAttribute(wood, woodIndex[j]); triangle.b.fromBufferAttribute(wood, woodIndex[j + 1]);
        triangle.c.fromBufferAttribute(wood, woodIndex[j + 2]); triangle.closestPointToPoint(base, point);
        gap = Math.min(gap, base.distanceTo(point));
      }
      maximumGap = Math.max(maximumGap, gap); roots++;
    }
    assert.equal(roots, components.size * 2, '每片叶子有两点固定的窄叶柄端，叶端轮廓不再是尖三角');
    assert.ok(maximumGap < .06, `叶柄与真实细枝之间最大距离 ${maximumGap}m`);
    assert.ok(brightest - darkest > .25, '内层叶簇、外缘叶尖需要自然的明暗变化');
    assert.ok((geometry.index.count + model.branches.index.count) / 3 < 2400, '每株几何预算不能膨胀到海量独立小枝');
  } finally { dispose(model); }
});

test('树冠投影保留叶簇间透光空隙，三个高度层都有真实叶片', () => {
  let totalSamples = 0, totalCovered = 0;
  for (const seed of [1922, 2019, 2116, 2213]) {
    const model = create(seed), mesh = new THREE.Mesh(model.leaves, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    try {
      model.leaves.computeBoundingBox(); const box = model.leaves.boundingBox;
      const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3(0, -1, 0);
      const outline = projectedOutline(model.leaves.attributes.position);
      let samples = 0, holes = 0, covered = 0;
      for (let x = box.min.x; x <= box.max.x; x += .13) for (let z = box.min.z; z <= box.max.z; z += .13) {
        if (!outline.every((point, i) => crossXZ(point, outline[(i + 1) % outline.length], [x, z]) >= 0)) continue;
        ray.set(origin.set(x, 5, z), direction); samples++;
        if (ray.intersectObject(mesh, false).length) covered++; else holes++;
      }
      assert.ok(holes / samples > .16 && covered / samples > .65,
        `冠层需要透光且保持茂密，实际覆盖率 ${(covered / samples).toFixed(3)}`);
      totalSamples += samples; totalCovered += covered;
      const position = model.leaves.attributes.position, layers = [0, 0, 0];
      for (let i = 0; i < position.count; i++) layers[position.getY(i) < -.25 ? 0 : position.getY(i) < .75 ? 1 : 2]++;
      assert.ok(layers.every(count => count > position.count * .15), '冠层不是同一高度的一张叶片薄饼');
      assert.ok(box.max.y - box.min.y > 2.3 && box.max.x - box.min.x > 3.4);
    } finally { mesh.material.dispose(); dispose(model); }
  }
  assert.ok(totalCovered / totalSamples >= .70 && totalCovered / totalSamples <= .80,
    `四种自然疏密的树冠平均覆盖率 ${(totalCovered / totalSamples).toFixed(3)}，应茂密而透光`);
});

test('不同树形不重复，种子稳定且叶根固定、叶尖可以摆动', () => {
  const first = create(1922), again = create(1922), different = create(2019);
  try {
    assert.deepEqual(first.leaves.attributes.position.array, again.leaves.attributes.position.array);
    assert.notDeepEqual(first.leaves.attributes.position.array, different.leaves.attributes.position.array);
    const flex = first.leaves.attributes.aFlex;
    assert.ok(Array.from(flex.array).every(value => value >= 0 && value <= .42), '叶片柔性有界，避免叶尖脱离细枝飞出去');
    assert.ok(Array.from(flex.array).some(value => value > .3));
    assert.ok(Array.from(first.branches.attributes.aFlex.array).every(value => value === 0), '细枝随整株弯曲，不叠加叶尖抖动');
  } finally { [first, again, different].forEach(dispose); }
});
