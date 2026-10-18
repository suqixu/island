import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getIslandPathLayout } from '../src/path-layout.js';
import { CAVE_LAYOUT, isCaveReserved } from '../src/cave-layout.js';
import { isLighthouseReserved } from '../src/lighthouse-layout.js';

const lampsModule = await import('../src/models/path-lamps.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function create(options = {}) {
  assert.equal(typeof lampsModule?.createPathLamps, 'function', '上山路需要可贴真实地面的路灯模块');
  const parent = new THREE.Group();
  const heightAt = options.heightAt ?? (() => 14);
  const routes = [{ id: 'mountain-fixture', kind: 'mountain', width: 1.1,
    points: [{ x: 58, z: -60 }, { x: 130, z: -60 }] },
  { id: 'coastal-fixture', kind: 'coastal', width: 2.2,
    points: [{ x: 58, z: -45 }, { x: 130, z: -45 }] }];
  const layout = options.layout ?? { routes };
  const lamps = lampsModule.createPathLamps(parent, { heightAt, layout });
  const meshes = [], lights = [];
  lamps.group.traverse(object => {
    if (object.isMesh) meshes.push(object);
    if (object.isPointLight) lights.push(object);
  });
  return { parent, lamps, meshes, lights, heightAt, layout };
}

function instanceVertices(mesh, index) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  matrix.premultiply(mesh.matrixWorld);
  const p = mesh.geometry.attributes.position;
  return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix));
}

// Fails if lamps are put in the centre of the path, on the coastal loop, or
// repeated as separate meshes instead of a small set of real instance batches.
test('路灯沿山径交错落在通道外，实体比例与实例批次数适合矮杆暖灯', () => {
  const { lamps, meshes } = create();
  try {
    const anchors = lamps.group.userData.lampAnchors;
    assert.ok(anchors.length >= 5, '七十米山路应有持续的路灯引导');
    assert.ok(anchors.every(anchor => anchor.routeId === 'mountain-fixture'));
    assert.ok(new Set(anchors.map(anchor => Math.sign(anchor.z + 60))).size === 2, '直路两侧应交错布置');
    for (let i = 1; i < anchors.length; i++) {
      const spacing = Math.abs(anchors[i].x - anchors[i - 1].x);
      assert.ok(spacing >= 9 && spacing <= 13, '灯距应适合步行山路而非挤成灯墙');
    }
    assert.ok(meshes.length <= 6 && meshes.every(mesh => mesh.isInstancedMesh));
    lamps.group.updateWorldMatrix(true, true);
    for (const mesh of meshes) {
      assert.equal(mesh.count, anchors.length);
      assert.ok(mesh.material.depthTest, '灯罩与灯芯应受实体遮挡');
      for (let i = 0; i < mesh.count; i++) for (const point of instanceVertices(mesh, i)) {
        assert.ok(Math.abs(point.z + 60) - .55 >= .30, '真实灯体不能侵入一米一的道路及其缓冲');
      }
    }
    const stone = meshes.find(mesh => mesh.userData.role === 'foundation');
    assert.ok(stone, '灯脚应有实体石基');
    for (let i = 0; i < anchors.length; i++) {
      const bounds = new THREE.Box3();
      for (const mesh of meshes) for (const point of instanceVertices(mesh, i)) bounds.expandByPoint(point);
      assert.ok(bounds.max.y - 14 >= 1.9 && bounds.max.y - 14 <= 2.25, '复古灯杆应维持约两米的矮杆比例');
      assert.ok(bounds.max.x - bounds.min.x < .65, '石脚与灯罩都保持纤细');
    }
  } finally { lamps.dispose(); }
});

