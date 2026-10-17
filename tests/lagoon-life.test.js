import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { heightAt } from '../src/terrain.js';
import { getIslandPathLayout } from '../src/path-layout.js';

const module = await import('../src/lagoon-life.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function create(scene, options) { assert.ok(module, '需要可渲染的常驻泻湖生态模块'); return module.createLagoonLife(scene, options); }
const named = (life, name) => life.group.children.find(mesh => mesh.name === name);
const bodies = life => life.group.children.filter(mesh => mesh.userData.role === 'body');
const counts = life => Object.fromEntries(['fish', 'turtle', 'crab', 'lobster'].map(kind => [kind,
  bodies(life).filter(mesh => mesh.userData.kind === kind).reduce((sum, mesh) => sum + mesh.count, 0)]));
function instances(life) {
  const result = [], matrix = new THREE.Matrix4();
  for (const mesh of bodies(life)) for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix); result.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());
  }
  return result;
}

test('四种居民夜间暴雨和低画质仍常驻，真实时间持续游动', () => {
  const life = create(new THREE.Scene(), { heightAt, seed: 42 });
  try {
    life.update(0, { daylight: 1 });
    assert.deepEqual(counts(life), { fish: 42, turtle: 3, crab: 8, lobster: 5 });
    const before = instances(life);
    life.update(8, { daylight: 0, storm: 1, rain: 1 });
    assert.deepEqual(counts(life), { fish: 42, turtle: 3, crab: 8, lobster: 5 });
    assert.notDeepEqual(instances(life), before);
    life.setQuality('low'); life.update(9, { daylight: 0, storm: 1 });
    assert.deepEqual(counts(life), { fish: 24, turtle: 2, crab: 4, lobster: 3 });
    life.setQuality('medium'); life.update(10, {}); assert.equal(counts(life).fish, 33);
  } finally { life.dispose(); }
});

test('身体/鳍/爪程序几何合并成少量实例批次，无逐动物材质和逐帧资源创建', () => {
  const life = create(new THREE.Scene(), { heightAt, seed: 42 });
  try {
    life.update(0, {});
    assert.ok(life.group.children.length <= 18, '四物种应控制绘制批次');
    assert.ok(life.group.children.every(mesh => mesh.isInstancedMesh));
    const resources = new Set(life.group.children.flatMap(mesh => [mesh.geometry, mesh.material]));
    const materials = new Set(life.group.children.map(mesh => mesh.material));
    assert.ok(materials.size <= 3);
    for (const material of materials) assert.ok(!material.transparent && material.emissiveIntensity <= .2);
    for (let t = 1; t <= 10; t++) life.update(t, {});
    assert.deepEqual(new Set(life.group.children.flatMap(mesh => [mesh.geometry, mesh.material])), resources);
    assert.ok(named(life, '海龟前鳍').count === 6 && named(life, '海龟后鳍').count === 6);
    assert.ok(named(life, '沙蟹步足').count >= 64 && named(life, '龙虾触须').count === 10);
  } finally { life.dispose(); }
});

test('实际游泳顶点含龟壳与鳍留在海面之下、海床之上，壳和鱼具有可辨尺度', () => {
  const life = create(new THREE.Scene(), { heightAt, seed: 42 });
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  try {
    for (const time of [0, 5, 20, 59, 135]) {
      life.update(time, {});
      for (const mesh of life.group.children.filter(mesh => ['fish', 'turtle'].includes(mesh.userData.kind))) {
        const vertices = mesh.geometry.attributes.position;
        for (let member = 0; member < mesh.count; member++) {
          mesh.getMatrixAt(member, matrix);
          assert.ok(matrix.elements.every(Number.isFinite));
          for (let index = 0; index < vertices.count; index++) {
            point.fromBufferAttribute(vertices, index).applyMatrix4(matrix);
            assert.ok(point.y < -.05, `${mesh.name}真实顶点不能露出水面`);
            assert.ok(point.y > heightAt(point.x, point.z) + .055, `${mesh.name}真实顶点不可穿床`);
          }
        }
      }
    }
    for (const mesh of bodies(life)) {
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
      if (mesh.userData.kind === 'turtle') assert.ok(size.z > .8 && size.y > .22, '龟壳应有厚度且头尾分明');
      if (mesh.userData.kind === 'fish') assert.ok(size.z > .65 && size.y > .2);
    }
  } finally { life.dispose(); }
});

test('螃蟹和龙虾身体不穿床，腿末端根据真实海床落脚并以交替步态抬脚', () => {
  const bed = (x, z) => heightAt(x, z) + Math.sin(x * .7 + z * .3) * .022;
  const life = create(new THREE.Scene(), { heightAt: bed, seed: 77 });
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  try {
    let grounded = 0, lifted = 0;
    for (const time of [0, 3, 12, 28, 71]) {
      life.update(time, {});
      for (const mesh of bodies(life).filter(mesh => ['crab', 'lobster'].includes(mesh.userData.kind))) {
        const vertices = mesh.geometry.attributes.position;
        for (let member = 0; member < mesh.count; member++) {
          mesh.getMatrixAt(member, matrix);
          for (let index = 0; index < vertices.count; index++) {
            point.fromBufferAttribute(vertices, index).applyMatrix4(matrix);
            assert.ok(point.y > bed(point.x, point.z) - .005, `${mesh.name}甲壳不能嵌入地形`);
          }
        }
      }
      for (const name of ['沙蟹步足', '龙虾步足']) {
        const legs = named(life, name);
        for (let member = 1; member < legs.count; member += 2) {
          legs.getMatrixAt(member, matrix); point.set(0, -.5, 0).applyMatrix4(matrix);
          const gap = point.y - bed(point.x, point.z);
          assert.ok(gap >= .002 && gap < .05, '脚尖要贴床或自然抬步');
          if (gap < .012) grounded++; else lifted++;
        }
      }
    }
    assert.ok(grounded > 0 && lifted > 0);
  } finally { life.dispose(); }
});

