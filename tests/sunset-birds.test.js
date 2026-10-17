import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getSunBackdropState } from '../src/sun-framing.js';

const module = await import('../src/sunset-birds.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
});
const create = (options = {}) => {
  assert.ok(module?.createSunsetBirds, '应提供独立的落日双鸟模块');
  return module.createSunsetBirds({ random: () => .5, ...options });
};
const sunset = () => ({
  hour: 17.6, daylight: .65, cloudiness: .12, skyCloudCover: .12,
  rain: 0, snow: 0, fog: 0, storm: 0,
  sunDirection: new THREE.Vector3(.97, .15, .19).normalize(),
  sunBackdropDirection: new THREE.Vector3(.24, .20, -1).normalize(),
  sunAngularRadius: .017, eclipse: { active: false },
});
function camera() {
  const view = new THREE.PerspectiveCamera(46, 1280 / 900, .5, 7000);
  view.position.set(160, 68, 200);
  view.lookAt(0, 15, 0);
  view.updateMatrixWorld();
  return view;
}
const birds = effect => effect.group.children.filter(object => object.isMesh);
const visibleBirds = effect => effect.group.visible ? birds(effect).filter(bird => bird.visible) : [];
function runUntilVisible(effect, env, view, { start = 0, rate = 1, limit = 12 } = {}) {
  effect.update(start * rate, env, view);
  for (let frame = 1; frame <= limit * 20; frame++) {
    const time = start + frame * .05;
    effect.update(time * rate, env, view);
    if (visibleBirds(effect).length) return time;
  }
  assert.fail('落日余晖中应在等待后出现飞鸟');
}

// Removing either bird or replacing the wings with points breaks the scene.
test('落日随机等待后恰好出现两只具备真实弯翼轮廓的黑色远鸟', () => {
  const effect = create(), env = sunset(), view = camera();
  try {
    assert.equal(visibleBirds(effect).length, 0);
    const born = runUntilVisible(effect, env, view);
    assert.ok(born >= 3 && born <= 10);
    assert.equal(visibleBirds(effect).length, 2);
    for (let frame = 1; frame <= 20; frame++) effect.update(born + frame * .05, env, view);
    for (const bird of visibleBirds(effect)) {
      const geometry = bird.geometry;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox.getSize(new THREE.Vector3()).multiply(bird.scale);
      assert.ok(size.x > 20 && size.x < 40, '翼展应可辨认且保持远鸟的克制比例');
      assert.ok(size.y > 3 && size.y < size.x * .65, '两翼应形成有厚度的曲折轮廓，而非点或线');
      assert.ok(geometry.index.count >= 18 && !bird.isPoints, '鸟形应由真实面片组成');
      assert.ok(bird.material.color.r < .025 && bird.material.color.g < .025 && bird.material.color.b < .025);
      assert.ok(geometry.attributes.position.array.every(Number.isFinite));
      assert.ok(bird.position.length() > 1700 && bird.position.length() < 2600);
    }
    assert.ok(birds(effect)[0].position.distanceTo(birds(effect)[1].position) > 35, '双鸟需一前一后，不能重合');
  } finally { effect.dispose(); }
});

// A fixed countdown, accelerated timer or short loop would change these arrivals.
test('首轮3至10秒随机等待，16倍动画仍以真实秒计时', () => {
  const first = [];
  for (const sample of [0, .99]) {
    for (const rate of [1, 16]) {
      const effect = create({ random: () => sample }), env = { ...sunset(), animationRate: rate }, view = camera();
      try { first.push(runUntilVisible(effect, env, view, { rate })); }
      finally { effect.dispose(); }
    }
  }
  assert.ok(first[0] >= 3 && first[0] < 3.1);
  assert.ok(first[2] > 9.8 && first[2] <= 10.1);
  assert.ok(Math.abs(first[0] - first[1]) < .06 && Math.abs(first[2] - first[3]) < .06);
});

