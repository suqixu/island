import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { heightAt } from '../src/terrain.js';

const boatsModule = await import('../src/models/sailboats.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const motionModule = await import('../src/sailboat-motion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const clear = { daylight: 1, fog: 0, rain: 0, storm: 0, moonLight: 0 };
function cameraFor(aspect = 1280 / 900, moon = false) {
  const camera = new THREE.PerspectiveCamera(moon ? 66 : aspect < 1 ? 54 : 46, aspect, .5, 65000);
  const scale = !moon && aspect < 1 ? 1.48 : 1;
  camera.position.set((moon ? 150 : 160) * scale, (moon ? 24 : 68) * scale, 200 * scale);
  camera.lookAt(0, moon ? 65 : 15, 0); camera.updateMatrixWorld(true);
  return camera;
}
function create(options = {}) {
  assert.equal(typeof boatsModule.createSailboats, 'function', '需要真实远海帆船模型与运动实现');
  return boatsModule.createSailboats(new THREE.Scene(), { heightAt, seed: 42, ...options });
}
const active = boats => boats.group.children.filter(ship => ship.visible && ship.userData.opacity > .15);
const activeModel = ship => ship.children.find(child => child.userData.style === ship.userData.route?.style);
function finish(boats, time, camera, env = clear, interval = .25) {
  for (let t = 0; t <= time + .000001; t += interval) boats.update(t, env, camera);
}

test('初帆十秒内进入桌面、手机和月夜实际远海画面，放大的完整轮廓安全入画', () => {
  for (const [aspect, moon] of [[1280 / 900, false], [390 / 844, false], [1280 / 900, true]]) {
    const boats = create(), camera = cameraFor(aspect, moon);
    finish(boats, 10, camera, { ...clear, daylight: moon ? 0 : 1, moonLight: moon ? 1 : 0 });
    const visible = active(boats);
    assert.ok(visible.length > 0 && visible.length <= 4, '远景初轮应可观察到一至四艘帆影');
    for (const ship of visible) {
      const model = activeModel(ship);
      assert.ok(model?.visible, '航程选择的船型必须有实际可见几何');
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
      assert.ok(size.y >= 12 && size.y <= 41, '远海船影放大后，短桅渔船与高桅帆船仍有不同尺寸');
      const route = ship.userData.route;
      assert.ok(route.length >= 16.8 && route.length <= 31.2);
      const hull = model.children[0].material;
      const sail = model.children.find(mesh => /帆$/.test(mesh.name))?.material;
      assert.ok(sail, '每种船型应保留可辨识的帆面');
      assert.ok(hull.opacity >= ship.userData.opacity * .95 && sail.opacity >= ship.userData.opacity * .95,
        '晴天船影淡入保留足够的轮廓对比');
      assert.equal(hull.fog, false, '远景船影只由天气渐隐控制，避免重复雾化');
      assert.ok(sail.color.r + sail.color.g + sail.color.b > hull.color.r + hull.color.g + hull.color.b + .25,
        '白天与月夜的浅色帆面都应与深色船体区分');
      const projectedHeights = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        projectedHeights.push(projected.y);
        assert.ok(Math.abs(projected.x) < .93 && projected.y > -.78 && projected.y < .8 && projected.z > -1 && projected.z < 1,
          '必须用整个船身、帆和桅杆入画，不能只投影中心点');
      }
      const pixels = (Math.max(...projectedHeights) - Math.min(...projectedHeights)) * (aspect < 1 ? 844 : 900) / 2;
      assert.ok(pixels > 9, '完整船影应在全岛远景中形成可观察的轮廓');
      assert.ok(Math.hypot(ship.position.x, ship.position.z) >= 600 && Math.hypot(ship.position.x, ship.position.z) <= 1300);
      assert.ok(heightAt(ship.position.x, ship.position.z) < -5);
    }
    boats.dispose();
  }
});

