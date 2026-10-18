import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSailboats } from '../src/models/sailboats.js';
import { heightAt } from '../src/terrain.js';

const day = { daylight: 1, fog: 0, rain: 0, storm: 0, sunDirection: new THREE.Vector3(0, 1, 0) };
const sunset = { ...day, daylight: .3, sunDirection: new THREE.Vector3(-.4, .08, -1).normalize(),
  sunBackdropDirection: new THREE.Vector3(-.4, .08, -1).normalize() };
function cameraFor() {
  const camera = new THREE.PerspectiveCamera(46, 1280 / 900, .5, 65000);
  camera.position.set(160, 68, 200); camera.lookAt(0, 15, 0); camera.updateMatrixWorld(true); return camera;
}
function setup(options) {
  const camera = cameraFor(), boats = createSailboats(new THREE.Scene(), { heightAt, seed: 42, ...options });
  for (let time = 0; time <= 12; time += .5) boats.update(time, day, camera);
  return { boats, camera };
}
const headingDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const horizontal = ship => new THREE.Vector3(ship.position.x, 0, ship.position.z);
function changedBoats(boats) {
  return boats.group.children.filter(ship => ship.userData.route &&
    Math.abs(headingDelta(ship.rotation.y, ship.userData.route.heading)) > .1);
}

test('落日只引导合适的远海船影从当前航位慢转驶向触发时的落日方位', () => {
  const { boats, camera } = setup();
  try {
    const before = boats.group.children.map(ship => ({ position: horizontal(ship), heading: ship.rotation.y, route: ship.userData.route }));
    boats.update(12, sunset, camera);
    for (const [index, ship] of boats.group.children.entries()) {
      assert.ok(horizontal(ship).distanceTo(before[index].position) < 1e-9, '触发时不能移动或瞬间掉头');
      assert.equal(ship.rotation.y, before[index].heading);
    }
    for (let time = 12.25; time <= 112; time += .25) {
      const previous = boats.group.children.map(ship => ({ position: horizontal(ship), heading: ship.rotation.y }));
      boats.update(time, sunset, camera);
      for (const [index, ship] of boats.group.children.entries()) {
        if (!ship.userData.route) continue;
        assert.ok(horizontal(ship).distanceTo(previous[index].position) <= .18, '慢航不能因转弯而跳位');
        assert.ok(Math.abs(headingDelta(ship.rotation.y, previous[index].heading)) <= .012, '航向连续而非瞬时转向');
        assert.equal(ship.userData.route, before[index].route, '保留原船型和航程对象');
      }
    }
    const turning = changedBoats(boats);
    assert.ok(turning.length >= 1 && turning.length < 3, '仅挑选合适远船，不让全部帆影整齐转向');
    const target = camera.position.clone().addScaledVector(sunset.sunBackdropDirection, 5000); target.y = 0;
    for (const ship of turning) {
      const beforeMove = horizontal(ship), toward = target.clone().sub(beforeMove).normalize();
      boats.update(113, sunset, camera);
      const movement = horizontal(ship).sub(beforeMove);
      assert.ok(movement.length() > .15 && movement.length() < .7);
      assert.ok(movement.normalize().dot(toward) > .97, '最终位移朝落日对应的远海点，而非继续横穿');
    }
  } finally { boats.dispose(); }
});

test('落日航向冻结在世界坐标，转镜头和移动太阳构图不改变已触发的航迹', () => {
  const a = setup(), b = setup();
  try {
    a.boats.update(12, sunset, a.camera); b.boats.update(12, sunset, b.camera);
    b.camera.position.set(-200, 90, 100); b.camera.lookAt(800, 30, 1000); b.camera.updateMatrixWorld(true);
    const shifted = { ...sunset, sunBackdropDirection: new THREE.Vector3(1, .08, 0).normalize() };
    for (let time = 12.5; time <= 100; time += .5) {
      a.boats.update(time, sunset, a.camera); b.boats.update(time, shifted, b.camera);
    }
    assert.ok(changedBoats(a.boats).length > 0, '需要实际发生落日航行才能检验冻结');
    a.boats.group.children.forEach((ship, index) => {
      assert.ok(ship.position.distanceTo(b.boats.group.children[index].position) < 1e-8);
      assert.equal(ship.rotation.y, b.boats.group.children[index].rotation.y);
    });
  } finally { a.boats.dispose(); b.boats.dispose(); }
});

