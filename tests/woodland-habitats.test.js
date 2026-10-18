import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createForestCanopy } from '../src/forest-canopy.js';
import { createIsland } from '../src/models/island.js';
import { seededRandom } from '../src/terrain.js';

const api = await import('../src/woodland-habitats.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
function create(options) {
  assert.equal(typeof api.createWoodlandHabitats, 'function', '需要真实森林栖息地采样器');
  return api.createWoodlandHabitats(options);
}
function fixture({ heightAt = () => 2, count = 40, transform = false, stoneHeight = .12 } = {}) {
  const group = new THREE.Group(), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  if (transform) { group.position.set(7, 3, -6); group.rotation.y = .32; }
  const trees = Array.from({ length: count }, (_, i) => ({ x: i % 2 ? 4 : -4,
    z: 3 + Math.floor(i / 2) * 3, y: heightAt(i % 2 ? 4 : -4, 3 + Math.floor(i / 2) * 3),
    scale: .9 + i % 3 * .1, rotation: .2 + i * .11, tone: .4, variant: i % 4 }));
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.11, .19, 1, 7, 8), material, count * 3);
  trunks.name = '森林树干与分叉'; group.add(trunks);
  const canopies = [], canopyGeometries = [], object = new THREE.Object3D();
  for (let variant = 0; variant < 4; variant++) {
    const selected = trees.filter(tree => tree.variant === variant), form = createForestCanopy(1922 + variant * 97);
    const canopy = new THREE.InstancedMesh(form.leaves, material, selected.length);
    canopy.name = `阔叶冠层-${variant + 1}`; canopy.userData.trees = selected;
    const branches = new THREE.InstancedMesh(form.branches, material, selected.length);
    branches.name = `森林细枝-${variant + 1}`;
    selected.forEach((tree, i) => {
      object.position.set(tree.x, tree.y + 5.1 * tree.scale, tree.z); object.rotation.set(0, tree.rotation, 0);
      object.scale.set(tree.scale, tree.scale * .93, tree.scale); object.updateMatrix();
      canopy.setMatrixAt(i, object.matrix); branches.setMatrixAt(i, object.matrix);
    });
    canopies.push(canopy); canopyGeometries.push({ mesh: canopy, near: form.leaves, far: form.leaves }); group.add(canopy, branches);
  }
  trees.forEach((tree, i) => {
    object.position.set(tree.x, tree.y + 5.1 * tree.scale * .48, tree.z);
    object.rotation.set(0, tree.rotation, .055 * Math.sin(tree.rotation));
    object.scale.set(tree.scale, 5.1 * tree.scale, tree.scale); object.updateMatrix();
    for (let part = 0; part < 3; part++) trunks.setMatrixAt(i * 3 + part, object.matrix);
  });
  const road = new THREE.Mesh(new THREE.BoxGeometry(1.4, .038, 65).translate(0, 2 + .019, 32.5), material);
  road.name = '环岛沙土与登山小径'; group.add(road);
  const stone = new THREE.Mesh(new THREE.BoxGeometry(1, stoneHeight, 65).translate(0, 2 + stoneHeight / 2, 32.5), material);
  stone.name = '山径天然石阶'; group.add(stone);
  group.updateMatrixWorld(true);
  const forest = { trees, trunks, canopies, canopyGeometries };
  const uniforms = { uTime: { value: 0 }, uTreeAmplitudes: { value: new THREE.Vector2() }, uWindDirection: { value: new THREE.Vector2(.6, .8) } };
  const pathLayout = { routes: [{ id: '平缓林间小径', kind: 'mountain', width: 1.4,
    points: [{ x: 0, y: heightAt(0, 0) + .038, z: 0 }, { x: 0, y: heightAt(0, 65) + .038, z: 65 }] }],
  heightAtRendered: heightAt, distanceAt: x => Math.abs(x) - .7 };
  function dispose() {
    const resources = new Set(); group.traverse(mesh => {
      if (mesh.geometry) resources.add(mesh.geometry); if (mesh.isInstancedMesh) resources.add(mesh);
    }); resources.add(material); resources.forEach(resource => resource.dispose());
  }
  return { group, forest, uniforms, pathLayout, dispose };
}
function shaderBend(point, root, height, uniforms) {
  const phase = root.x * .071 + root.z * .097, time = uniforms.uTime.value;
  const h = THREE.MathUtils.clamp(((point.y - root.y) / height - .06) / .94, 0, 1);
  const flex = h * h * (3 - 2 * h), bend = flex * flex, amplitude = uniforms.uTreeAmplitudes.value.x;
  const sway = .55 * Math.sin(time * .62 + phase) + .24 * Math.sin(time * .93 + phase * 1.7)
    + .11 * Math.sin(time * .27 + phase * .51) + .1 * Math.sin(time * .43);
  const along = sway * amplitude * bend, across = Math.sin(time * .67 + phase + 1.7) * amplitude * .15 * bend;
  const direction = uniforms.uWindDirection.value;
  return point.clone().add(new THREE.Vector3(direction.x * along - direction.y * across, 0,
    direction.y * along + direction.x * across));
}

