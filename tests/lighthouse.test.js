import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Catches a missing feature without making the suite stop during module loading.
const lighthouse = await import('../src/lighthouse.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const create = options => {
  assert.equal(typeof lighthouse.createLighthouse, 'function', '应提供可接入海岛场景的灯塔');
  const parent = new THREE.Group();
  const tower = lighthouse.createLighthouse(parent, {
    heightAt: () => 12, position: { x: 10, z: -4 }, doorDirection: { x: .8, z: .6 }, ...options,
  });
  const meshes = [], lights = [];
  tower.group.traverse(object => {
    if (object.isMesh) meshes.push(object);
    if (object.isPointLight) lights.push(object);
  });
  return { parent, tower, meshes, lights };
};

test('小石基逐点落入真实坡面，平台在最高地表之上且不扩大成山顶平板', () => {
  // A flat-bottom cylinder would float above the downslope side of this fixture.
  const heightAt = (x, z) => 12 + .48 * (x - 10) - .31 * (z + 4);
  const { tower } = create({ heightAt });
  tower.group.updateWorldMatrix(true, true);
  const base = tower.group.getObjectByName('灯塔贴坡石基');
  assert.ok(base?.isMesh);
  const position = base.geometry.attributes.position, world = new THREE.Vector3();
  const columns = new Map();
  for (let index = 0; index < position.count; index++) {
    world.fromBufferAttribute(position, index).applyMatrix4(base.matrixWorld);
    const radius = Math.hypot(world.x - 10, world.z + 4);
    assert.ok(radius <= 2.201, '平台半径应控制在 2.2 米内');
    if (radius < 2) continue;
    const key = `${world.x.toFixed(4)},${world.z.toFixed(4)}`;
    const previous = columns.get(key);
    if (!previous || world.y < previous.y) columns.set(key, world.clone());
  }
  assert.ok(columns.size >= 48, '地基应细分采样真实山坡');
  for (const point of columns.values()) {
    const gap = point.y - heightAt(point.x, point.z);
    assert.ok(gap <= .001 && gap >= -.09, `石基底部不能悬空: ${gap}`);
  }
  const levels = [...columns.values()].map(point => point.y);
  assert.ok(Math.max(...levels) - Math.min(...levels) > 2, '坡面基座不能退化为平底');
  assert.ok(tower.group.position.y > Math.max(...levels) && tower.group.position.y < Math.max(...levels) + .3);
  tower.dispose();
});

test('塔体有真实门窗、灯室、圆形栏杆与菲涅尔镜，比例约十四米且门朝向入口', () => {
  const { tower, meshes } = create();
  tower.group.updateWorldMatrix(true, true);
  const architecture = tower.group.getObjectByName('灯塔建筑');
  assert.ok(architecture);
  const bounds = new THREE.Box3().setFromObject(architecture);
  assert.ok(bounds.max.y - tower.group.position.y >= 12 && bounds.max.y - tower.group.position.y <= 14.5);
  const physical = new THREE.Box3(), vertex = new THREE.Vector3();
  architecture.traverse(object => {
    if (!object.isMesh) return;
    const p = object.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) physical.expandByPoint(vertex.fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld));
  });
  assert.ok(physical.max.x - physical.min.x < 4.5);
  assert.ok(meshes.length < 70, '栏杆等重复细节应合并以控制绘制量');
  const door = tower.group.getObjectByName('灯塔木门');
  const normal = door.getWorldDirection(new THREE.Vector3());
  assert.ok(normal.x * .8 + normal.z * .6 > .999, '木门正面应朝向给定进路');
  assert.ok(tower.group.getObjectByName('灯塔窗玻璃'));
  assert.ok(tower.group.getObjectByName('灯塔圆形栏杆'));
  const glass = tower.group.getObjectByName('灯塔灯室玻璃');
  assert.ok(glass?.material.transparent && glass.material.opacity < .6);
  assert.ok(tower.group.getObjectByName('灯塔菲涅尔镜'));
  tower.dispose();
});

test('暖灯由daylight平滑控制，白天关闭、夜间亮起且异常输入不会闪灯', () => {
  assert.equal(typeof lighthouse.getLighthouseLampStrength, 'function');
  const getStrength = lighthouse.getLighthouseLampStrength;
  assert.equal(getStrength(1), 0); assert.equal(getStrength(0), 1);
  assert.equal(getStrength(NaN), 0); assert.equal(getStrength(), 0);
  assert.equal(getStrength(2), 0); assert.equal(getStrength(-1), 1);
  assert.ok(getStrength(.2) > 0 && getStrength(.2) < 1);
  let previous = 1;
  for (let daylight = 0; daylight <= 1; daylight += .001) {
    const value = getStrength(daylight);
    assert.ok(value >= 0 && value <= previous);
    assert.ok(previous - value < .012, '暮色中的灯光应逐渐亮起');
    previous = value;
  }
  const { tower, lights } = create();
  assert.equal(lights.length, 1);
  assert.ok(lights[0].distance > 0 && lights[0].distance <= 22);
  assert.equal(lights[0].castShadow, false);
  tower.update(5, { daylight: 0 });
  assert.ok(lights[0].intensity > 0 && lights[0].visible);
  assert.ok(lights[0].color.r > lights[0].color.g && lights[0].color.g > lights[0].color.b);
  tower.update(6, { daylight: 1 });
  assert.equal(lights[0].intensity, 0); assert.equal(lights[0].visible, false);
  tower.dispose();
});

