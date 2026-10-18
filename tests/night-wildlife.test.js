import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { seededRandom } from '../src/terrain.js';

const api = await import('../src/night-wildlife.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const night = { season: 'summer', seasonIndex: 1, daylight: 0, hour: 22, temperature: 24, rain: 0, windSpeed: 3, snow: 0, snowCover: 0 };
const habitat = { available: () => true, sample: (time, target) => target.set(10, 2, 8) };
const lamp = { isLit: env => env.lampsOn !== false, sample: (time, target) => target.set(12, 5, 8) };
function create(options = {}) {
  assert.equal(typeof api.createNightWildlife, 'function', '需要真实夏夜居民模块');
  return api.createNightWildlife(new THREE.Group(), { habitats: [habitat], lamps: [lamp], heightAt: () => 2, random: seededRandom(71), ...options });
}
function advance(effect, from, to, env = night, camera) {
  for (let step = Math.round(from * 20); step <= Math.round(to * 20); step++) effect.update(step / 20, env, camera);
}
function brightness(effect) { return [...effect.group.getObjectByName('林缘萤火虫').geometry.getAttribute('aBrightness').array]; }
function pose(effect, index = 0) {
  const mesh = effect.group.getObjectByName('亭灯飞蛾身体'), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale); return { position, size: scale.x };
}
function visibleMoths(effect) {
  const body = effect.group.getObjectByName('亭灯飞蛾身体');
  return Array.from({ length: body.count }, (_, index) => pose(effect, index)).filter(item => item.size > .01);
}

test('夏夜林缘低空出现错峰闪烁的小群萤火虫，渐入渐出且不产生逐只光源', () => {
  const effect = create({ lamps: [] });
  try {
    assert.ok(!effect.group.visible);
    advance(effect, 0, 10);
    assert.ok(effect.group.visible);
    const points = effect.group.getObjectByName('林缘萤火虫'), levels = brightness(effect);
    assert.ok(levels.some(value => value > .1)); assert.ok(levels.some(value => value < .01));
    assert.ok(new Set(levels.map(value => Math.round(value * 100))).size > 8, '闪烁不能同步');
    const position = points.geometry.getAttribute('position');
    for (let index = 0; index < points.geometry.drawRange.count; index++) {
      assert.ok(position.getY(index) >= 2.12 && position.getY(index) < 4, '萤火虫贴近草间，不能穿地面');
      assert.ok(Math.hypot(position.getX(index) - 10, position.getZ(index) - 8) < 6, '活动围绕真实林缘');
    }
    assert.ok(points.material.isShaderMaterial && points.material.vertexShader.includes('aBrightness'));
    const previous = brightness(effect); effect.update(10.05, { ...night, daylight: 1, hour: 12 });
    assert.ok(effect.group.visible, '夜转昼应逐渐退场');
    assert.ok(brightness(effect).some((value, index) => value > 0 && previous[index] > 0));
    advance(effect, 10.1, 20, { ...night, daylight: 1, hour: 12 }); assert.ok(!effect.group.visible);
    effect.group.traverse(object => { assert.ok(object.userData.nightWildlife); assert.ok(!object.isLight); });
  } finally { effect.dispose(); }
});

test('白天、冬季、低温、雨雪强风和残雪不出现，夏夜天气恢复后重新渐入', () => {
  for (const change of [{ daylight: 1, hour: 12 }, { hour: 12 }, { seasonIndex: 3 }, { season: 'winter', seasonIndex: undefined }, { temperature: 8 }, { rain: .6 }, { windSpeed: 18 }, { storm: .4 }, { snow: .01, snowCover: 0 }, { snowCover: .0001 }, { weather: 'blizzard' }]) {
    const effect = create();
    try {
      advance(effect, 0, 20, { ...night, ...change });
      assert.ok(!effect.group.visible, JSON.stringify(change));
      assert.ok(brightness(effect).every(value => value === 0));
      advance(effect, 20.05, 32); assert.ok(brightness(effect).some(value => value > .05), `恢复：${JSON.stringify(change)}`);
      effect.update(32.05, { ...night, ...change }); assert.ok(effect.group.visible, '天气突变不会立即删去整片微光');
      advance(effect, 32.1, 42, { ...night, ...change }); assert.ok(!effect.group.visible);
    } finally { effect.dispose(); }
  }
});