test('精选真实路径附近树木，主干点使用第 i*3 实例变换且离树皮距离为世界米', () => {
  const f = fixture({ transform: true }), habitats = create(f);
  try {
    assert.ok(habitats.trees.length >= 24 && habitats.trees.length <= 36);
    for (const tree of habitats.trees) {
      assert.ok(tree.root.isVector3 && tree.height > 3 && tree.available());
      const localRoot = f.group.worldToLocal(tree.root.clone());
      const i = f.forest.trees.findIndex(actual => Math.hypot(actual.x - localRoot.x, actual.z - localRoot.z) < 1e-5);
      assert.ok(i >= 0, '不能虚构树根');
      const matrix = new THREE.Matrix4(); f.forest.trunks.getMatrixAt(i * 3, matrix);
      const expected = new THREE.Vector3(0, 0, .15).applyMatrix4(matrix).applyMatrix4(f.forest.trunks.matrixWorld);
      const normal = new THREE.Vector3(), contact = tree.sampleTrunk(0, .5, Math.PI / 2, 0, new THREE.Vector3(), normal);
      assert.ok(contact.distanceTo(expected) < 1e-5);
      const body = tree.sampleTrunk(0, .5, Math.PI / 2, .12, new THREE.Vector3(), normal);
      assert.ok(Math.abs(body.distanceTo(contact) - .12) < 1e-6);
      assert.ok(Math.abs(normal.length() - 1) < 1e-6);
      assert.ok(body.clone().sub(contact).dot(normal) > .1199);
    }
  } finally { f.dispose(); }
});

test('树干和真实细枝落点跟随 GPU 全树风摆，枝顶采样始终接触实际三角面', () => {
  const f = fixture({ transform: true }), habitats = create(f);
  try {
    const tree = habitats.trees[0], base = tree.sampleTrunk(0, .5, Math.PI / 2, 0, new THREE.Vector3(), new THREE.Vector3());
    f.uniforms.uTime.value = 4.2; f.uniforms.uTreeAmplitudes.value.set(1.1, 1.5);
    const bent = tree.sampleTrunk(4.2, .5, Math.PI / 2, 0, new THREE.Vector3(), new THREE.Vector3());
    const expected = shaderBend(base, tree.root, tree.height, f.uniforms);
    assert.ok(bent.distanceTo(expected) < 1e-5); assert.ok(base.distanceTo(bent) > .005);
    assert.ok(habitats.perches.length > 10);
    for (const perch of habitats.perches.slice(0, 4)) {
      assert.equal(perch.kind, 'branch'); assert.ok(perch.available());
      assert.equal(typeof perch.sampleFrame, 'function', '真实枝条需要提供双脚排列的切向');
      const surfaceNormal = new THREE.Vector3(), along = new THREE.Vector3(), framePoint = new THREE.Vector3();
      perch.sampleFrame(4.2, framePoint, surfaceNormal, along);
      const target = perch.sample(4.2, new THREE.Vector3()), triangle = new THREE.Triangle(), closest = new THREE.Vector3();
      assert.ok(framePoint.distanceTo(target) < 1e-6 && Math.abs(surfaceNormal.dot(along)) < 1e-6);
      const feet = [target, target.clone().addScaledVector(along, .033), target.clone().addScaledVector(along, -.033)];
      const gaps = feet.map(() => Infinity);
      for (const canopy of f.forest.canopies) {
        const branches = f.group.getObjectByName(canopy.name.replace('阔叶冠层', '森林细枝'));
        const geometry = branches.geometry, matrix = new THREE.Matrix4();
        for (let instance = 0; instance < branches.count; instance++) {
          branches.getMatrixAt(instance, matrix);
          const actualTree = canopy.userData.trees[instance], root = new THREE.Vector3(actualTree.x, actualTree.y, actualTree.z).applyMatrix4(branches.matrixWorld);
          const points = Array.from({ length: geometry.attributes.position.count }, (_, index) => shaderBend(new THREE.Vector3()
            .fromBufferAttribute(geometry.attributes.position, index).applyMatrix4(matrix).applyMatrix4(branches.matrixWorld), root, actualTree.scale * 5.1, f.uniforms));
          for (let index = 0; index < geometry.index.count; index += 3) {
            triangle.set(points[geometry.index.getX(index)], points[geometry.index.getX(index + 1)], points[geometry.index.getX(index + 2)]);
            feet.forEach((foot, i) => { triangle.closestPointToPoint(foot, closest); gaps[i] = Math.min(gaps[i], foot.distanceTo(closest)); });
          }
        }
      }
      assert.ok(gaps.every(gap => gap < 1e-5), `双脚均需接触真实风摆枝面，当前距离 ${gaps}`);
    }
  } finally { f.dispose(); }
});