test('两束扫光二十至三十秒一圈且跨周期连续，透明光束由实体遮挡', () => {
  const { tower, meshes } = create();
  const beams = meshes.filter(mesh => mesh.name.startsWith('灯塔柔和扫光'));
  assert.equal(beams.length, 2);
  for (const beam of beams) {
    assert.ok(beam.material.isShaderMaterial);
    assert.equal(beam.material.transparent, true);
    assert.equal(beam.material.depthWrite, false);
    assert.equal(beam.material.depthTest, true);
    assert.equal(beam.material.blending, THREE.AdditiveBlending);
  }
  const rotor = tower.group.getObjectByName('灯塔旋转扫光');
  tower.update(0, { daylight: 0 }); const start = rotor.rotation.y;
  tower.update(26, { daylight: 0 }); const end = rotor.rotation.y;
  assert.ok(Math.abs(end - start - Math.PI * 2) < 1e-8);
  tower.update(25.999, { daylight: 0 }); const before = rotor.rotation.y;
  tower.update(26.001, { daylight: 0 });
  assert.ok(rotor.rotation.y > before && rotor.rotation.y - before < .001);
  tower.update(30, { daylight: 1 }); assert.ok(beams.every(beam => !beam.visible));
  tower.dispose();
});

test('低画质保留夜灯与扫光，昼夜更新不重建模型或材质', () => {
  const { tower, meshes, lights } = create();
  const geometries = meshes.map(mesh => mesh.geometry), materials = meshes.map(mesh => mesh.material);
  tower.update(1, { daylight: 0 }); const full = lights[0].intensity;
  for (const quality of ['low', 'medium', 'high']) {
    tower.setQuality(quality); tower.update(10, { daylight: 0, quality });
    assert.equal(lights[0].intensity, full);
    assert.ok(meshes.filter(mesh => mesh.name.startsWith('灯塔柔和扫光')).every(mesh => mesh.visible));
  }
  assert.deepEqual(meshes.map(mesh => mesh.geometry), geometries);
  assert.deepEqual(meshes.map(mesh => mesh.material), materials);
  tower.dispose();
});

test('入口短石阶贴合实际地形，每级升高不超过二十厘米并接到给定山路', () => {
  // Catches a floating slab ramp, an over-high riser, or stairs ending short of the approach.
  const heightAt = x => x * .24;
  const { tower } = create({ heightAt, position: { x: 0, z: 0 }, doorDirection: { x: 1, z: 0 },
    approach: { x: 6, y: 1.478, z: 0 } });
  tower.group.updateWorldMatrix(true, true);
  const steps = [];
  tower.group.traverse(object => { if (object.name.startsWith('灯塔入口石阶')) steps.push(object); });
  assert.ok(steps.length >= 4);
  const boxes = steps.map(step => new THREE.Box3().setFromObject(step)).sort((a, b) => a.min.x - b.min.x);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.max.y >= heightAt(box.max.x) - .002, '台阶顶部不能被坡面吞没');
    if (index) assert.ok(Math.abs(box.max.y - boxes[index - 1].max.y) <= .2001);
  }
  assert.ok(Math.abs(boxes.at(-1).max.x - 6) < .03 && Math.abs(boxes.at(-1).max.y - 1.478) < .06);
  tower.dispose();
});

test('dispose移除模型与灯光并只释放一次独占资源，释放后更新不复活夜灯', () => {
  const { parent, tower, meshes, lights } = create();
  tower.update(2, { daylight: 0 });
  const resources = new Set();
  for (const mesh of meshes) {
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material);
  }
  const disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  tower.dispose(); tower.dispose(); tower.update(9, { daylight: 0 }); tower.setQuality('low');
  assert.ok([...disposed.values()].every(count => count === 1));
  assert.equal(parent.children.length, 0); assert.equal(tower.group.children.length, 0);
  assert.ok(lights.every(light => light.intensity === 0 && !light.visible));
});