test('飞蛾偶尔掠入亮灯附近，短暂盘绕后离开，熄灯时平滑退出', () => {
  const effect = create({ habitats: [] });
  try {
    let near = false, far = false, absent = 0, occupied = 0, longestNear = 0, nearRun = 0, previous;
    for (let step = 0; step < 2400; step++) {
      effect.update(step / 20, night);
      const moths = visibleMoths(effect); assert.ok(moths.length <= 3);
      if (moths.length) occupied++; else absent++;
      const body = pose(effect), distance = body.position.distanceTo(new THREE.Vector3(12, 5, 8));
      if (body.size > .1) {
        near ||= distance < 1.2; far ||= distance > 3;
        nearRun = distance < 1.5 ? nearRun + .05 : 0; longestNear = Math.max(longestNear, nearRun);
        if (previous?.size > .1) assert.ok(body.position.distanceTo(previous.position) < .7, '飞行轨迹连续');
        assert.ok(body.position.y >= 2.1);
      } else nearRun = 0;
      previous = body;
    }
    assert.ok(near && far, '应掠过灯边并远离'); assert.ok(occupied > 0 && absent > 50, '飞蛾不能持续围灯');
    assert.ok(longestNear > .5 && longestNear < 7, '短暂盘绕后离开');
    let time = 120;
    while (!visibleMoths(effect).length && time < 160) { time += .05; effect.update(time, night); }
    assert.ok(visibleMoths(effect).length);
    effect.update(time + .05, { ...night, lampsOn: false }); assert.ok(visibleMoths(effect).length, '熄灯第一帧仍有离开的飞蛾');
    advance(effect, time + .1, time + 12, { ...night, lampsOn: false });
    assert.equal(visibleMoths(effect).length, 0); assert.ok(!effect.group.visible);
  } finally { effect.dispose(); }
});

test('长时间熄灯后重新亮灯，飞蛾错开等待后才偶尔到访', () => {
  const effect = create({ habitats: [] });
  try {
    advance(effect, 0, 40, { ...night, lampsOn: false });
    advance(effect, 40.05, 45); assert.equal(visibleMoths(effect).length, 0, '不能在亮灯时将积压的飞蛾一起放出');
    let first = 0, appeared = false;
    for (let step = 901; step <= 1500; step++) {
      effect.update(step / 20, night); const count = visibleMoths(effect).length;
      if (!appeared && count) { first = count; appeared = true; }
    }
    assert.ok(appeared); assert.equal(first, 1, '各只飞蛾有独立到访时机');
  } finally { effect.dispose(); }
});

test('画质控制两种数量，远处限频和隐藏，靠近立即恢复且实例缩放非负', () => {
  const effect = create();
  try {
    const points = effect.group.getObjectByName('林缘萤火虫'), body = effect.group.getObjectByName('亭灯飞蛾身体');
    const counts = [points.geometry.drawRange.count, body.count]; effect.setQuality('low');
    assert.ok(points.geometry.drawRange.count < counts[0]); assert.ok(body.count < counts[1]); assert.ok(body.count <= 1);
    effect.setQuality('high'); advance(effect, 0, 10);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(145, 5, 8); camera.lookAt(10, 3, 8);
    effect.update(10.05, night, camera); const version = points.geometry.getAttribute('aBrightness').version;
    effect.update(10.06, night, camera); assert.equal(points.geometry.getAttribute('aBrightness').version, version);
    camera.position.set(1500, 5, 8); camera.lookAt(10, 3, 8); effect.update(11, night, camera); assert.ok(!effect.group.visible);
    const hiddenVersion = points.geometry.getAttribute('aBrightness').version; advance(effect, 11.05, 12, night, camera);
    assert.equal(points.geometry.getAttribute('aBrightness').version, hiddenVersion);
    camera.position.set(10, 7, 25); camera.lookAt(10, 3, 8); effect.update(12.05, night, camera);
    assert.ok(effect.group.visible); assert.ok(points.geometry.getAttribute('aBrightness').version > hiddenVersion);
    effect.group.traverse(mesh => { if (!mesh.isInstancedMesh) return; const matrix = new THREE.Matrix4(); for (let index = 0; index < mesh.count; index++) { mesh.getMatrixAt(index, matrix); assert.ok(matrix.elements.every(Number.isFinite)); assert.ok(matrix.determinant() >= 0); } });
  } finally { effect.dispose(); }
});