test('任意爬树角度与高度也落在弯曲后的七边形树皮三角面上', () => {
  const f = fixture({ count: 4, transform: true }), habitats = create(f);
  try {
    f.uniforms.uTime.value = 8.3; f.uniforms.uTreeAmplitudes.value.x = 1.4;
    const tree = habitats.trees[0], localRoot = f.group.worldToLocal(tree.root.clone());
    const i = f.forest.trees.findIndex(actual => Math.hypot(actual.x - localRoot.x, actual.z - localRoot.z) < 1e-5);
    const mesh = f.forest.trunks, matrix = new THREE.Matrix4(); mesh.getMatrixAt(i * 3, matrix); matrix.premultiply(mesh.matrixWorld);
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const points = Array.from({ length: position.count }, (_, vertex) => shaderBend(new THREE.Vector3()
      .fromBufferAttribute(position, vertex).applyMatrix4(matrix), tree.root, tree.height, f.uniforms));
    const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
    for (const fraction of [.13, .58, .91]) for (const angle of [0, .3, 1.8, 4.7]) {
      const point = tree.sampleTrunk(8.3, fraction, angle, 0, new THREE.Vector3(), new THREE.Vector3());
      let gap = Infinity;
      for (let at = 0; at < index.count; at += 3) {
        triangle.set(points[index.getX(at)], points[index.getX(at + 1)], points[index.getX(at + 2)]);
        triangle.closestPointToPoint(point, closest); gap = Math.min(gap, closest.distanceTo(point));
      }
      assert.ok(gap < 1e-5, `爬树落点不能按圆柱近似浮在真实七边形树皮外，当前误差 ${gap}`);
    }
  } finally { f.dispose(); }
});

test('画质裁减或隐藏真实树干、冠层与细枝后，相关树木和居民落点不再可用', () => {
  const f = fixture(), habitats = create(f);
  try {
    assert.ok(habitats.trees.every(tree => tree.available()));
    f.forest.canopies[0].count = 0;
    assert.ok(habitats.trees.some(tree => !tree.available())); assert.ok(habitats.trees.some(tree => tree.available()));
    f.forest.canopies[0].count = 10;
    f.forest.trunks.count = 0;
    for (const item of [...habitats.trees, ...habitats.perches, ...habitats.crossings, ...habitats.fireflyHabitats]) assert.equal(item.available(), false);
    f.forest.trunks.count = 120;
    f.group.getObjectByName('森林细枝-1').visible = false;
    assert.ok(habitats.perches.some(perch => !perch.available()));
    f.group.visible = false;
    assert.ok(habitats.perches.every(perch => !perch.available()));
  } finally { f.dispose(); }
});

test('穿越路线连接真实两侧树根，地面点踏在实际石阶上且纵坡安全，萤火虫起点留在路边地表', () => {
  const f = fixture(), habitats = create(f);
  try {
    assert.ok(habitats.crossings.length > 0 && habitats.crossings.length <= 6);
    let stepped = 0;
    for (const crossing of habitats.crossings) {
      assert.ok(habitats.trees.includes(crossing.from) && habitats.trees.includes(crossing.to));
      assert.ok(crossing.from.root.x * crossing.to.root.x < 0 && crossing.available());
      assert.ok(crossing.points[0].distanceTo(crossing.from.root) < .001);
      assert.ok(crossing.points.at(-1).distanceTo(crossing.to.root) < .001);
      for (let i = 0; i < crossing.points.length; i++) {
        const point = crossing.points[i]; assert.ok(point.toArray().every(Number.isFinite));
        if (Math.abs(point.x) < .49) { assert.ok(Math.abs(point.y - 2.12) < 1e-5); stepped++; }
        if (i) {
          const previous = crossing.points[i - 1], distance = Math.hypot(point.x - previous.x, point.z - previous.z);
          assert.ok(Math.abs(point.y - previous.y) <= .18 && Math.abs(point.y - previous.y) / distance <= .7);
        }
      }
    }
    assert.ok(stepped > 0);
    assert.ok(habitats.fireflyHabitats.length > 0);
    for (const habitat of habitats.fireflyHabitats) {
      const point = habitat.sample(0, new THREE.Vector3());
      assert.equal(point.y, 2, '夜间运行层自行增加飞行高度');
      assert.ok(f.pathLayout.distanceAt(point.x, point.z) > .4);
    }
  } finally { f.dispose(); }
});