// Fails if a flat elevated foot leaves daylight beneath its downhill edge.
test('横坡石脚底面埋入实地且上缘露出，灯杆保持竖直', () => {
  const heightAt = (x, z) => 14 + .19 * (x - 60) - .27 * (z + 60);
  const { lamps, meshes } = create({ heightAt });
  try {
    lamps.group.updateWorldMatrix(true, true);
    const feet = meshes.find(mesh => mesh.userData.role === 'foundation');
    const poles = meshes.find(mesh => mesh.userData.role === 'pole');
    assert.ok(feet && poles);
    for (let index = 0; index < feet.count; index++) {
      const points = instanceVertices(feet, index), bottom = Math.min(...points.map(p => p.y));
      const top = Math.max(...points.map(p => p.y));
      for (const p of points.filter(p => Math.abs(p.y - bottom) < .00001)) {
        assert.ok(p.y - heightAt(p.x, p.z) <= .001, '石基底不能悬在横坡上');
        assert.ok(p.y - heightAt(p.x, p.z) >= -.35, '矮灯石脚不应变成巨大地基');
      }
      for (const p of points.filter(p => Math.abs(p.y - top) < .00001)) {
        assert.ok(p.y > heightAt(p.x, p.z), '局部石脚顶部应露出山坡');
      }
      const matrix = new THREE.Matrix4(); poles.getMatrixAt(index, matrix);
      assert.ok(Math.abs(matrix.elements[4]) < 1e-8 && Math.abs(matrix.elements[6]) < 1e-8, '灯杆不能随横坡歪倒');
    }
  } finally { lamps.dispose(); }
});

// Fails if selected lamps occupy a junction, a reserved entrance, or a steep
// outside shoulder missed by the simple planar fixture above.
test('生产山路选位避开洞口和灯塔，所有实体脚点贴真实地面并给真实道缘留足空间', () => {
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const { lamps, meshes } = create({ layout, heightAt: layout.heightAtRendered });
  try {
    const anchors = lamps.group.userData.lampAnchors;
    assert.ok(anchors.length >= 20 && anchors.length <= 45, '山路路网应有稀疏但连续的夜间引导');
    assert.ok(anchors.some(anchor => anchor.kind === 'cave'));
    for (const id of ['mountain-ascent', 'ridge-west', 'ridge-east']) assert.ok(anchors.some(anchor => anchor.routeId === id));
    for (const anchor of anchors) {
      assert.ok(!isLighthouseReserved(anchor.x, anchor.z, 1.5));
      assert.ok(!isCaveReserved(anchor.x, anchor.z));
      assert.ok(anchor.y > .6, '灯脚不能落在海水中');
    }
    lamps.group.updateWorldMatrix(true, true);
    for (const mesh of meshes) for (let index = 0; index < mesh.count; index++) {
      const vertices = instanceVertices(mesh, index);
      for (const p of vertices) assert.ok(layout.distanceAt(p.x, p.z) >= .34, '实际曲路外沿仍须保留三十厘米余量');
      if (mesh.userData.role !== 'foundation') continue;
      const bottom = Math.min(...vertices.map(p => p.y));
      const ring = vertices.filter(p => Math.abs(p.y - bottom) < .00001 && Math.hypot(p.x - anchors[index].x, p.z - anchors[index].z) > .1);
      for (const p of ring) assert.ok(p.y <= layout.heightAtRendered(p.x, p.z) + .001, '底座不能浮在生产地形上');
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (a.distanceTo(b) > .2) continue;
        for (let t = 0; t <= 1; t += .1) {
          const p = a.clone().lerp(b, t);
          assert.ok(p.y <= layout.heightAtRendered(p.x, p.z) + .001, '石基底边跨越地形三角面时也不能悬空');
        }
      }
    }
  } finally { lamps.dispose(); }
});