test('花草不可用时渐退，空栖息地与未亮灯不生成，未提供温度仍适用夏夜', () => {
  let available = true; const effect = create({ habitats: [{ ...habitat, available: () => available }], lamps: [] });
  const empty = create({ habitats: [], lamps: [] }), unlit = create({ habitats: [], lamps: [{ ...lamp, isLit: () => false }] });
  try {
    advance(effect, 0, 10, { ...night, temperature: undefined }); assert.ok(effect.group.visible);
    available = false; advance(effect, 10.05, 20); assert.ok(!effect.group.visible);
    advance(empty, 0, 30); advance(unlit, 0, 30); assert.ok(!empty.group.visible && !unlit.group.visible);
  } finally { effect.dispose(); empty.dispose(); unlit.dispose(); }
});

test('每个场景拥有独立状态，暂停和恢复不会跳跃，16倍速度沿用连续动画时间', () => {
  const effect = create(), other = create(), accelerated = create();
  try {
    advance(effect, 0, 10); advance(other, 0, 10); assert.deepEqual(brightness(effect), brightness(other));
    const before = brightness(other); advance(effect, 10.05, 12); assert.deepEqual(brightness(other), before);
    other.update(10, night); assert.deepEqual(brightness(other), before, '相同场景时间即暂停');
    other.update(400, night); assert.ok(brightness(other).every((value, index) => Math.abs(value - before[index]) < .3), '恢复只推进受限步长');
    accelerated.update(0, night); for (let step = 1; step <= 10; step++) accelerated.update(step * 1.6, { ...night, animationRate: 16 });
    const reference = create();
    try {
      advance(reference, 0, 16);
      assert.ok(brightness(accelerated).every((value, index) => Math.abs(value - brightness(reference)[index]) < .00001), '16倍允许1.6秒步长，闪烁使用相同的连续累计时间');
    } finally { reference.dispose(); }
  } finally { effect.dispose(); other.dispose(); accelerated.dispose(); }
});

test('释放幂等且共享材质和几何只释放一次，释放后更新无效', () => {
  const effect = create(), resources = new Set(), counts = new Map();
  const points = effect.group.getObjectByName('林缘萤火虫'), parent = effect.group.parent;
  effect.group.traverse(object => { if (object.isInstancedMesh) resources.add(object); if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); });
  for (const resource of resources) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  effect.dispose(); effect.dispose(); const version = points.geometry.getAttribute('aBrightness').version;
  effect.update(12, night); effect.setQuality('low');
  assert.ok(!parent.children.includes(effect.group)); assert.equal(points.geometry.getAttribute('aBrightness').version, version);
  assert.ok([...counts.values()].every(count => count === 1));
});

test('夜间居民背向镜头时不写光点和实例，转回即更新到当前时间', () => {
  const effect = create(), reference = create(), camera = new THREE.PerspectiveCamera(70, 1, .1, 500); camera.position.set(12, 7, 25);
  try {
    advance(effect, 0, 12); advance(reference, 0, 12);
    const points = effect.group.getObjectByName('林缘萤火虫'), body = effect.group.getObjectByName('亭灯飞蛾身体');
    const pointVersion = points.geometry.attributes.aBrightness.version, bodyVersion = body.instanceMatrix.version;
    camera.lookAt(12, 7, 45); effect.update(12.05, night, camera); reference.update(12.05, night);
    assert.ok(!effect.group.visible);
    advance(effect, 12.1, 18, night, camera); advance(reference, 12.1, 18);
    assert.equal(points.geometry.attributes.aBrightness.version, pointVersion); assert.equal(body.instanceMatrix.version, bodyVersion);
    camera.lookAt(12, 3, 8); effect.update(18.05, night, camera); reference.update(18.05, night);
    assert.ok(effect.group.visible); assert.ok(points.geometry.attributes.aBrightness.version > pointVersion);
    assert.deepEqual(brightness(effect), brightness(reference));
    if (body.visible) assert.deepEqual(pose(effect), pose(reference));
  } finally { effect.dispose(); reference.dispose(); }
});

