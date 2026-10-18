import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCaveFlowerMeadow } from '../src/models/cave-flower-meadow.js';
import { seededRandom } from '../src/terrain.js';
import { createIslandPaths } from '../src/models/island-paths.js';

const module = await import('../src/flower-butterflies.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const day = { season: 'summer', daylight: 1, rain: 0, snow: 0, snowCover: 0, windSpeed: 5 };
const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
function pose(effect, index = 0) {
  const mesh = effect.group.getObjectByName('花丛蝴蝶身体');
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
  return { position: position.clone(), size: scale.x };
}
function anchors(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    available: () => true,
    sample(time, target) { return target.set(10 + index * 2 + Math.sin(time) * .1, 3, 8); },
  }));
}
function create(options = {}) {
  assert.equal(typeof module.createFlowerButterflies, 'function', '需要实际的花丛蝴蝶实现');
  return module.createFlowerButterflies(new THREE.Group(), { anchors: anchors(), heightAt: () => 2, random: seededRandom(73), ...options });
}
function advance(effect, from, to, env = day, camera) {
  for (let step = Math.round(from * 20); step <= Math.round(to * 20); step++) effect.update(step / 20, env, camera);
}

test('蝴蝶飞入、绕花后落到随风移动的花上，停留后再次离开', () => {
  const effect = create();
  try {
    let landed = 0, landedAt = 0, flewAfterRest = false, airborne = false;
    for (let frame = 0; frame < 1800; frame++) {
      const time = frame / 20; effect.update(time, day);
      const body = pose(effect);
      if (body.size < .01) continue;
      airborne ||= body.position.y > 3.6;
      if (Math.abs(body.position.y - 3.04) < .001 && Math.abs(body.position.x - (10 + Math.sin(time) * .1)) < .001) {
        if (!landed) landedAt = time;
        landed++;
      } else if (landed > 20 && time - landedAt > 1) flewAfterRest = true;
      assert.ok(body.position.y > 2.03, '整个飞行过程不能穿入地面');
    }
    assert.ok(airborne, '应该出现飞行');
    assert.ok(landed > 20, '应贴着真实花朵停留至少一秒');
    assert.ok(flewAfterRest, '停留后应继续飞走');
  } finally { effect.dispose(); }
});

test('雨雪、强风、冬季和夜间让蝴蝶逐渐退场，残雪期间不重新出现', () => {
  for (const bad of [{ rain: .8 }, { snow: 1 }, { snowCover: .3 }, { windSpeed: 18 }, { season: 'winter' }, { seasonIndex: 3 }, { daylight: 0 }, { weather: 'blizzard' }]) {
    const effect = create();
    try {
      effect.update(0, day);
      let time = 0;
      while (pose(effect).size < .05 && time < 20) { time += .05; effect.update(time, day); }
      assert.ok(pose(effect).size > .05);
      effect.update(time + .05, { ...day, ...bad });
      assert.ok(pose(effect).size > .01, '天气变化时不能原地消失');
      advance(effect, time + .1, time + 12, { ...day, ...bad });
      assert.ok(pose(effect).size < .001, `恶劣条件下应休眠：${JSON.stringify(bad)}`);
      assert.equal(effect.group.visible, false, '休眠后不应继续绘制空实例');
      advance(effect, time + 12.05, time + 24, { ...day, snowCover: .02 });
      assert.ok(pose(effect).size < .001, '停止降雪但尚有残雪时不能复飞');
    } finally { effect.dispose(); }
  }
});

test('飞行中天气变坏时，翅膀延续当前姿态，不能突然收拢', () => {
  const effect = create();
  try {
    advance(effect, 0, 10.35);
    const body = effect.group.getObjectByName('花丛蝴蝶身体'), wing = effect.group.getObjectByName('花丛蝴蝶右翼');
    const wingAngle = () => {
      body.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
      const inverse = rotation.clone().invert();
      wing.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
      const local = inverse.multiply(rotation);
      return new THREE.Euler().setFromQuaternion(local).z;
    };
    const before = wingAngle(); effect.update(10.4, { ...day, rain: 1 });
    assert.ok(Math.abs(wingAngle() - before) < 1.3, '天气切换不能使翅膀从飞行瞬间折到停栖角度');
  } finally { effect.dispose(); }
});