test('双鸟飞行12至20秒后淡出，随后留有较长且不同的随机安静间隔', () => {
  let seed = 471;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const effect = create({ random }), env = sunset(), view = camera(), starts = [], ends = [];
  let previous = false, peak = 0, sawFade = false;
  try {
    for (let frame = 0; frame <= 8000; frame++) {
      const time = frame * .05;
      effect.update(time, env, view);
      const count = visibleBirds(effect).length, visible = count > 0;
      if (visible && !previous) starts.push(time);
      if (!visible && previous) ends.push(time);
      peak = Math.max(peak, count);
      if (visible && time - starts.at(-1) > 10) sawFade ||= birds(effect)[0].material.opacity < .4;
      previous = visible;
    }
    assert.equal(peak, 2);
    assert.ok(ends.length >= 4 && sawFade, '应有多轮事件并在末端平滑消失');
    for (let i = 0; i < ends.length; i++) {
      assert.ok(ends[i] - starts[i] >= 12 && ends[i] - starts[i] <= 20.1);
      if (starts[i + 1] !== undefined) assert.ok(starts[i + 1] - ends[i] >= 22, '不能立刻重播');
    }
    const gaps = starts.slice(1).map((start, index) => start - ends[index]);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) > 10, '每轮等待应重新随机，而非固定周期');
  } finally { effect.dispose(); }
});

// Targeting physical sun instead of the composed disc sends the birds off-screen.
test('双鸟持续朝触发时的构图太阳飞远缩小，拍翼节奏错开', () => {
  const effect = create(), env = sunset(), view = camera();
  try {
    const born = runUntilVisible(effect, env, view);
    const first = birds(effect).map(bird => ({ direction: bird.position.clone().normalize(), range: bird.position.length(), size: bird.scale.x }));
    const initialWings = birds(effect).map(bird => bird.geometry.attributes.position.array.slice());
    let motionDifference = false;
    const wingMoved = [false, false];
    for (let frame = 1; frame <= 200; frame++) {
      effect.update(born + frame * .05, env, view);
      const pair = birds(effect);
      motionDifference ||= Math.abs(pair[0].geometry.attributes.position.getY(7) - pair[1].geometry.attributes.position.getY(7)) > .08;
      pair.forEach((bird, index) => {
        wingMoved[index] ||= bird.geometry.attributes.position.array.some((value, vertex) => Math.abs(value - initialWings[index][vertex]) > .1);
      });
      for (const bird of pair) assert.ok(bird.position.clone().normalize().y > .035, '完整飞行应保持在海平线上方');
    }
    birds(effect).forEach((bird, index) => {
      const direction = bird.position.clone().normalize();
      assert.ok(direction.angleTo(env.sunBackdropDirection) < first[index].direction.angleTo(env.sunBackdropDirection) * .5);
      assert.ok(direction.angleTo(env.sunBackdropDirection) < direction.angleTo(env.sunDirection), '不能误向物理太阳方向');
      assert.ok(bird.position.length() > first[index].range + 200 && bird.scale.x < first[index].size * .9);
      assert.ok(wingMoved[index], '每只鸟都应真实改变翼形');
    });
    assert.ok(motionDifference, '两只鸟应有独立拍翼节奏');
  } finally { effect.dispose(); }
});

test('已起飞的轨迹不因转头、平移或太阳构图重新计算而漂移', () => {
  const effect = create(), env = sunset(), view = camera();
  try {
    const born = runUntilVisible(effect, env, view);
    effect.update(born + .2, env, view);
    const snapshot = () => ({
      anchor: effect.group.position.toArray(),
      birds: birds(effect).map(bird => ({ position: bird.position.toArray(), quaternion: bird.quaternion.toArray(), shape: [...bird.geometry.attributes.position.array] })),
    });
    const before = snapshot();
    view.position.add(new THREE.Vector3(200, 50, -100));
    view.lookAt(500, 500, 200); view.updateMatrixWorld();
    effect.update(born + .2, { ...env, sunBackdropDirection: new THREE.Vector3(-.7, .12, .7).normalize() }, view);
    assert.deepEqual(snapshot(), before);
  } finally { effect.dispose(); }
});

// Wrong time/weather branches must never accrue a hidden event to replay later.
test('白天、黎明、深夜、浓云雾雨雪雷暴及日食均不出现且清理已有双鸟', () => {
  const blocked = [
    { hour: 12 }, { hour: 5.9 }, { hour: 19 }, { daylight: 0 },
    { sunDirection: new THREE.Vector3(0, -.4, -1).normalize() },
    { cloudiness: .96 }, { skyCloudCover: 1 }, { fog: .85 }, { rain: .9 }, { snow: .9 }, { storm: .85 },
    { eclipse: { active: true, coverage: .1 } },
  ];
  for (const extra of blocked) {
    const effect = create({ random: () => 0 }), env = sunset(), view = camera();
    try {
      for (let frame = 0; frame <= 300; frame++) {
        effect.update(frame * .1, { ...env, ...extra }, view);
        assert.equal(visibleBirds(effect).length, 0, JSON.stringify(extra));
      }
      effect.update(30.1, env, view);
      assert.equal(visibleBirds(effect).length, 0, '恢复晴朗时不能补播隐形事件');
      const born = runUntilVisible(effect, env, view, { start: 30.1 });
      assert.equal(visibleBirds(effect).length, 2);
      effect.update(born + .05, { ...env, ...extra }, view);
      assert.equal(visibleBirds(effect).length, 0, '条件消失后立即清理');
    } finally { effect.dispose(); }
  }
});