test('萤火虫与飞蛾分开剔除，看到一类时不上传另一类视线外姿态', () => {
  const effect = create({
    habitats: [{ ...habitat, sample: (time, target) => target.set(0, 2, -20) }],
    lamps: [{ ...lamp, sample: (time, target) => target.set(0, 5, 20) }],
  });
  const camera = new THREE.PerspectiveCamera(70, 1, .1, 500); camera.position.set(0, 5, 0); camera.lookAt(0, 3, -20);
  try {
    advance(effect, 0, 16);
    const points = effect.group.getObjectByName('林缘萤火虫'), body = effect.group.getObjectByName('亭灯飞蛾身体');
    const bodyVersion = body.instanceMatrix.version;
    effect.update(16.05, night, camera);
    assert.ok(points.visible); assert.ok(!body.visible); assert.equal(body.instanceMatrix.version, bodyVersion);
    const pointVersion = points.geometry.attributes.aBrightness.version;
    camera.lookAt(0, 5, 20); effect.update(16.1, night, camera);
    assert.ok(!points.visible); assert.equal(points.geometry.attributes.aBrightness.version, pointVersion);
  } finally { effect.dispose(); }
});

test('大量林缘落点只选择少量分开的萤火虫小群，总量不增加且低画质仍成群', () => {
  const centers = Array.from({ length: 30 }, (_, index) => new THREE.Vector3(20 + index % 6 * 14, 2, 20 + Math.floor(index / 6) * 14));
  const sites = Object.freeze(centers.map(center => Object.freeze({ available: () => true, sample: (time, target) => target.copy(center) })));
  const effect = create({ habitats: sites, lamps: [] });
  function populations() {
    const geometry = effect.group.getObjectByName('林缘萤火虫').geometry, position = geometry.attributes.position, groups = new Map();
    for (let index = 0; index < geometry.drawRange.count; index++) {
      let closest = -1, distance = Infinity;
      centers.forEach((center, at) => { const gap = Math.hypot(center.x - position.getX(index), center.z - position.getZ(index)); if (gap < distance) { closest = at; distance = gap; } });
      assert.ok(distance <= 3.25, '2.4米群半径加双轴0.6米漂移仍围绕真实林缘'); groups.set(closest, (groups.get(closest) ?? 0) + 1);
    }
    return groups;
  }
  try {
    advance(effect, 0, 12);
    const high = populations(); assert.equal([...high.values()].reduce((sum, count) => sum + count, 0), 54);
    assert.ok(high.size > 1 && high.size <= 6, '30个落点不能将54只打散成30个零星亮点');
    assert.ok([...high.values()].every(count => count >= 3), '每个小群保持可观察的数量');
    assert.ok(new Set(high.values()).size > 1, '群落大小应有疏密变化');
    const selected = [...high.keys()];
    selected.forEach((at, index) => selected.slice(index + 1).forEach(other => assert.ok(centers[at].distanceTo(centers[other]) >= 8, '小群中心应空间分开')));
    effect.setQuality('low'); advance(effect, 12.05, 13);
    const low = populations(); assert.equal([...low.values()].reduce((sum, count) => sum + count, 0), 18);
    assert.ok([...low.values()].every(count => count >= 2), '低画质保留小群，不能又退化成散点');
    assert.equal(sites.length, 30); assert.ok(sites.every(site => Object.isFrozen(site)), '不得重排或修改调用者输入');
  } finally { effect.dispose(); }
});

test('萤火虫小群优先选择可用林缘，未开放落点不会分走有效落点的居民', () => {
  const allowed = new Set([2, 7, 12, 17, 22, 27]);
  const centers = Array.from({ length: 30 }, (_, index) => new THREE.Vector3(20 + index % 6 * 14, 2, 20 + Math.floor(index / 6) * 14));
  const sites = centers.map((center, index) => ({ available: () => allowed.has(index), sample: (time, target) => target.copy(center) }));
  const effect = create({ habitats: sites, lamps: [] });
  try {
    advance(effect, 0, 12); const geometry = effect.group.getObjectByName('林缘萤火虫').geometry, position = geometry.attributes.position;
    assert.equal(geometry.drawRange.count, 54);
    for (let index = 0; index < geometry.drawRange.count; index++) {
      assert.ok([...allowed].some(at => Math.hypot(centers[at].x - position.getX(index), centers[at].z - position.getZ(index)) < 3.25), '全部居民应先分配到当前有效林缘');
    }
    allowed.clear(); advance(effect, 12.05, 20); assert.ok(!effect.group.visible);
    [2, 7, 12, 17, 22, 27].forEach(index => allowed.add(index)); advance(effect, 20.05, 32); assert.ok(effect.group.visible);
  } finally { effect.dispose(); }
});