test('真实西侧山顶入口所有踏面露出横坡，阶梯连续且每级可正常行走', async () => {
  // Catches production terrain cuts, inter-step gaps, and too-steep summit stairs missed by a gentle fixture.
  const { LIGHTHOUSE_SITE } = await import('../src/lighthouse-layout.js');
  const { getIslandPathLayout } = await import('../src/path-layout.js');
  const { CAVE_LAYOUT } = await import('../src/cave-layout.js');
  const heightAt = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach }).heightAtRendered;
  const { tower } = create({ ...LIGHTHOUSE_SITE, heightAt });
  tower.group.updateWorldMatrix(true, true);
  const steps = [], point = new THREE.Vector3();
  tower.group.traverse(object => { if (object.name.startsWith('灯塔入口石阶')) steps.push(object); });
  assert.ok(steps.length > 0, '实际山顶应有可接入的入口石阶');
  let previousTop = tower.group.position.y, previousEnd;
  for (const step of steps) {
    const p = step.geometry.attributes.position, corners = [];
    // The four top-face vertices are the rendered footprint of each individual step.
    for (let i = 0; i < 4; i++) corners.push(point.fromBufferAttribute(p, i).applyMatrix4(step.matrixWorld).clone());
    const top = corners[0].y;
    assert.ok(top - previousTop >= -.001 && top - previousTop <= .2001, '真实地形上的步高不能超过 0.2 米');
    const front = corners[0].clone().add(corners[3]).multiplyScalar(.5);
    const back = corners[1].clone().add(corners[2]).multiplyScalar(.5);
    assert.ok(Math.hypot(back.x - front.x, back.z - front.z) >= .279, '踏步深度不能小于 0.28 米');
    if (previousEnd) {
      for (let i = 0; i < 2; i++) assert.ok(Math.hypot(corners[i === 0 ? 0 : 3].x - previousEnd[i].x,
        corners[i === 0 ? 0 : 3].z - previousEnd[i].z) < .001, '弯道石阶边界应连续而不留下缝隙');
    }
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const u = i / 8, v = j / 8;
      const a = corners[0].clone().lerp(corners[1], u), b = corners[3].clone().lerp(corners[2], u);
      const sample = a.lerp(b, v);
      assert.ok(top - heightAt(sample.x, sample.z) >= .019, '包括横坡边缘在内的踏面都应露出地表');
    }
    previousEnd = [corners[1], corners[2]]; previousTop = top;
  }
  assert.ok(Math.abs(previousTop - LIGHTHOUSE_SITE.approach.y) < .1, '入口末级应衔接现有山路');
  tower.dispose();
});

test('平台到木门的门槛也保持正常步高，门前不会被连续石圈挡住', () => {
  const { tower } = create();
  tower.group.updateWorldMatrix(true, true);
  const door = tower.group.getObjectByName('灯塔木门');
  const bounds = new THREE.Box3().setFromObject(door);
  assert.ok(bounds.min.y - tower.group.position.y <= .2001, '最后一段门槛也不能形成过高台阶');
  const normal = door.getWorldDirection(new THREE.Vector3());
  const origin = door.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, 3);
  origin.y = bounds.min.y + .1;
  const architecture = tower.group.getObjectByName('灯塔建筑');
  const hits = new THREE.Raycaster(origin, normal.negate(), 0, 4).intersectObject(architecture, true);
  assert.equal(hits[0]?.object.name, '灯塔木门', '木门底部应有真正入口而非被塔脚石圈遮挡');
  tower.dispose();
});

async function productionTower() {
  const { LIGHTHOUSE_SITE } = await import('../src/lighthouse-layout.js');
  const { getIslandPathLayout } = await import('../src/path-layout.js');
  const { CAVE_LAYOUT } = await import('../src/cave-layout.js');
  const heightAt = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach }).heightAtRendered;
  return { ...create({ ...LIGHTHOUSE_SITE, heightAt }), heightAt };
}

function largestBottomEdgeGap(mesh, pairs, heightAt) {
  const positions = mesh.geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), point = new THREE.Vector3();
  let largest = -Infinity;
  for (const [ia, ib] of pairs) {
    a.fromBufferAttribute(positions, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions, ib).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i <= 128; i++) {
      point.copy(a).lerp(b, i / 128);
      largest = Math.max(largest, point.y - heightAt(point.x, point.z));
    }
  }
  return largest;
}

test('真实地形上的圆形石基外缘底边连续入土，跨网格三角面不露悬缝', async () => {
  // Catches a chord between sampled foot points passing above the concave rendered terrain.
  const { tower, heightAt } = await productionTower();
  tower.group.updateWorldMatrix(true, true);
  const base = tower.group.getObjectByName('灯塔贴坡石基'), pairs = [];
  // Each wall quad is followed by its three-vertex platform cap triangle.
  for (let i = 0; i < base.geometry.attributes.position.count; i += 7) pairs.push([i, i + 1]);
  const gap = largestBottomEdgeGap(base, pairs, heightAt);
  tower.dispose();
  assert.ok(gap <= .001, `石基外缘真实地表悬缝为 ${(gap * 100).toFixed(2)} cm`);
});

test('真实入口石阶两侧外露底边连续入土，不能只让四个角落地', async () => {
  // Catches side-wall bottom chords floating above terrain between grounded corners.
  const { tower, heightAt } = await productionTower();
  tower.group.updateWorldMatrix(true, true);
  const steps = [];
  tower.group.traverse(object => { if (object.name.startsWith('灯塔入口石阶')) steps.push(object); });
  assert.ok(steps.length > 0);
  let gap = -Infinity;
  for (const step of steps) {
    // The top quad has 4 vertices; longitudinal side quads 0 and 2 follow.
    gap = Math.max(gap, largestBottomEdgeGap(step, [[4, 5], [12, 13]], heightAt));
  }
  tower.dispose();
  assert.ok(gap <= .001, `石阶纵向侧边真实地表悬缝为 ${(gap * 100).toFixed(2)} cm`);
});