// Fails if every fixture emits a PointLight, daytime still glows, or quality
// removes the inexpensive physical lanterns along the unlit portions of trail.
test('全部灯芯平滑随昼夜发光，照路点光仅用画质允许的有限灯池', () => {
  const { lamps, meshes, lights } = create();
  try {
    assert.ok(lights.length > 0 && lights.length <= 4);
    const cores = meshes.find(mesh => mesh.userData.role === 'glow');
    assert.ok(cores && cores.count >= 5);
    for (const light of lights) {
      assert.equal(light.castShadow, false);
      assert.ok(light.distance >= 9 && light.distance <= 12);
      assert.ok(light.color.r > light.color.g && light.color.g > light.color.b);
    }
    lamps.update(0, { daylight: 1 });
    assert.equal(cores.material.emissiveIntensity, 0);
    assert.ok(lights.every(light => !light.visible && light.intensity === 0));
    lamps.update(1, { daylight: .2 }); const dusk = cores.material.emissiveIntensity;
    lamps.update(2, { daylight: 0 }); const night = cores.material.emissiveIntensity;
    assert.ok(dusk > 0 && dusk < night);
    for (const [quality, budget] of [['low', 2], ['medium', 3], ['high', 4]]) {
      lamps.setQuality(quality); lamps.update(3, { daylight: 0, quality });
      assert.equal(lights.filter(light => light.visible && light.intensity > 0).length, budget);
      assert.equal(cores.material.emissiveIntensity, night);
      assert.ok(meshes.every(mesh => mesh.visible));
    }
    lamps.update(4, { daylight: NaN });
    assert.equal(cores.material.emissiveIntensity, 0);
  } finally { lamps.dispose(); }
});

// Fails if the pool follows the camera continuously in space instead of
// choosing fixed, visible lantern positions, or keeps lighting distant lamps.
test('照路灯池按相机选择附近的实际灯位，移动相机后仍固定在灯芯上', () => {
  const { lamps, lights } = create();
  try {
    const camera = new THREE.PerspectiveCamera();
    const anchors = lamps.group.userData.lampAnchors;
    for (const x of [59, 129]) {
      camera.position.set(x, 16, -60); lamps.update(x, { daylight: 0 }, camera);
      const expected = anchors.map((anchor, index) => ({ index,
        distance: new THREE.Vector3(anchor.lightPosition.x, anchor.lightPosition.y, anchor.lightPosition.z).distanceTo(camera.position) }))
        .sort((a, b) => a.distance - b.distance).slice(0, 4).map(item => item.index).sort((a, b) => a - b);
      const selected = lights.filter(light => light.visible).map(light => light.userData.lampIndex).sort((a, b) => a - b);
      assert.deepEqual(selected, expected);
      for (const light of lights.filter(light => light.visible)) {
        const p = anchors[light.userData.lampIndex].lightPosition;
        assert.ok(light.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-7);
      }
    }
  } finally { lamps.dispose(); }
});

// Fails if animation rebuilds matrices/geometry/material or dispose leaks any
// owned resource, runs twice, or lets a later update revive point lights.
test('昼夜与画质更新复用全部实体，重复释放不会重放资源销毁或复活灯光', () => {
  const { parent, lamps, meshes, lights } = create();
  const resources = new Set(meshes.flatMap(mesh => [mesh.geometry, mesh.material]));
  const snapshots = meshes.map(mesh => ({ geometry: mesh.geometry, material: mesh.material,
    matrix: Array.from(mesh.instanceMatrix.array) }));
  const disposals = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
  for (let i = 0; i < 24; i++) lamps.update(i, { daylight: i % 2, quality: i % 3 ? 'low' : 'high' });
  meshes.forEach((mesh, i) => {
    assert.equal(mesh.geometry, snapshots[i].geometry); assert.equal(mesh.material, snapshots[i].material);
    assert.deepEqual(Array.from(mesh.instanceMatrix.array), snapshots[i].matrix);
  });
  lamps.dispose(); lamps.dispose(); lamps.update(30, { daylight: 0 }); lamps.setQuality('high');
  assert.equal(parent.children.length, 0); assert.equal(lamps.group.children.length, 0);
  assert.ok([...disposals.values()].every(count => count === 1));
  assert.ok(lights.every(light => !light.visible && light.intensity === 0));
});