test('近邻落点合成一群或仅一个有效落点时，不超过单群36只容量', () => {
  for (const sites of [
    Array.from({ length: 12 }, (_, index) => ({ available: () => true, sample: (time, target) => target.set(20 + index * .1, 2, 20) })),
    Array.from({ length: 12 }, (_, index) => ({ available: () => index === 5, sample: (time, target) => target.set(20 + index * 14, 2, 20) })),
  ]) {
    const effect = create({ habitats: sites, lamps: [] });
    try {
      advance(effect, 0, 12);
      assert.equal(effect.group.getObjectByName('林缘萤火虫').geometry.drawRange.count, 36, '容量应按实际选中的小群数计算');
      assert.ok(effect.group.visible);
    } finally { effect.dispose(); }
  }
});

test('萤火虫每晚随机换林缘，午夜和同夜天气恢复不重选，亮着时换夜先渐退', () => {
  const centers = Array.from({ length: 30 }, (_, i) => new THREE.Vector3(i % 6 * 14, 2, Math.floor(i / 6) * 14));
  const sites = centers.map(center => ({ available: () => true, sample: (time, target) => target.copy(center) }));
  const effect = create({ habitats: sites, lamps: [] }), other = create({ habitats: sites, lamps: [], random: seededRandom(19) });
  function groups(effect) {
    const geometry = effect.group.getObjectByName('林缘萤火虫').geometry, position = geometry.attributes.position;
    return [...new Set(Array.from({ length: geometry.drawRange.count }, (_, i) => {
      let index = 0, nearest = Infinity;
      centers.forEach((center, j) => { const d = Math.hypot(center.x - position.getX(i), center.z - position.getZ(i)); if (d < nearest) { nearest = d; index = j; } });
      return index;
    }))].sort((a, b) => a - b);
  }
  try {
    advance(effect, 0, 12, { ...night, dayIndex: 3 }); advance(other, 0, 12, { ...night, dayIndex: 3 });
    const first = groups(effect); assert.notDeepEqual(first, groups(other), '不同场景选择不同群落');
    advance(effect, 12.05, 20, { ...night, dayIndex: 4, hour: 1 }); assert.deepEqual(groups(effect), first, '午夜不换群落');
    advance(effect, 20.05, 28, { ...night, dayIndex: 4, hour: 1, rain: .8 });
    advance(effect, 28.05, 40, { ...night, dayIndex: 4, hour: 1 }); assert.deepEqual(groups(effect), first, '同夜雨后恢复原群落');
    const points = effect.group.getObjectByName('林缘萤火虫'), before = points.geometry.attributes.position.array.slice();
    effect.update(40.05, { ...night, dayIndex: 4 });
    const after = points.geometry.attributes.position.array;
    for (let i = 0; i < before.length; i += 3) assert.ok(Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2]) < .1, '正在发光的个体不能瞬移');
    advance(effect, 40.1, 56, { ...night, dayIndex: 4 }); assert.notDeepEqual(groups(effect), first, '下一晚换一批林缘');
  } finally { effect.dispose(); other.dispose(); }
});
test('影片观察直接读取离屏居民与真实灯位，预热仍遵守夏夜和亮灯条件',()=>{const effect=create();try{
 assert.equal(typeof effect.prepareObservation,'function');effect.prepareObservation('firefly',0,night);assert.ok(brightness(effect).some(v=>v>.1));const glow=effect.getObservationTarget('firefly',0);assert.ok(glow.position.distanceTo(new THREE.Vector3(10,2.7,8))<.01);
 effect.prepareObservation('moth',0,night);const target=effect.getObservationTarget('moth',0);assert.ok(target.position.distanceTo(new THREE.Vector3(12,5,8))<.01);assert.ok(visibleMoths(effect).some(p=>p.position.distanceTo(target.position)<1.5));
 }finally{effect.dispose();}const closed=create();closed.prepareObservation('moth',0,{...night,lampsOn:false});assert.equal(visibleMoths(closed).length,0);closed.prepareObservation('firefly',0,{...night,seasonIndex:3});assert.ok(brightness(closed).every(v=>v===0));closed.dispose();});