test('慢航按累计真实秒推进，帧率与小时倍速不改变航迹，同群船航速各异', () => {
  const fast = create(), slow = create(), camera = cameraFor();
  finish(fast, 30, camera, { ...clear, hour: 14, speed: 10 }, 1 / 60);
  finish(slow, 30, camera, { ...clear, hour: 1, speed: 1 }, 1);
  assert.ok(active(fast).length >= 2, '固定测试种子应显示不同航速的多船');
  assert.deepEqual(fast.group.children.map(ship => ship.userData.route), slow.group.children.map(ship => ship.userData.route));
  const speeds = new Set(active(fast).map(ship => ship.userData.route.speed));
  assert.ok(speeds.size > 1);
  for (let i = 0; i < fast.group.children.length; i++) {
    assert.ok(fast.group.children[i].position.distanceTo(slow.group.children[i].position) < .000001);
  }
  const ship = active(slow)[0], before = ship.position.clone(), heading = ship.rotation.y;
  slow.update(31, clear, camera);
  const travel = ship.position.clone().sub(before); travel.y = 0;
  assert.ok(travel.length() >= .2 && travel.length() <= .7, '一秒只缓慢前行，不可逐帧累加固定距离');
  assert.ok(travel.normalize().dot(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))) > .999);
  fast.dispose(); slow.dispose();
});

test('镜头转向不会把已经出现的帆影绑到画面或换航线，低质量保留帆船且复用资源', () => {
  const boats = create(), camera = cameraFor(); finish(boats, 12, camera);
  const visible = active(boats), previous = visible.map(ship => ({ ship, position: ship.position.clone(), route: ship.userData.route }));
  const geometries = [], materials = [];
  boats.group.traverse(object => { if (object.isMesh) { geometries.push(object.geometry); materials.push(object.material); } });
  camera.lookAt(600, 80, 800); camera.updateMatrixWorld(true);
  boats.setQuality('low'); boats.update(12.1, clear, camera);
  for (const { ship, position, route } of previous) {
    assert.equal(ship.userData.route, route);
    const delta = ship.position.clone().sub(position); delta.y = 0;
    assert.ok(delta.length() < .071);
    assert.equal(ship.visible, true, '已在远海的船不能因相机转向而突然消失或贴回画面');
  }
  const afterGeometries = [], afterMaterials = [];
  boats.group.traverse(object => { if (object.isMesh) { afterGeometries.push(object.geometry); afterMaterials.push(object.material); } });
  assert.deepEqual(afterGeometries, geometries); assert.deepEqual(afterMaterials, materials);
  boats.dispose();
});

test('安全检查覆盖整段计划航线和船身宽度，陆地、浅水及无有效高度不会生成船', () => {
  assert.equal(typeof motionModule.isSailboatRouteSafe, 'function');
  const route = { x: 800, z: 0, heading: 0, speed: .4, duration: 150, length: 10, beam: 2.6, height: 13 };
  assert.equal(motionModule.isSailboatRouteSafe(() => -30, route), true);
  assert.equal(motionModule.isSailboatRouteSafe((x, z) => x > 800.9 && x < 801.5 && z > 35 && z < 42 ? 2 : -30, route), false,
    '中途船舷会擦陆地，尽管起点、终点和整条中心线都是深水');
  assert.equal(motionModule.isSailboatRouteSafe(() => -2, route), false);
  assert.equal(motionModule.isSailboatRouteSafe(() => NaN, route), false);
  for (const bed of [() => 3, () => -2, () => NaN]) {
    const boats = create({ heightAt: bed }); finish(boats, 30, cameraFor());
    assert.equal(active(boats).length, 0); boats.dispose();
  }
});

