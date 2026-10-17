import test from 'node:test';
import assert from 'node:assert/strict';
import { heightAt } from '../src/terrain.js';
import { LAGOON_LAYOUT } from '../src/lagoon.js';

const motion = await import('../src/lagoon-life-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function api() { assert.ok(motion, '泻湖常驻动物需要确定性安全轨迹'); return motion; }
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
function lagoonRadius(x, z) {
  const dx = x - LAGOON_LAYOUT.center[0], dz = z - LAGOON_LAYOUT.center[1];
  const c = Math.cos(LAGOON_LAYOUT.rotation), s = Math.sin(LAGOON_LAYOUT.rotation);
  return Math.hypot((c * dx + s * dz) / 25, (-s * dx + c * dz) / 18);
}

test('常驻生态确定性生成四种居民，三组鱼错相而非逐帧重新随机', () => {
  const { createLagoonHabitats, getLagoonResidentPose } = api();
  const first = createLagoonHabitats(heightAt, 42), repeated = createLagoonHabitats(heightAt, 42);
  assert.deepEqual(first, repeated);
  assert.equal(first.fish.length, 42); assert.equal(first.turtle.length, 3);
  assert.equal(first.crab.length, 8); assert.equal(first.lobster.length, 5);
  assert.equal(new Set(first.fish.map(home => home.school)).size, 3);
  assert.equal(new Set(first.fish.map(home => home.phase)).size, 42);
  assert.notDeepEqual(first, createLagoonHabitats(heightAt, 77));
  const home = first.fish[0], original = structuredClone(home);
  assert.deepEqual(getLagoonResidentPose(22, home, heightAt), getLagoonResidentPose(22, repeated.fish[0], heightAt));
  getLagoonResidentPose(57, home, heightAt); assert.deepEqual(home, original);
});

test('多个种子完整游泳身体在真实湖床之上，远离沙洲且始终在水下', () => {
  const { createLagoonHabitats, getLagoonResidentPose } = api();
  for (const seed of [0, 42, 77, .42, 2147483646]) {
    const homes = createLagoonHabitats(heightAt, seed);
    for (const home of [...homes.fish, ...homes.turtle]) for (let time = 0; time <= 240; time += 2.3) {
      const pose = getLagoonResidentPose(time, home, heightAt), [x, y, z] = pose.position;
      assert.ok(pose.visible && pose.position.every(Number.isFinite));
      assert.ok(lagoonRadius(x, z) < .84);
      assert.ok(y + home.heightRadius < -.06, '壳厚和鱼背不能露出水面');
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        assert.ok(y - home.heightRadius > heightAt(x + Math.cos(angle) * home.radius, z + Math.sin(angle) * home.radius) + .06,
          `${home.kind}完整身体不可穿海床或沙洲`);
      }
      const next = getLagoonResidentPose(time + 1 / 60, home, heightAt);
      assert.ok(distance(pose.position, next.position) < .06, '循环轨迹必须连续');
    }
  }
});

test('游泳前进方向与身体一致、龟鳍和鱼尾持续摆动，不依赖昼夜进度', () => {
  const { createLagoonHabitats, getLagoonResidentPose } = api(), homes = createLagoonHabitats(heightAt, 12);
  for (const home of [homes.fish[0], homes.fish[15], homes.turtle[0]]) {
    const before = getLagoonResidentPose(10, home, heightAt), after = getLagoonResidentPose(10.001, home, heightAt);
    const vx = after.position[0] - before.position[0], vz = after.position[2] - before.position[2];
    assert.ok((vx * Math.sin(before.heading) + vz * Math.cos(before.heading)) / Math.hypot(vx, vz) > .999);
    assert.ok(distance(getLagoonResidentPose(0, home, heightAt).position, getLagoonResidentPose(8, home, heightAt).position) > 1);
    assert.notEqual(before.tail, after.tail);
    if (home.kind === 'turtle') assert.notEqual(before.flipper, after.flipper);
  }
});

test('底栖动物走停连续、腿交替且触须钳持续有细动作，贴真实湖床', () => {
  const { createLagoonHabitats, getLagoonResidentPose } = api(), homes = createLagoonHabitats(heightAt, 42);
  for (const home of [...homes.crab, ...homes.lobster]) {
    let moved = false, rested = false;
    for (let time = 0; time < 90; time += .25) {
      const pose = getLagoonResidentPose(time, home, heightAt), next = getLagoonResidentPose(time + .01, home, heightAt);
      const [x, y, z] = pose.position;
      assert.ok(y >= heightAt(x, z) - .03 && y < heightAt(x, z) + .22);
      assert.ok(distance(pose.position, next.position) < .02);
      assert.ok(lagoonRadius(x, z) < 1.08);
      assert.ok(pose.legs.length >= 8 && pose.legs.every(Number.isFinite));
      assert.ok(Math.abs(pose.legs[0] + pose.legs[1]) < 1e-8, '对侧腿应交替');
      moved ||= distance(pose.position, next.position) > .0001;
      rested ||= distance(pose.position, next.position) < 1e-10;
    }
    assert.ok(moved && rested, `${home.kind}应实际有行走和停留`);
    assert.notEqual(getLagoonResidentPose(10, home, heightAt).claw, getLagoonResidentPose(11, home, heightAt).claw);
    if (home.kind === 'lobster') assert.notEqual(getLagoonResidentPose(10, home, heightAt).antenna, getLagoonResidentPose(11, home, heightAt).antenna);
  }
});

test('没有可用水域或非有限海床时不把动物生成到陆地', () => {
  const { createLagoonHabitats } = api();
  for (const bed of [() => 10, () => NaN]) {
    const homes = createLagoonHabitats(bed, 42);
    assert.ok(Object.values(homes).every(records => records.length === 0));
  }
});

test('底栖动物停步时所有脚自然落地，停走边界腿动作连续', () => {
  const { createLagoonHabitats, getLagoonResidentPose } = api(), homes = createLagoonHabitats(heightAt, 42);
  for (const home of [homes.crab[0], homes.lobster[0]]) {
    const stoppedAt = 14 - home.restOffset + 10;
    assert.ok(getLagoonResidentPose(stoppedAt, home, heightAt).legs.every(value => Math.abs(value) < 1e-10));
    const boundary = 14 - home.restOffset + 8;
    const before = getLagoonResidentPose(boundary - .001, home, heightAt), after = getLagoonResidentPose(boundary + .001, home, heightAt);
    assert.ok(before.legs.every((value, i) => Math.abs(value - after.legs[i]) < .001));
  }
});
