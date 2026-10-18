import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';

function release(island) {
  const resources = new Set();
  island.group.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) resources.add(object.geometry);
    for (const material of [object.material, object.customDepthMaterial].flat()) if (material) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}
const birdsOf = island => island.group.children.filter(object => object.name.startsWith('海鸟-'));
const poseOf = bird => [bird.position.toArray(), bird.quaternion.toArray(),
  ...bird.children.filter(child => child.isGroup).map(wing => wing.quaternion.toArray())];

// Hidden birds have no integrated state: postponing their analytic pose until
// they reappear must preserve the exact same visible flight at that time.
test('夜间和画质隐藏的海鸟不重复改写姿态，重新出现时飞行轨迹完全一致', () => {
  const island = createIsland(new THREE.Scene());
  const reference = createIsland(new THREE.Scene());
  const birds = birdsOf(island), referenceBirds = birdsOf(reference);
  try {
    const day = { daylight: 1, quality: 'high', windSpeed: 9, gust: .2 };
    island.update(10, day);
    const beforeNight = birds.map(poseOf);
    island.update(25, { ...day, daylight: 0 });
    assert.ok(birds.every(bird => !bird.visible));
    assert.deepEqual(birds.map(poseOf), beforeNight, '不可见海鸟应省去无用的姿态计算');

    island.update(30, { ...day, quality: 'low' });
    assert.equal(birds.filter(bird => bird.visible).length, 14);
    assert.deepEqual(birds.slice(14).map(poseOf), beforeNight.slice(14));

    island.update(45, { ...day, quality: 'high' });
    reference.update(45, day);
    assert.deepEqual(birds.map(poseOf), referenceBirds.map(poseOf),
      '恢复高画质时要按当前 elapsed 时间飞行，不能补播或留在隐藏前的位置');
  } finally { release(island); release(reference); }
});

test('海岛退出时释放洞穴/路径/实例/共享材质纹理和深度资源一次，后续更新停止', () => {
  const scene = new THREE.Scene(), island = createIsland(scene);
  const resources = new Set();
  const counts = new Map();
  const meshes = [];
  island.group.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.isInstancedMesh) { resources.add(object); meshes.push(object); }
    for (const material of [object.material, object.customDepthMaterial, object.customDistanceMaterial].flat()) if (material) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  try {
    assert.equal(typeof island.dispose, 'function', '海岛需要显式释放拥有的资源');
    const grass = island.group.getObjectByName('海岛草丛');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    grass.material.onBeforeCompile(shader);
    island.update(10, { daylight: 1 });
    const time = shader.uniforms.uTime.value;
    const instanceCounts = meshes.map(mesh => mesh.count);
    island.dispose();
    island.dispose();
    island.update(100, { daylight: 0, quality: 'low', season: 'winter' });
    island.setQuality('low');
    assert.equal(island.group.parent, null);
    assert.equal(island.group.children.length, 0);
    assert.equal(scene.children.length, 0);
    assert.equal(shader.uniforms.uTime.value, time, '释放后不再更新材质/风时钟');
    assert.deepEqual(meshes.map(mesh => mesh.count), instanceCounts, '释放后不再改写实例数量');
    for (const [resource, count] of counts) assert.equal(count, 1,
      `${resource.type ?? resource.constructor.name} 必须释放且不能因跨网格复用而重复释放`);
  } finally {
    if (island.group.parent) release(island);
  }
});

test('实例草叶尖没有零面积三角形或被绘制的零法线，保留每叶可见曲面', () => {
  const island = createIsland(new THREE.Scene());
  try {
    const grass = island.group.getObjectByName('海岛草丛');
    const { position, normal, aFlex } = grass.geometry.attributes;
    const index = grass.geometry.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const edge = new THREE.Vector3(), other = new THREE.Vector3();
    let tipCount = 0;
    for (let i = 0; i < position.count; i++) if (aFlex.getX(i) > .999) tipCount++;
    assert.equal(tipCount, 16, '每片草叶保留一个相同位置的完整尖端');
    for (let at = 0; at < index.count; at += 3) {
      a.fromBufferAttribute(position, index.getX(at));
      b.fromBufferAttribute(position, index.getX(at + 1));
      c.fromBufferAttribute(position, index.getX(at + 2));
      edge.subVectors(b, a); other.subVectors(c, a);
      assert.ok(edge.cross(other).lengthSq() > 1e-14, '不能上传叶尖重合产生的零面积三角形');
      for (let vertex = 0; vertex < 3; vertex++) {
        const number = index.getX(at + vertex);
        assert.ok(Math.hypot(normal.getX(number), normal.getY(number), normal.getZ(number)) > .999,
          '实际绘制的顶点需要有限单位法线');
      }
    }
    assert.equal(index.count / 3, 16 * 5, '原五个非零面积曲面仍全部保留');
  } finally { island.dispose(); }
});