test('远海船身和布帆的实际顶点全航程不落近岸或浅水，隔岛海域不能被当成可见帆影', () => {
  const boats = create(), camera = cameraFor(); boats.update(0, clear, camera);
  const voyages = boats.group.children.map(ship => ship.userData.route).filter(Boolean);
  assert.ok(voyages.length >= 2);
  const lastArrival = Math.max(...voyages.map(route => route.start + route.duration));
  const world = new THREE.Vector3();
  for (let time = 0; time <= lastArrival; time += 7) {
    boats.update(time, clear, camera); boats.group.updateWorldMatrix(true, true);
    for (const ship of boats.group.children.filter(item => item.userData.route)) activeModel(ship).traverse(mesh => {
      if (!mesh.isMesh) return;
      const vertices = mesh.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        world.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
        assert.ok(Math.hypot(world.x, world.z) >= 600 && Math.hypot(world.x, world.z) <= 1300,
          '检查真正船壳、斜帆和桅杆顶点，不能只保证航线中心远离岛屿');
        assert.ok(heightAt(world.x, world.z) < -5);
      }
    });
  }
  boats.dispose();
  // All candidate voyages are deep water, but a tall narrow foreground island
  // ridge crosses every viewing ray. A projection-only placement would show it.
  const blocked = create({ heightAt: (x, z) => z > 125 && z < 135 ? 100 : heightAt(x, z) });
  finish(blocked, 12, camera); assert.equal(active(blocked).length, 0); blocked.dispose();
});

test('三种预建船影轮廓各不相同，随机航程的真实全模型尺寸由计划包络覆盖', () => {
  const boats = create(), camera = cameraFor(), styles = new Set(), sizes = new Set();
  try {
    for (const ship of boats.group.children) {
      assert.deepEqual(ship.children.map(model => model.userData.style).sort(), ['fishing', 'sloop', 'traditional']);
      const sloop = ship.children.find(model => model.userData.style === 'sloop');
      const traditional = ship.children.find(model => model.userData.style === 'traditional');
      const fishing = ship.children.find(model => model.userData.style === 'fishing');
      assert.ok(sloop.getObjectByName('单桅三角帆'));
      assert.ok(traditional.getObjectByName('双桅横桁与帆骨') && traditional.getObjectByName('传统双四边帆'));
      assert.ok(fishing.getObjectByName('低矮渔船舱') && fishing.getObjectByName('渔船短桅小帆'));
    }
    for (let time = 0; time <= 1600; time += 2) {
      boats.update(time, clear, camera);
      for (const ship of boats.group.children.filter(ship => ship.userData.route)) {
        const route = ship.userData.route, model = activeModel(ship);
        assert.ok(model?.visible && ship.children.filter(child => child.visible).length === 1,
          '每个slot只显示航程指定的一种轮廓');
        assert.equal(ship.userData.style, route.style);
        styles.add(route.style); sizes.add(`${route.length}/${route.height}/${route.beam}`);
        model.updateMatrix(); const bounds = new THREE.Box3();
        for (const child of model.children) {
          child.geometry.computeBoundingBox();
          bounds.union(child.geometry.boundingBox.clone().applyMatrix4(model.matrix));
        }
        const size = bounds.getSize(new THREE.Vector3());
        assert.ok(size.x <= route.beam + .00001 && size.z <= route.length + .00001 && bounds.max.y <= route.height + .00001,
          '横桁、舱顶、艏杆均必须计入真实航线包络');
        assert.ok(Math.abs(size.x - route.beam) < .00001 && Math.abs(size.z - route.length) < .00001);
        assert.ok(route.height >= (route.style === 'fishing' ? 13.2 : 24) && route.height <= 38.4);
      }
    }
    assert.deepEqual([...styles].sort(), ['fishing', 'sloop', 'traditional']);
    assert.ok(sizes.size > 8, '每轮真实船长、桅高及船宽独立变化');
  } finally { boats.dispose(); }
});