test('危险横坡或水面没有强行架灯，空路网可以更新与释放', () => {
  for (const heightAt of [() => -.3, (x, z) => 14 + 2.5 * (z + 60)]) {
    const { lamps } = create({ heightAt });
    assert.equal(lamps.group.userData.lampAnchors.length, 0, '陡坡与水面宁可留空也不能架悬空路灯');
    lamps.update(0, { daylight: 0 }); lamps.dispose(); lamps.dispose();
  }
  const { lamps } = create({ layout: { routes: [] } });
  assert.equal(lamps.group.userData.lampAnchors.length, 0);
  lamps.update(1, { daylight: 0 }); lamps.dispose();
});

// The real camera and PointLights expose wasted work without production-only counters.
test('白天或关闭全部灯光时不查询相机、不改写灯位，恢复夜间后选最近固定灯芯', () => {
  const { lamps, lights } = create();
  const camera = new THREE.PerspectiveCamera();camera.position.set(59,16,-60);
  const getPosition=camera.getWorldPosition;let queries=0;
  camera.getWorldPosition=function(target){queries++;return getPosition.call(this,target);};
  let writes=0;
  for(const light of lights){const set=light.position.set;light.position.set=function(...args){writes++;return set.apply(this,args);};}
  try{
    lamps.update(0,{daylight:1},camera);
    lamps.update(1,{daylight:0,artificialLightsOff:true},camera);
    assert.equal(queries,0,'不发光时无需查询或选择附近灯位');assert.equal(writes,0);
    assert.ok(lights.every(light=>!light.visible&&light.intensity===0));
    lamps.update(2,{daylight:0},camera);assert.ok(lights.every(light=>light.visible));
    const selected=lights.map(light=>light.userData.lampIndex);
    lamps.update(3,{daylight:1},camera);camera.position.x=129;
    lamps.update(4,{daylight:0,artificialLightsOff:true},camera);
    assert.ok(lights.every(light=>!light.visible&&light.intensity===0));
    lamps.update(5,{daylight:0},camera);
    assert.notDeepEqual(lights.map(light=>light.userData.lampIndex),selected,'再次入夜必须采用当前相机附近灯位');
  }finally{lamps.dispose();}
});

test('静止夜景复用选灯与位置，亮度继续变化，移动父相机与改变画质及时更新灯池', () => {
  const {lamps,lights}=create(),camera=new THREE.PerspectiveCamera(),parent=new THREE.Group();parent.add(camera);camera.position.set(59,16,-60);
  const anchors=lamps.group.userData.lampAnchors;
  let reads=0,writes=0;
  for(const anchor of anchors){const p=anchor.lightPosition,x=p.x;Object.defineProperty(p,'x',{get(){reads++;return x;}});}
  for(const light of lights){const set=light.position.set;light.position.set=function(...args){writes++;return set.apply(this,args);};}
  try{
    lamps.update(0,{daylight:0},camera);const selected=lights.map(light=>light.userData.lampIndex),beforeReads=reads,beforeWrites=writes,night=lights[0].intensity;
    for(let i=1;i<=100;i++)lamps.update(i,{daylight:.2},camera);
    assert.equal(reads,beforeReads,'相机未移动时不重新扫描全部灯位');assert.equal(writes,beforeWrites,'固定灯芯位置不必逐帧改写');
    assert.ok(lights[0].intensity>0&&lights[0].intensity<night,'缓存选灯不能冻结日夜亮度');
    parent.position.x=70;lamps.update(101,{daylight:0},camera);
    assert.notDeepEqual(lights.map(light=>light.userData.lampIndex),selected,'相机父节点的移动也需重选');
    lamps.setQuality('low');lamps.update(102,{daylight:0},camera);assert.equal(lights.filter(light=>light.visible).length,2);
    lamps.setQuality('high');lamps.update(103,{daylight:0},camera);assert.equal(lights.filter(light=>light.visible).length,4);
    lamps.update(104,{daylight:0});const noCamera=lights.map(light=>light.userData.lampIndex);
    lamps.update(105,{daylight:0},camera);assert.notDeepEqual(lights.map(light=>light.userData.lampIndex),noCamera,'有无相机切换不能沿用错误选择');
  }finally{lamps.dispose();}
});