test('共享资源释放一次，重复销毁安全，全部陆地不渲染居民', () => {
  const scene = new THREE.Scene(), life = create(scene, { heightAt, seed: 42 });
  const resources = new Set(life.group.children.flatMap(mesh => [mesh.geometry, mesh.material]));
  const disposals = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
  life.dispose(); life.dispose(); life.update(9, {});
  assert.equal(scene.children.length, 0); assert.equal(life.group.children.length, 0);
  assert.ok([...disposals.values()].every(count => count === 1));
  const land = create(new THREE.Scene(), { heightAt: () => 10 }); land.update(3, {});
  assert.ok(land.group.children.every(mesh => mesh.count === 0)); land.dispose();
});

test('左右鳍和钳都使用可正确渲染的正行列式实例矩阵', () => {
  const life = create(new THREE.Scene(), { heightAt, seed: 42 }), matrix = new THREE.Matrix4();
  try {
    for (const time of [0, 2, 7, 14]) {
      life.update(time, {});
      for (const mesh of life.group.children) for (let member = 0; member < mesh.count; member++) {
        mesh.getMatrixAt(member, matrix);
        assert.ok(matrix.determinant() > 0, `${mesh.name}不可依赖Three不支持的负缩放实例`);
      }
    }
  } finally { life.dispose(); }
});


test('五个种子在最终三角网格海床上保持全部真实模型顶点安全和落脚', () => {
  const bed = getIslandPathLayout({ heightAt }).heightAtRendered;
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (const seed of [0, 42, 77, .42, 2147483646]) {
    const life = create(new THREE.Scene(), { heightAt: bed, seed });
    try {
      for (const time of [0, 19, 58, 120, 237]) {
        life.update(time, {});
        assert.deepEqual(counts(life), { fish: 42, turtle: 3, crab: 8, lobster: 5 });
        for (const mesh of life.group.children) {
          const vertices = mesh.geometry.attributes.position;
          for (let member = 0; member < mesh.count; member++) {
            mesh.getMatrixAt(member, matrix);
            if (mesh.userData.role === 'leg') {
              if (member % 2 === 1) {
                point.set(0, -.5, 0).applyMatrix4(matrix);
                assert.ok(point.y > bed(point.x, point.z) + .002 && point.y < bed(point.x, point.z) + .05);
              }
              continue;
            }
            for (let i = 0; i < vertices.count; i++) {
              point.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
              assert.ok(point.y > bed(point.x, point.z) + .007, `${seed}/${time}/${mesh.name}不可穿最终地形`);
              if (['fish', 'turtle'].includes(mesh.userData.kind)) assert.ok(point.y < -.05);
            }
          }
        }
      }
    } finally { life.dispose(); }
  }
});

test('镜头背对泻湖时停止地形采样和实例上传，转回后按当前时间恢复完整姿态', () => {
  let samples = 0;
  const bed = (x, z) => { samples++; return heightAt(x, z); };
  const life = create(new THREE.Scene(), { heightAt: bed, seed: 42 });
  const reference = create(new THREE.Scene(), { heightAt, seed: 42 });
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, .5, 65000);
  camera.position.set(50, 38, 148); camera.lookAt(50, -1, 75); camera.updateMatrixWorld();
  try {
    samples = 0; life.update(12, {}, camera);
    assert.equal(life.group.visible, true); assert.ok(samples > 0);
    const matrices = life.group.children.map(mesh => Array.from(mesh.instanceMatrix.array));
    const versions = life.group.children.map(mesh => mesh.instanceMatrix.version);
    camera.lookAt(50, 38, 400); camera.updateMatrixWorld();
    samples = 0; life.update(30, {}, camera);
    assert.equal(samples, 0, '整个活动范围在镜头背后时不应再计算海床和步足');
    assert.equal(life.group.visible, false);
    assert.deepEqual(life.group.children.map(mesh => Array.from(mesh.instanceMatrix.array)), matrices);
    assert.deepEqual(life.group.children.map(mesh => mesh.instanceMatrix.version), versions);
    life.setQuality('low'); reference.setQuality('low');
    camera.lookAt(50, -1, 75); camera.updateMatrixWorld();
    life.update(47, {}, camera); reference.update(47, {});
    assert.equal(life.group.visible, true);
    for (let i = 0; i < life.group.children.length; i++) {
      const actual = life.group.children[i], expected = reference.group.children[i];
      assert.equal(actual.count, expected.count);
      assert.deepEqual(actual.instanceMatrix.array.slice(0, actual.count * 16),
        expected.instanceMatrix.array.slice(0, expected.count * 16), '恢复后应直接处于当前轨迹，不补播旧动作');
    }
    // A camera inside the habitat or very near its edge must never cull limbs.
    camera.position.set(50, -1, 75); camera.lookAt(50, -1, 100); camera.updateMatrixWorld();
    life.update(50, {}, camera); assert.equal(life.group.visible, true);
    // Also respect a transformed parent rather than testing local bounds as world coordinates.
    life.group.position.x = 500;
    camera.position.set(550, 38, 148); camera.lookAt(550, -1, 75); camera.updateMatrixWorld();
    life.update(51, {}, camera); assert.equal(life.group.visible, true);
  } finally { life.dispose(); reference.dispose(); }
});