test('太阳沉到地平线附近时双鸟仍在天空，余晖结束后停止', () => {
  const effect = create(), view = camera(), env = {
    ...sunset(), hour: 18.15, daylight: .16,
    sunDirection: new THREE.Vector3(.97, -.025, .2).normalize(),
    sunBackdropDirection: new THREE.Vector3(.25, -.025, -1).normalize(),
  };
  try {
    const born = runUntilVisible(effect, env, view);
    for (let frame = 1; frame <= 300; frame++) {
      effect.update(born + frame * .05, env, view);
      for (const bird of visibleBirds(effect)) {
        bird.updateMatrixWorld();
        const position = bird.geometry.attributes.position;
        for (let vertex = 0; vertex < position.count; vertex++) {
          const world = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(bird.matrixWorld).sub(effect.group.position);
          assert.ok(world.y > 40, '含拍翼的整个鸟形都应留在可见天空中');
        }
      }
    }
    effect.update(born + 15.05, { ...env, hour: 18.5 }, view);
    assert.equal(visibleBirds(effect).length, 0);
  } finally { effect.dispose(); }
});

test('三种画质均保留两只，整轮复用几何材质且每项资源仅释放一次', () => {
  const effect = create(), env = sunset(), view = camera(), resources = new Set(), shapes = [];
  effect.group.traverse(object => { if (object.geometry) { resources.add(object.geometry); shapes.push(object.geometry.attributes.position.array); } if (object.material) resources.add(object.material); });
  assert.ok(birds(effect).length <= 2, '远鸟总绘制次数应保持很少');
  const released = new Map();
  resources.forEach(resource => resource.addEventListener('dispose', () => released.set(resource, (released.get(resource) || 0) + 1)));
  new THREE.Scene().add(effect.group);
  try {
    let now = runUntilVisible(effect, env, view);
    for (const quality of ['high', 'medium', 'low']) {
      effect.setQuality(quality);
      now += .1; effect.update(now, env, view);
      assert.equal(visibleBirds(effect).length, 2);
      birds(effect).forEach((bird, index) => {
        assert.ok(resources.has(bird.geometry) && resources.has(bird.material));
        assert.equal(bird.geometry.attributes.position.array, shapes[index]);
      });
    }
    for (let frame = 1; frame <= 1400; frame++) effect.update(now + frame * .05, env, view);
    assert.equal(released.size, 0);
  } finally { effect.dispose(); effect.dispose(); }
  assert.equal(effect.group.parent, null);
  assert.equal(released.size, resources.size);
  for (const count of released.values()) assert.equal(count, 1);
  effect.update(100, env, view);
  assert.equal(effect.group.children.length, 0);
});


test('桌面及手机竖屏的双鸟都从可见天空起飞，不在侧屏外等待', () => {
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    const view = new THREE.PerspectiveCamera(width < 760 ? 54 : 46, width / height, .5, 7000);
    view.position.set(160, 68, 200);
    if (width < 760) view.position.multiplyScalar(1.48);
    view.lookAt(0, 15, 0); view.updateMatrixWorld();
    const env = sunset(), effect = create({ random: () => .99 });
    env.sunBackdropDirection = getSunBackdropState(view, width, height, env.sunDirection).direction;
    try {
      runUntilVisible(effect, env, view);
      effect.group.updateMatrixWorld(true);
      for (const bird of visibleBirds(effect)) {
        const projected = bird.getWorldPosition(new THREE.Vector3()).project(view);
        assert.ok(Math.abs(projected.x) < .95 && Math.abs(projected.y) < .96, `${width}px 画面应能看到两只起飞的鸟：${projected.x}, ${projected.y}`);
      }
      assert.ok(birds(effect)[0].position.distanceTo(birds(effect)[1].position) > 35, '竖屏中也应清楚分开双鸟');
    } finally { effect.dispose(); }
  }
});