test('落日结束后从当前航位平滑恢复原航向，白天、深夜、坏天气和缺方向不会启航', () => {
  const { boats, camera } = setup();
  try {
    for (let time = 12; time <= 95; time += .5) boats.update(time, sunset, camera);
    const turning = changedBoats(boats); assert.ok(turning.length > 0);
    const previous = new Map(turning.map(ship => [ship, horizontal(ship)]));
    boats.update(95.1, day, camera);
    for (const ship of turning) assert.ok(horizontal(ship).distanceTo(previous.get(ship)) < .07);
    for (let time = 95.5; time <= 160; time += .5) boats.update(time, day, camera);
    for (const ship of turning) assert.ok(Math.abs(headingDelta(ship.rotation.y, ship.userData.route.heading)) < 1e-8);
  } finally { boats.dispose(); }
  for (const env of [day, { ...sunset, daylight: 0 }, { ...sunset, fog: 1 }, { ...sunset, sunBackdropDirection: null }]) {
    const pair = setup();
    try {
      for (let time = 12; time <= 100; time += 1) pair.boats.update(time, env, pair.camera);
      assert.equal(changedBoats(pair.boats).length, 0);
    } finally { pair.boats.dispose(); }
  }
});

test('整段落日转弯及恢复过程的真实船壳和帆顶保持远海深水，转向不分配GPU资源', () => {
  const { boats, camera } = setup(), resources = new Set(), disposed = new Map();
  boats.group.traverse(mesh => {
    if (mesh.geometry) resources.add(mesh.geometry);
    if (mesh.material) resources.add(mesh.material);
  });
  for (const resource of resources) { disposed.set(resource, 0); resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1)); }
  const vertex = new THREE.Vector3();
  for (let time = 12; time <= 210; time += 1) {
    boats.update(time, time < 120 ? sunset : day, camera); boats.group.updateWorldMatrix(true, true);
    for (const ship of boats.group.children.filter(ship => ship.userData.route)) {
      const model = ship.children.find(child => child.visible);
      model.traverse(mesh => {
        if (!mesh.isMesh) return;
        assert.ok(resources.has(mesh.geometry) && resources.has(mesh.material));
        const positions = mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index++) {
          vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          const radius = Math.hypot(vertex.x, vertex.z);
          assert.ok(radius >= 600 && radius <= 1300, '转弯后的完整帆影仍在远海包络');
          assert.ok(heightAt(vertex.x, vertex.z) < -5, '转弯航迹不能擦岸或穿岛');
        }
      });
    }
  }
  boats.dispose(); boats.dispose();
  assert.ok([...disposed.values()].every(count => count === 1));
});

test('转弯扫过原航线之外的浅水时拒绝落日航行并保留原来的安全慢航', () => {
  let routes = null;
  const corridorsOnly = (x, z) => {
    if (!routes) return heightAt(x, z);
    return routes.some(route => {
      const dx = x - route.x, dz = z - route.z;
      const along = dx * Math.sin(route.heading) + dz * Math.cos(route.heading);
      const side = dx * Math.cos(route.heading) - dz * Math.sin(route.heading);
      return Math.abs(side) < route.beam / 2 + 2.5 && along > -route.length / 2 - 3 &&
        along < route.speed * route.duration + route.length / 2 + 3;
    }) ? -30 : 2;
  };
  const { boats, camera } = setup({ heightAt: corridorsOnly });
  try {
    routes = boats.group.children.map(ship => ship.userData.route).filter(Boolean);
    assert.ok(routes.length >= 2);
    for (let time = 12; time <= 120; time += 1) boats.update(time, sunset, camera);
    assert.equal(changedBoats(boats).length, 0, '有深水起点不足以允许驶出安全航道');
    for (const ship of boats.group.children.filter(ship => ship.userData.route)) {
      const route = ship.userData.route;
      assert.ok(Math.abs(ship.position.x - route.x - Math.sin(route.heading) * route.speed * (120 - route.start)) < 1e-8);
      assert.ok(Math.abs(ship.position.z - route.z - Math.cos(route.heading) * route.speed * (120 - route.start)) < 1e-8);
    }
  } finally { boats.dispose(); }
});

test('落日转弯和返回路径按累计秒解析推进，与更新帧率无关', () => {
  const a = setup(), b = setup();
  try {
    a.boats.update(12, sunset, a.camera); b.boats.update(12, sunset, b.camera);
    for (let time = 12.25; time <= 90; time += .25) a.boats.update(time, sunset, a.camera);
    for (let time = 14; time <= 90; time += 2) b.boats.update(time, sunset, b.camera);
    for (let time = 90.25; time <= 160; time += .25) a.boats.update(time, day, a.camera);
    b.boats.update(90.25, day, b.camera);
    for (let time = 92; time <= 160; time += 2) b.boats.update(time, day, b.camera);
    a.boats.group.children.forEach((ship, index) => {
      const other = b.boats.group.children[index];
      assert.ok(ship.position.distanceTo(other.position) < 1e-8);
      assert.ok(Math.abs(headingDelta(ship.rotation.y, other.rotation.y)) < 1e-8);
    });
  } finally { a.boats.dispose(); b.boats.dispose(); }
});