test('船型只在航程彻底淡出后切换，低画质也保留所有预建轮廓而不新增资源', () => {
  const boats = create(), camera = cameraFor(), previous = new Map(), geometries = new Set(), materials = new Set();
  boats.group.traverse(mesh => { if (mesh.isMesh) { geometries.add(mesh.geometry); materials.add(mesh.material); } });
  let changes = 0;
  try {
    boats.setQuality('low');
    for (let time = 0; time <= 1600; time += .5) {
      boats.update(time, clear, camera);
      for (const ship of boats.group.children) {
        const prior = previous.get(ship);
        if (prior && prior.style !== ship.userData.style) {
          assert.equal(prior.opacity, 0, '不能在可见期间更换桅杆、帆型或船舱'); changes++;
        }
        previous.set(ship, { style: ship.userData.style, opacity: ship.userData.opacity });
        const model = activeModel(ship);
        if (ship.visible) assert.ok(model?.visible && model.children.some(mesh => mesh.visible && mesh.isMesh));
      }
    }
    boats.setQuality('high');
    boats.group.traverse(mesh => { if (mesh.isMesh) {
      assert.ok(geometries.has(mesh.geometry) && materials.has(mesh.material), '更新与船型切换不能重建GPU资源');
    } });
    assert.ok(changes >= 3);
  } finally { boats.dispose(); }
});

test('跨轮数量和远海位置变化，船完全淡出后才换位，天气渐隐且夜间不关闭', () => {
  const boats = create(), camera = cameraFor(), counts = new Set(), cohortCounts = new Set(), routes = new Set();
  const previous = new Map(); let firstPosition, laterFar = false;
  for (let time = 0; time <= 1100; time += .5) {
    boats.update(time, clear, camera); counts.add(active(boats).length);
    cohortCounts.add(boats.group.children.filter(ship => ship.userData.route).length);
    for (const ship of boats.group.children) {
      const before = previous.get(ship);
      if (before && before.route !== ship.userData.route && ship.userData.route) {
        assert.equal(before.opacity, 0, '不能把未淡出的帆船直接传送到下一处海域');
      }
      if (ship.userData.opacity > .5) {
        routes.add(ship.userData.route);
        if (!firstPosition) firstPosition = ship.position.clone();
        if (ship.position.distanceTo(firstPosition) > 100) laterFar = true;
      }
      previous.set(ship, { route: ship.userData.route, opacity: ship.userData.opacity });
    }
  }
  assert.ok(counts.has(0) && [...counts].some(count => count > 1) && counts.size >= 3);
  assert.ok(cohortCounts.size >= 3, '不同轮的成员数量要变化，而非仅由淡入时机制造数量变化');
  assert.ok(routes.size > 4 && laterFar, '不同轮需要换数量与海域');
  boats.dispose();
  const weather = create(); finish(weather, 12, camera, { ...clear, daylight: 0, moonLight: 1 });
  const ship = active(weather)[0], oldOpacity = ship.userData.opacity;
  weather.update(12 + 1 / 60, { ...clear, fog: 1, storm: 1 }, camera);
  assert.ok(ship.userData.opacity > oldOpacity * .9, '海雾变化不能在一帧关闭帆影');
  for (let t = 12.1; t <= 20; t += .1) weather.update(t, { ...clear, fog: 1, storm: 1 }, camera);
  assert.ok(ship.userData.opacity < .01);
  weather.dispose();
});

test('共享帆船几何、各船淡入材质只销毁一次，移出场景后更新不再分配资源', () => {
  const scene = new THREE.Scene();
  assert.equal(typeof boatsModule.createSailboats, 'function');
  const boats = boatsModule.createSailboats(scene, { heightAt, seed: 42 }), resources = new Set(), disposed = new Map();
  boats.group.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) resources.add(material);
  });
  for (const resource of resources) {
    disposed.set(resource, 0); resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  }
  boats.dispose(); boats.dispose(); boats.update(300, clear, cameraFor());
  assert.equal(scene.children.length, 0); assert.equal(boats.group.children.length, 0);
  assert.ok(resources.size > 0 && [...disposed.values()].every(count => count === 1));
});