test('悬崖地形与高坎路线拒绝生成，不为缺少安全路线硬造穿越点', () => {
  for (const options of [{ heightAt: x => Math.abs(x) < 1 ? -3 : 2 }, { stoneHeight: 1.2 }]) {
    const f = fixture(options);
    try { assert.equal(create(f).crossings.length, 0); } finally { f.dispose(); }
  }
  const empty = fixture({ count: 0 });
  try { assert.deepEqual(create(empty), { trees: [], perches: [], crossings: [], fireflyHabitats: [] }); }
  finally { empty.dispose(); }
});

test('栏杆落点来自合并几何最高水平面的三角形，随亭子世界变换同步', () => {
  assert.equal(typeof api.createRailPerches, 'function');
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const parts = [new THREE.BoxGeometry(3, .12, .12).translate(0, 1.7, -1),
    new THREE.BoxGeometry(.12, .12, 3).translate(-1.4, 1.7, 0),
    new THREE.BoxGeometry(.12, 1.3, .12).translate(-1.4, .95, -1)];
  const geometry = mergeGeometries(parts), rails = new THREE.Mesh(geometry, material); rails.name = '山亭三面木栏'; root.add(rails);
  root.position.set(8, 11, -4); root.rotation.y = .42; root.scale.setScalar(1.3); root.updateMatrixWorld(true);
  try {
    const perches = api.createRailPerches([root]); assert.ok(perches.length >= 2);
    for (const perch of perches) {
      assert.equal(perch.kind, 'rail'); assert.ok(perch.available());
      assert.equal(typeof perch.sampleFrame, 'function');
      const world = perch.sample(0, new THREE.Vector3()), local = rails.worldToLocal(world.clone());
      assert.ok(Math.abs(local.y - 1.76) < 1e-6);
      assert.ok(Math.abs(local.z + 1) < .061 || Math.abs(local.x + 1.4) < .061);
      root.position.y += 2; root.updateMatrixWorld(true);
      assert.ok(Math.abs(perch.sample(1, new THREE.Vector3()).y - world.y - 2) < 1e-6);
      root.position.y -= 2; root.updateMatrixWorld(true);
    }
    rails.visible = false; assert.ok(perches.every(perch => !perch.available()));
  } finally { geometry.dispose(); parts.forEach(part => part.dispose()); material.dispose(); }
});

test('真实岛屿至少保留一条安全跨路路线，不能只挑陡坡附近的树导致没有穿越', () => {
  const island = createIsland(new THREE.Scene());
  try {
    const habitats = island.getWoodlandHabitats();
    assert.ok(habitats.crossings.length > 0, '生产森林必须有实际可用的安全穿越，不能只在平地夹具中成立');
    for (const crossing of habitats.crossings) {
      assert.ok(crossing.available());
      for (let i = 0; i < crossing.points.length; i++) {
        const point = crossing.points[i];
        assert.ok(point.y >= island.heightAtRendered(point.x, point.z) - 1e-5);
        if (i) {
          const previous = crossing.points[i - 1], rise = Math.abs(point.y - previous.y);
          assert.ok(rise <= .18 && rise <= Math.hypot(point.x - previous.x, point.z - previous.z) * .7);
        }
      }
    }
    island.setQuality('low');
    assert.ok(habitats.crossings.some(crossing => crossing.available()), '安全配对优先保留低画质仍有的树');
  } finally { island.dispose(); }
});

test('每次进入按独立随机源挑选活动树木和枝条，保留真实安全路线', () => {
  const f = fixture({ count: 80 });
  const snapshot = habitats => ({
    roots: habitats.trees.map(tree => tree.root.toArray()),
    perches: habitats.perches.map(perch => perch.sample(0, new THREE.Vector3()).toArray()),
    crossings: habitats.crossings.map(route => [route.from.root.toArray(), route.to.root.toArray()]),
  });
  try {
    const first = snapshot(create({ ...f, random: seededRandom(18) }));
    const repeat = snapshot(create({ ...f, random: seededRandom(18) }));
    const other = snapshot(create({ ...f, random: seededRandom(93) }));
    assert.deepEqual(first, repeat, '同一随机流可重现，不得读取共享全局随机状态');
    assert.notDeepEqual(first.roots, other.roots, '进入另一场景应换一批活动树木');
    assert.notDeepEqual(first.perches, other.perches, '枝条落点也应变化');
    assert.ok(first.crossings.length && other.crossings.length);
    assert.equal(f.forest.trees.length, 80, '生物随机不改变森林本身');
  } finally { f.dispose(); }
});