test('雪融后错开恢复，花朵不可见时不落花', () => {
  let flowersVisible = true;
  const sites = anchors(20).map(anchor => ({ ...anchor, available: () => flowersVisible }));
  const effect = create({ anchors: sites });
  try {
    advance(effect, 0, 4, { ...day, snow: 1 });
    let firstCount = 0, maxCount = 0;
    for (let frame = 81; frame < 600; frame++) {
      effect.update(frame / 20, day);
      const count = Array.from({ length: effect.group.getObjectByName('花丛蝴蝶身体').count }, (_, i) => pose(effect, i).size).filter(size => size > .01).length;
      if (!firstCount && count) firstCount = count;
      maxCount = Math.max(maxCount, count);
    }
    assert.equal(firstCount, 1, '恢复时间应错开');
    assert.ok(maxCount > firstCount);
    flowersVisible = false;
    advance(effect, 30, 45);
    for (let i = 0; i < effect.group.getObjectByName('花丛蝴蝶身体').count; i++) assert.ok(pose(effect, i).size < .001);
  } finally { effect.dispose(); }
});

test('画质限制数量，远处降低姿态更新，隐藏和释放后停止写入实例', () => {
  const effect = create({ anchors: anchors(24) });
  const body = effect.group.getObjectByName('花丛蝴蝶身体');
  try {
    const full = body.count;
    effect.setQuality('low'); assert.ok(body.count > 0 && body.count < full);
    effect.setQuality('high'); assert.equal(body.count, full);
    advance(effect, 0, 15);
    effect.group.traverse(mesh => {
      if (!mesh.isInstancedMesh) return;
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix);
        assert.ok(matrix.determinant() >= 0, '实例不能使用负缩放镜像翅膀，否则法线和剔除会出错');
      }
    });
    const camera = new THREE.PerspectiveCamera(); camera.position.set(150, 30, 8); camera.lookAt(30, 3, 8);
    effect.update(15.05, day, camera);
    const version = body.instanceMatrix.version;
    effect.update(15.06, day, camera);
    assert.equal(body.instanceMatrix.version, version, '远处不应每帧更新姿态');
    camera.position.set(1500, 20, 8); camera.lookAt(30, 3, 8); effect.update(16, day, camera);
    assert.equal(effect.group.visible, false);
    const hiddenVersion = body.instanceMatrix.version;
    advance(effect, 16.05, 17, day, camera);
    assert.equal(body.instanceMatrix.version, hiddenVersion);
    camera.position.set(10, 8, 25); camera.lookAt(16, 3, 8); effect.update(17.05, day, camera);
    assert.equal(effect.group.visible, true);
    assert.ok(body.instanceMatrix.version > hiddenVersion);
    const resources = new Set(); effect.group.traverse(object => { if (object.isInstancedMesh) resources.add(object); if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); });
    const released = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
    effect.dispose(); effect.dispose();
    const disposedVersion = body.instanceMatrix.version; effect.update(18, day); effect.setQuality('low');
    assert.equal(body.instanceMatrix.version, disposedVersion);
    assert.ok([...released.values()].every(count => count === 1), '共享资源只释放一次');
  } finally { effect.dispose(); }
});

test('独立创建的蝴蝶互不影响，没有花朵时保持空场景', () => {
  const first = create(), second = create(), empty = create({ anchors: [] });
  try {
    second.update(0, day); const before = pose(second);
    advance(first, 0, 15);
    assert.deepEqual(pose(second), before);
    advance(empty, 0, 20);
    assert.equal(empty.group.getObjectByName('花丛蝴蝶身体').count, 0);
  } finally { first.dispose(); second.dispose(); empty.dispose(); }
});

