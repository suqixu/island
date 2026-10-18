import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const motion = await import('../src/fish-wave-motion.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const model = await import('../src/models/fish-wave.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
import { heightAt } from '../src/terrain.js';

const evening = { hour: 17.5, daylight: .7, rain: 0, snow: 0, storm: 0, fog: 0, windSpeed: 5 };
const cameraFor = () => {
  const camera = new THREE.PerspectiveCamera(46, 1280 / 900, .5, 65000);
  camera.position.set(160, 68, 200); camera.lookAt(0, 15, 0); camera.updateMatrixWorld(); return camera;
};
function run(event, seconds, env = evening, camera = cameraFor()) {
  for (let i = 0; i <= seconds * 20; i++) event.update(i / 20, env, camera);
}

test('事件按聚集、爆发、消退结束，冷却期间不重启；暴风雪和台风立刻停用', () => {
  assert.equal(typeof motion.createFishWaveState, 'function', '缺少鱼群跃浪状态机');
  const state = motion.createFishWaveState({ random: () => 0 });
  let now = 0;
  const advance = (seconds, env = evening) => {
    for (let i = 0; i < seconds * 20; i++) { now += .05; state.update(now, env); }
    return state.phase;
  };
  state.update(0, evening);
  assert.equal(advance(46), 'gather');
  assert.equal(advance(5), 'burst');
  assert.equal(advance(16), 'fade');
  assert.equal(advance(5), 'idle');
  assert.equal(advance(100), 'idle');
  assert.equal(advance(90), 'burst');
  assert.equal(advance(.1, { ...evening, typhoon: 1 }), 'idle');
  assert.equal(advance(400, { ...evening, blizzard: 1 }), 'idle');
});

test('午间只在雨后放晴触发，夜间不触发，后台恢复不补播；时间不变不推进', () => {
  assert.equal(typeof motion.createFishWaveState, 'function');
  const state = motion.createFishWaveState({ random: () => 0 });
  const midday = { ...evening, hour: 12 };
  for (let i = 0; i <= 2000; i++) state.update(i / 20, midday);
  assert.equal(state.phase, 'idle');
  state.update(100.05, { ...midday, rain: .8 });
  for (let i = 1; i <= 200; i++) state.update(100.05 + i / 20, midday);
  assert.notEqual(state.phase, 'idle');
  const age = state.age; state.update(110.05, midday); assert.equal(state.age, age);
  state.update(300, midday); assert.equal(state.phase, 'idle');
  for (let i = 1; i <= 3000; i++) state.update(300 + i / 20, { ...midday, hour: 0, daylight: 0 });
  assert.equal(state.phase, 'idle');
});

test('鱼群分片错峰跃起，只有部分出水，真实海床与镜头移动不改变本轮位置', () => {
  assert.equal(typeof model.createFishWave, 'function', '缺少鱼群跃浪渲染');
  const scene = new THREE.Scene(), camera = cameraFor();
  const event = model.createFishWave(scene, { heightAt, random: () => 0 });
  try {
    run(event, 56, evening, camera);
    assert.equal(event.phase, 'burst');
    const bodies = event.group.getObjectByName('跃浪银鱼');
    assert.equal(bodies.count, 1200);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    let airborne = 0;
    for (let i = 0; i < bodies.count; i++) {
      bodies.getMatrixAt(i, matrix); assert.ok(matrix.elements.every(Number.isFinite));
      position.setFromMatrixPosition(matrix);
      assert.ok(heightAt(position.x, position.z) < -4, '整片鱼群只能位于海面');
      if (position.y > .4) airborne++;
    }
    assert.ok(airborne > 20 && airborne < 600, `出水数量 ${airborne} 应是鱼群的一部分`);
    bodies.getMatrixAt(0, matrix); const before = matrix.clone();
    camera.position.set(-400, 80, -400); camera.lookAt(0, 0, 0);
    event.update(56, evening, camera); bodies.getMatrixAt(0, matrix);
    assert.deepEqual(matrix.elements, before.elements, '同一时刻转动相机不能拖走鱼群');
    event.setQuality('medium'); event.update(56, evening, camera); assert.equal(bodies.count, 700);
    event.setQuality('low'); event.update(56, evening, camera); assert.equal(bodies.count, 320);
    event.update(56.05, { ...evening, blizzard: 1 }, camera); assert.equal(event.group.visible, false);
  } finally { event.dispose(); event.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('陆地或被岛体挡住的海面不产生鱼群，等待时没有海床采样开销', () => {
  assert.equal(typeof model.createFishWave, 'function');
  let samples = 0;
  const event = model.createFishWave(new THREE.Scene(), { heightAt: () => { samples++; return 10; }, random: () => 0 });
  run(event, 40); assert.equal(samples, 0);
  run(event, 60); assert.equal(event.group.visible, false); event.dispose();
});

test('鱼身入水后继续前进，跃起和潜回连续，不会在每次落水后跳回原地', () => {
  const member = { x: 0, z: 0, phase: .5, speed: 4, height: 2, delay: 0, leader: true, span: 60 };
  for (let frame = 1; frame < 24 * 120; frame++) {
    const before = motion.getFishWavePose((frame - 1) / 120, member);
    const after = motion.getFishWavePose(frame / 120, member);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < .22,
      `第 ${frame} 帧鱼身位移不连续`);
  }
});

test('16倍速仍保留24秒观赏时间，清晨能触发，浓雾和雷暴不能触发', () => {
  const normal = motion.createFishWaveState({ random: () => 0 });
  const fast = motion.createFishWaveState({ random: () => 0 });
  for (let i = 0; i <= 1120; i++) {
    normal.update(i / 20, { ...evening, hour: 6.5 });
    fast.update(i / 20 * 16, { ...evening, hour: 6.5, animationRate: 16 });
  }
  assert.equal(normal.phase, 'burst'); assert.equal(fast.phase, normal.phase); assert.equal(fast.age, normal.age);
  for (const override of [{ fog: .9 }, { storm: 1 }, { weather: 'typhoon' }, { weather: 'blizzard' }]) {
    const state = motion.createFishWaveState({ random: () => 0 });
    for (let i = 0; i < 1200; i++) state.update(i / 20, { ...evening, ...override });
    assert.equal(state.phase, 'idle');
  }
});

test('窄屏和宽屏都能在可见海面选址，等待不更新实例，退出只释放一次', () => {
  for (const [width, height] of [[390, 844], [634, 768], [1280, 900]]) {
    const camera = cameraFor(); camera.aspect = width / height;
    if (width < 760) { camera.fov = 54; camera.position.multiplyScalar(1.48); camera.lookAt(0, 15, 0); }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const event = model.createFishWave(new THREE.Scene(), { heightAt, random: () => 0 });
    run(event, 56, evening, camera); assert.equal(event.group.visible, true, `${width}px 应有鱼群`);
    for (let frame = 1121; frame <= 1500; frame++) event.update(frame / 20, evening, camera);
    assert.equal(event.group.visible, false);
    const mesh = event.group.getObjectByName('跃浪银鱼'), version = mesh.instanceMatrix.version;
    event.update(75.05, evening, camera); assert.equal(mesh.instanceMatrix.version, version);
    let disposed = 0; mesh.geometry.addEventListener('dispose', () => disposed++);
    event.dispose(); event.dispose(); assert.equal(disposed, 1);
  }
});

test('真实16倍昼夜模拟在日落后仍完整播放24秒，不能在聚集阶段就被昼光阈值截断', async () => {
  const { createSimulation, advanceSimulation, getEnvironment } = await import('../src/simulation.js');
  const simulation = createSimulation({ hour: 17.5, speed: 16, elapsed: 0, weather: 'sunny',
    autoWeather: false, autoSeason: false, seasonIndex: 1, windSeed: 42 });
  const state = motion.createFishWaveState({ random: () => 0 });
  let started, finished, sawBurst = false, sawFade = false;
  state.update(0, getEnvironment(simulation));
  for (let frame = 1; frame <= 90 * 60; frame++) {
    advanceSimulation(simulation, 1 / 60); state.update(simulation.elapsed, getEnvironment(simulation));
    if (state.phase !== 'idle') started ??= frame / 60;
    sawBurst ||= state.phase === 'burst'; sawFade ||= state.phase === 'fade';
    if (started !== undefined && state.phase === 'idle') { finished = frame / 60; break; }
  }
  assert.ok(sawBurst && sawFade, '实际昼夜倍率下必须能经历爆发和消退');
  assert.ok(finished - started >= 23.95 && finished - started <= 24.05, `实际持续 ${finished - started} 秒`);
});

function firstSchoolCenter(event, camera) {
  for (let frame = 0; frame <= 120 * 10; frame++) {
    event.update(frame / 10, evening, camera);
    if (!event.group.visible) continue;
    const body = event.group.getObjectByName('跃浪银鱼'), matrix = new THREE.Matrix4();
    const center = new THREE.Vector3(), point = new THREE.Vector3();
    for (let i = 0; i < body.count; i++) {
      body.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix); center.add(point);
    }
    return center.divideScalar(body.count);
  }
  assert.fail('相机可见海域中应选出一轮鱼群');
}

test('同一视角的不同场景种子在不同海域出现，不固定在画面右侧', () => {
  const centers = [];
  for (const value of [.04, .17, .28, .39, .51, .64, .76, .91]) {
    const event = model.createFishWave(new THREE.Scene(), { heightAt, random: () => value });
    try { centers.push(firstSchoolCenter(event, cameraFor())); } finally { event.dispose(); }
  }
  let separation = 0;
  for (const a of centers) for (const b of centers) separation = Math.max(separation, a.distanceTo(b));
  assert.ok(separation > 40, `不同随机种子的海域间距应明显变化，实际仅 ${separation.toFixed(2)} 米`);
  const projected = centers.map(center => center.clone().project(cameraFor()));
  assert.ok(projected.some(point => point.x < -.1) && projected.some(point => point.x > .1), '左右两侧都应有出现机会');
});

test('同一场景连续两轮换一片海域，南峰亭和东峰亭也能随机选址', () => {
  const views = [
    { position: [160, 68, 200], target: [0, 15, 0] },
    { position: [1.31, 42.33504653930664, 27.175810977678374], target: [14.31, 37.23504653930664, 19.37581097767837] },
    { position: [10.130604457535407, 52.00337251713078, -8.815822037263995], target: [13.8703125, 46.90337251713078, -23.5078125] },
  ];
  for (const view of views) {
    const camera = cameraFor(); camera.position.fromArray(view.position); camera.lookAt(...view.target); camera.updateMatrixWorld();
    const event = model.createFishWave(new THREE.Scene(), { heightAt, random: () => 0 });
    try {
      const first = firstSchoolCenter(event, camera);
      let observedIdle = false, second;
      for (let frame = 452; frame < 2900; frame++) {
        event.update(frame / 10, evening, camera);
        if (!event.group.visible) observedIdle = true;
        if (!observedIdle || !event.group.visible) continue;
        const body = event.group.getObjectByName('跃浪银鱼'), matrix = new THREE.Matrix4();
        second = new THREE.Vector3(); const point = new THREE.Vector3();
        for (let i = 0; i < body.count; i++) { body.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix); second.add(point); }
        second.divideScalar(body.count); break;
      }
      assert.ok(second, '下一轮应再次选到海域');
      assert.ok(first.distanceTo(second) > 35, `连续事件应尽量避开上一片海域：相机 ${view.position}，间距 ${first.distanceTo(second)}`);
    } finally { event.dispose(); }
  }
});

test('海面不被山体遮挡但被近处建筑挡住时，不能把鱼群放在建筑背后', () => {
  const camera = cameraFor(), scene = new THREE.Scene();
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(2000, 2000, 1), new THREE.MeshBasicMaterial());
  blocker.position.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 20);
  blocker.quaternion.copy(camera.quaternion); scene.add(blocker); scene.updateMatrixWorld(true);
  const event = model.createFishWave(scene, { heightAt: () => -20, random: () => 0, occluders: [blocker] });
  try { run(event, 56, evening, camera); assert.equal(event.group.visible, false, '被建筑完全挡住时应跳过本轮'); }
  finally { event.dispose(); blocker.geometry.dispose(); blocker.material.dispose(); }
});