test('洞前落点来自实际花心并跟随花瓣风摆，冬雪时落点不可用', () => {
  const meadow = createCaveFlowerMeadow(new THREE.Group(), { heightAt: () => 10, distanceAt: () => 3 });
  try {
    assert.equal(typeof meadow.getFlowerAnchors, 'function', '花丛应提供可采样的真实落点');
    const sites = meadow.getFlowerAnchors(); assert.ok(sites.length > 10);
    const petals = meadow.group.getObjectByName('洞前缤纷花瓣');
    meadow.update(0, { ...day, wind: 0 });
    const root = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    petals.getMatrixAt(0, matrix); matrix.decompose(root, q, s);
    const sample = sites[0].sample(0, new THREE.Vector3());
    const {position,aPetalTexture}=petals.geometry.attributes;let heartTop=-Infinity;
    for(let i=0;i<position.count;i++)if(aPetalTexture.getX(i)<.5)heartTop=Math.max(heartTop,position.getY(i));
    const surface=new THREE.Vector3(0,heartTop,0).applyMatrix4(matrix);
    // 水平位置还包含风摆位移；高度应来自同一倾斜实例的花心顶点。
    assert.ok(Math.abs(sample.y-surface.y)<.002, '落点应跟随倾斜花茎上的实际花心上表面');
    const before = sample.clone(); meadow.update(2, { ...day, wind: .4 }); sites[0].sample(2, sample);
    assert.ok(sample.distanceTo(before) > .01, '静止蝴蝶也要随花朵移动');
    meadow.update(3, { ...day, snowCover: .5 }); assert.equal(sites[0].available(), false);
    meadow.update(4, day); assert.equal(sites[0].available(), true);
  } finally { meadow.dispose(); }
});

test('路旁落点对应真实花心，画质减少或秋冬隐藏花朵时不落在空处', () => {
  const windUniforms = { uTime: { value: 0 }, uWindDirection: { value: new THREE.Vector2() },
    uPlantAmplitudes: { value: new THREE.Vector3() }, uLeafFlutter: { value: 0 } };
  const paths = createIslandPaths(new THREE.Group(), { windUniforms });
  try {
    const flowers = paths.group.getObjectByName('路旁细小野花');
    const sites = paths.getFlowerAnchors(); assert.ok(sites.length > 10);
    paths.update(0, { ...day, season: 'spring', quality: 'high', wind: 0 });
    const sampled = sites[0].sample(0, new THREE.Vector3());
    flowers.getMatrixAt(0, matrix);
    const local = sampled.clone().applyMatrix4(matrix.clone().invert());
    const geometry = flowers.geometry, points = geometry.attributes.position, colors = geometry.attributes.color;
    let nearest = Infinity;
    const gold = new THREE.Color('#d4ac42'), vertex = new THREE.Vector3();
    for (let index = 0; index < points.count; index++) {
      if (Math.abs(colors.getX(index) - gold.r) > .001 || Math.abs(colors.getY(index) - gold.g) > .001) continue;
      vertex.fromBufferAttribute(points, index); nearest = Math.min(nearest, vertex.distanceTo(local));
    }
    assert.ok(nearest < .015, '落点必须位于实际花心上表面附近');
    paths.update(1, { ...day, quality: 'low' });
    const available = sites.filter(site => site.available());
    assert.ok(available.length > 0 && available.length < sites.length, '被画质裁掉的花不能成为落点');
    paths.update(2, { ...day, season: 'winter' });
    assert.ok(sites.every(site => !site.available()));
  } finally { paths.dispose(); }
});

test('蝴蝶背向镜头时隐藏并停止实例写入，转回立即显示当前活动而不补播', () => {
  const effect = create(), reference = create(), camera = new THREE.PerspectiveCamera(70, 1, .1, 500);
  camera.position.set(10, 7, 25);
  try {
    advance(effect, 0, 12); advance(reference, 0, 12);
    const body = effect.group.getObjectByName('花丛蝴蝶身体'), version = body.instanceMatrix.version;
    camera.lookAt(10, 7, 45); effect.update(12.05, day, camera); reference.update(12.05, day);
    assert.ok(!effect.group.visible); assert.equal(body.instanceMatrix.version, version);
    advance(effect, 12.1, 14, day, camera); advance(reference, 12.1, 14);
    assert.equal(body.instanceMatrix.version, version, '视线外只推进活动，不上传实例');
    camera.lookAt(10, 3, 8); effect.update(14.05, day, camera); reference.update(14.05, day);
    assert.ok(effect.group.visible); assert.ok(body.instanceMatrix.version > version);
    assert.deepEqual(pose(effect), pose(reference), '回到视线时直接使用连续推进后的当前状态');
  } finally { effect.dispose(); reference.dispose(); }
});
