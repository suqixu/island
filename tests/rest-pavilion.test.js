import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const module = await import('../src/rest-pavilion.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createRestPavilion, 'function', '应提供可接入山路的开放木亭');
  const parent = new THREE.Group();
  const pavilion = module.createRestPavilion(parent, {
    heightAt: () => 12, position: { x: 4, z: -9 }, entranceDirection: { x: 0, z: 1 }, ...options,
  });
  const meshes = [], lights = [];
  pavilion.group.traverse(object => { if (object.isMesh) meshes.push(object); if (object.isPointLight) lights.push(object); });
  return { parent, pavilion, meshes, lights };
};
const namedObjects = (group, name) => {
  const objects = []; group.traverse(object => { if (object.name === name) objects.push(object); }); return objects;
};

test('架空木台由四支木柱落到实际坡面，薄木地板留在地表上', () => {
  // Catches a solid masonry plinth, suspended pole feet, or a thin deck cutting into the uphill ground.
  const heightAt = (x, z) => 12 + .20 * (x - 4) - .12 * (z + 9);
  const { pavilion } = create({ heightAt });
  pavilion.group.updateWorldMatrix(true, true);
  assert.ok(!pavilion.group.getObjectByName('山亭贴坡石基'), '不得保留实体石墩');
  const base = pavilion.group.getObjectByName('山亭架空木台地板'), support = pavilion.group.getObjectByName('山亭贴坡支承木柱');
  assert.ok(base?.isMesh && support?.isMesh);
  const floorBounds = new THREE.Box3().setFromObject(base), floorTop = floorBounds.max.y;
  assert.ok(floorBounds.max.y - floorBounds.min.y <= .2, '架空木台应是薄木地板');
  const p = support.geometry.attributes.position, normals = support.geometry.attributes.normal, point = new THREE.Vector3();
  const feet = [];
  for (let i = 0; i < p.count; i++) if (normals.getY(i) < -.9) feet.push(point.fromBufferAttribute(p, i).applyMatrix4(support.matrixWorld).clone());
  assert.ok(feet.length > 20, '需要验证每根木柱真实底面而非中心虚点');
  for (const foot of feet) assert.ok(foot.y <= heightAt(foot.x, foot.z) + .001 && foot.y >= heightAt(foot.x, foot.z) - .24);
  assert.ok(Math.max(...feet.map(point => point.y)) - Math.min(...feet.map(point => point.y)) > .8);
  for (let x = 2.5; x <= 5.5; x += .15) for (let z = -10.5; z <= -7.5; z += .15) {
    assert.ok(floorTop - heightAt(x, z) > .045, '亭内地板不能穿过山坡');
  }
  const posts = pavilion.group.getObjectByName('山亭旧木柱');
  const postBounds = new THREE.Box3().setFromObject(posts);
  assert.ok(postBounds.min.y >= floorTop && postBounds.min.y - floorTop < .19, '屋柱应对齐落在木台承柱上');
  pavilion.dispose();
});

test('亭内有靠边可坐长凳、真实柱梁和灰瓦弧顶，正门留出完整通道', () => {
  // Catches a closed facade, a bench across the doorway, or a low beam blocking a standing walker.
  const { pavilion, meshes } = create();
  pavilion.group.updateWorldMatrix(true, true);
  assert.ok(pavilion.group.getObjectByName('山亭靠边长凳'));
  assert.ok(pavilion.group.getObjectByName('山亭木梁与斜撑'));
  const roof = pavilion.group.getObjectByName('山亭弧瓦屋顶');
  assert.ok(roof?.isMesh);
  const roofBounds = new THREE.Box3().setFromObject(roof);
  assert.ok(roofBounds.max.y - pavilion.group.position.y > 3 && roofBounds.max.y - pavilion.group.position.y < 4.1);
  assert.ok(roofBounds.max.x - roofBounds.min.x > 3.4 && roofBounds.max.x - roofBounds.min.x < 4.1);
  for (const x of [-.45, 0, .45]) {
    const start = new THREE.Vector3(4 + x, pavilion.group.position.y + 1.25, -6.4);
    const hits = new THREE.Raycaster(start, new THREE.Vector3(0, 0, -1), 0, 2.7).intersectObjects(meshes, false);
    assert.equal(hits.length, 0, '进入亭子的站立通道应开放');
  }
  assert.ok(meshes.length < 45, '重复柱梁和瓦纹应合并以控制绘制量');
  pavilion.dispose();
});

test('给定进路与亭门能走通，每级石阶贴地且不留下高门槛', () => {
  // Catches a suspended approach ramp, buried tread, or a tall step at the pavilion threshold.
  const heightAt = x => .12 * x;
  const { pavilion } = create({ heightAt, position: { x: 0, z: 0 }, entranceDirection: { x: 1, z: 0 },
    approach: { x: 4, y: .518, z: 0 } });
  pavilion.group.updateWorldMatrix(true, true);
  const steps = [];
  pavilion.group.traverse(object => { if (object.name.startsWith('山亭入口石阶')) steps.push(object); });
  assert.ok(steps.length > 0, '地板与现有山路之间应有低石阶');
  let previous = pavilion.group.position.y;
  const sample = new THREE.Vector3();
  for (const step of steps) {
    const p = step.geometry.attributes.position, corners = [];
    for (let i = 0; i < 4; i++) corners.push(sample.fromBufferAttribute(p, i).applyMatrix4(step.matrixWorld).clone());
    const top = corners[0].y;
    assert.ok(Math.abs(top - previous) <= .2001, '入口步高应适合正常行走');
    for (const corner of corners) assert.ok(top >= heightAt(corner.x, corner.z) + .018);
    previous = top;
  }
  assert.ok(Math.abs(previous - .518) < .05);
  pavilion.dispose();
});

test('暖灯从白天到夜晚平滑亮起，局部照明不照亮整座山且低画质仍亮', () => {
  assert.equal(typeof module.getRestPavilionLampStrength, 'function');
  const strength = module.getRestPavilionLampStrength;
  assert.equal(strength(1), 0); assert.equal(strength(0), 1);
  assert.equal(strength(NaN), 0); assert.equal(strength(), 0);
  assert.ok(strength(.2) > 0 && strength(.2) < 1);
  let previous = 1;
  for (let value = 0; value <= 1; value += .001) {
    const next = strength(value); assert.ok(next <= previous && previous - next < .012); previous = next;
  }
  const { pavilion, lights, meshes } = create();
  assert.equal(lights.length, 1); assert.ok(lights[0].distance > 0 && lights[0].distance <= 10);
  assert.equal(lights[0].castShadow, false);
  const glow = pavilion.group.getObjectByName('山亭暖灯芯');
  pavilion.update(0, { daylight: 1 }); assert.equal(lights[0].intensity, 0); assert.equal(glow.material.emissiveIntensity, 0);
  pavilion.update(1, { daylight: 0 }); const full = lights[0].intensity;
  assert.ok(full > 0 && glow.material.emissiveIntensity > 1);
  const resources = meshes.map(mesh => [mesh.geometry, mesh.material]);
  for (const quality of ['low', 'medium', 'high']) {
    pavilion.setQuality(quality); pavilion.update(2, { daylight: 0, quality });
    assert.equal(lights[0].intensity, full); assert.equal(lights[0].visible, true);
  }
  assert.deepEqual(meshes.map(mesh => [mesh.geometry, mesh.material]), resources);
  pavilion.dispose();
});

test('现有冬季及降雪环境让瓦顶积雪，回暖渐消且不重建屋顶资源', () => {
  // Catches ignoring production seasonIndex/snow fields, or instant snow popping on season change.
  const { pavilion } = create();
  const snow = pavilion.group.getObjectByName('山亭屋顶积雪');
  assert.ok(snow?.isMesh);
  const geometry = snow.geometry, material = snow.material;
  pavilion.update(0, { season: 'summer', snow: 0, daylight: 1 }); assert.equal(snow.visible, false);
  let previous = 0;
  for (let step = 1; step <= 30; step++) {
    pavilion.update(step / 10, { seasonIndex: 3, snow: 0, daylight: 1 });
    assert.ok(snow.material.opacity >= previous && snow.material.opacity - previous < .18); previous = snow.material.opacity;
  }
  assert.ok(snow.visible && snow.material.opacity > .6);
  pavilion.update(3.1, { season: 'summer', snow: 0, daylight: 1 });
  assert.ok(snow.material.opacity < previous && snow.material.opacity > previous - .18);
  for (let time = 3.2; time <= 10; time += .1) pavilion.update(time, { season: 'summer', snow: 0, daylight: 1 });
  assert.ok(snow.material.opacity < .01);
  for (let time = 10.1; time <= 13; time += .1) pavilion.update(time, { season: 'summer', snowCover: .9, snow: .8, daylight: 1 });
  assert.ok(snow.material.opacity > .7, '明确积雪与降雪字段也应覆盖瓦顶');
  assert.equal(snow.geometry, geometry); assert.equal(snow.material, material);
  pavilion.dispose();
});

test('木亭释放全部独占资源且可重复释放，释放后灯光不会重新出现', () => {
  const { parent, pavilion, meshes, lights } = create();
  pavilion.update(2, { daylight: 0, season: 'winter' });
  const resources = new Set();
  for (const mesh of meshes) {
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  }
  const disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  pavilion.dispose(); pavilion.dispose(); pavilion.update(9, { daylight: 0 }); pavilion.setQuality('low');
  assert.ok([...disposed.values()].every(count => count === 1));
  assert.equal(parent.children.length, 0); assert.equal(pavilion.group.children.length, 0);
  assert.ok(lights.every(light => light.intensity === 0 && !light.visible));
});


test('小落脚范围仍保留宽檐和靠边长凳，三面木栏围合并只开放台阶入口', () => {
  const { pavilion, meshes } = create({ floorSize: 2.3 });
  pavilion.group.updateWorldMatrix(true, true);
  const base = pavilion.group.getObjectByName('山亭架空木台地板');
  assert.ok(base?.isMesh);
  const floorBounds = new THREE.Box3().setFromObject(base);
  assert.ok(floorBounds.max.x - floorBounds.min.x <= 2.31 && floorBounds.max.z - floorBounds.min.z <= 2.31,
    '有限落脚平台不能自动扩大为三米多的台面');
  const roof = new THREE.Box3().setFromObject(pavilion.group.getObjectByName('山亭弧瓦屋顶'));
  assert.ok(roof.max.x - roof.min.x > 3.4, '小落脚范围仍应有遮雨宽檐');
  const benches = new THREE.Box3().setFromObject(pavilion.group.getObjectByName('山亭靠边长凳'));
  assert.ok(benches.min.x >= floorBounds.min.x && benches.max.x <= floorBounds.max.x);
  const rail = pavilion.group.getObjectByName('山亭三面木栏'); assert.ok(rail?.isMesh);
  for (const [x, z, dx, dz] of [[4,-11.5,0,1],[1.5,-9,1,0],[6.5,-9,-1,0]]) {
    const origin = new THREE.Vector3(x, pavilion.group.position.y + .72, z);
    assert.ok(new THREE.Raycaster(origin, new THREE.Vector3(dx, 0, dz), 0, 2.5).intersectObject(rail, false).length,
      '左右与背面应有实际木栏围合');
  }
  for (const x of [-.45, 0, .45]) {
    const origin = new THREE.Vector3(4 + x, pavilion.group.position.y + .72, -6.5);
    assert.equal(new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, 2.3).intersectObjects(meshes, false).length, 0,
      '接台阶的一面须保留一点米左右开放净入口');
  }
  pavilion.dispose();
});

test('半米短入口选择可行单级台阶并真实接到山路，不会静默生成断开的木亭', () => {
  // Catches ceil(distance / preferred tread) choosing two impossible 25 cm treads over one valid 50 cm tread.
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2,
    approach: { x: 0, y: 12.038, z: 1.5 } });
  const steps = [];
  pavilion.group.traverse(object => { if (object.name.startsWith('山亭入口石阶')) steps.push(object); });
  assert.ok(steps.length > 0, '可行的短入口必须生成低石阶');
  assert.equal(pavilion.group.userData.approachConnected, true);
  pavilion.group.updateWorldMatrix(true, true);
  const last = new THREE.Box3().setFromObject(steps.at(-1));
  assert.ok(Math.abs(last.max.y - 12.038) < .02 && last.max.z >= 1.499 && last.max.z <= 1.515,
    '末级踏面需覆盖原路接头且只留很小的封缝搭接');
  assert.ok(Math.abs(last.max.y - pavilion.group.position.y) <= .2);
  pavilion.dispose();
});

test('两米地板的边凳留出完整一点一米通行净宽，靠边坐具仍在平台内', () => {
  // Catches shrinking the landing while keeping benches too far inward at knee and seat height.
  const { pavilion, meshes } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  pavilion.group.updateWorldMatrix(true, true);
  for (const x of [-.55, -.45, 0, .45, .55]) for (const y of [.44, .72, 1.25]) {
    const origin = new THREE.Vector3(x, pavilion.group.position.y + y, 2);
    const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, 2.4).intersectObjects(meshes, false);
    assert.equal(hits.length, 0, '从入口走到背凳前的中央空地时不能撞到边凳');
  }
  const benches = new THREE.Box3().setFromObject(pavilion.group.getObjectByName('山亭靠边长凳'));
  assert.ok(benches.min.x >= -1 && benches.max.x <= 1, '边凳应留在实际地板范围内');
  pavilion.dispose();
});

test('三面长凳围成 U 形，中央空地和台阶一侧保留宽入口', () => {
  // Catches omitting the rear seat or adding a cross-seat across the entry/central standing space.
  const { pavilion, meshes } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  pavilion.group.updateWorldMatrix(true, true);
  const benches = pavilion.group.getObjectByName('山亭靠边长凳'), floor = pavilion.group.position.y;
  const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2);
  for (const [x, z] of [[-.75, 0], [.75, 0], [-.45, -.75], [0, -.75], [.45, -.75]]) {
    down.ray.origin.set(x, floor + 1.1, z);
    const hits = down.intersectObject(benches, false);
    assert.ok(hits.length, `左、右、背三侧都需有可坐的连续凳面 ${x},${z}`);
    assert.ok(hits[0].point.y - floor > .4 && hits[0].point.y - floor < .55, '三侧凳面应处于正常座高');
  }
  for (const x of [-.55, 0, .55]) for (const z of [-.35, 0, .4, .8]) {
    const start = new THREE.Vector3(x, floor + .25, z);
    const body = new THREE.Raycaster(start, new THREE.Vector3(0, 1, 0), 0, 1.5).intersectObjects(meshes, false);
    assert.equal(body.length, 0, '三面座凳不能缩窄中央至入口的人身净空');
  }
  assert.ok(pavilion.group.userData.entryClearWidth >= 1.1, '增加背凳仍应保留现有入口净宽');
  pavilion.dispose();
});

test('无法满足正常步高的指定进路必须显式失败，场景不留下没有入口的模型', () => {
  // Catches returning a success-shaped API and attaching owned GPU resources after approach planning failed.
  assert.equal(typeof module.createRestPavilion, 'function');
  const parent = new THREE.Group();
  assert.throws(() => module.createRestPavilion(parent, { heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2,
    approach: { x: 0, y: 15, z: 1.5 } }), /入口|衔接|台阶/);
  assert.equal(parent.children.length, 0);
});

test('长木支柱带斜撑而不生成石砌纹理或满墙基座', () => {
  const { pavilion, meshes } = create({ heightAt: (x, z) => 12 + 1.5 * (x - 4) - .25 * (z + 9), floorSize: 2 });
  const supports = pavilion.group.getObjectByName('山亭贴坡支承木柱');
  assert.ok(supports?.isMesh && pavilion.group.getObjectByName('山亭台下木斜撑')?.isMesh);
  assert.ok(new THREE.Box3().setFromObject(supports).max.y - new THREE.Box3().setFromObject(supports).min.y > 2);
  assert.ok(meshes.every(mesh => !mesh.material.map && !mesh.material.bumpMap), '废弃石墙纹理不能留在新木亭模型中');
  pavilion.dispose();
});

test('参考亭样式有朱红柱梁、翘角瓦檐和攒尖宝顶，檐下花格留够站立净高', () => {
  // Catches a plain neutral roof with flat eaves or decorative grille crossing the entrance at head height.
  const { pavilion } = create({ floorSize: 2 });
  const posts = pavilion.group.getObjectByName('山亭旧木柱');
  assert.ok(posts.material.color.r > posts.material.color.g * 2.7 && posts.material.color.r > posts.material.color.b * 2.2,
    '柱梁应采用参考图的旧朱红木漆');
  const roof = pavilion.group.getObjectByName('山亭弧瓦屋顶'), p = roof.geometry.attributes.position;
  let corner = -Infinity, middle = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), z = Math.abs(p.getZ(i));
    if (x > 1.94 && z > 1.94) corner = Math.max(corner, p.getY(i));
    if ((x > 1.94 && z < .02) || (z > 1.94 && x < .02)) middle = Math.max(middle, p.getY(i));
  }
  assert.ok(corner - middle > .25, '瓦檐四角须明显上翘');
  const crown = pavilion.group.getObjectByName('山亭攒尖宝顶'), grille = pavilion.group.getObjectByName('山亭檐下回纹花格');
  assert.ok(crown?.isMesh && grille?.isMesh, '屋顶尖宝顶和檐下花格应是实际可见构件');
  pavilion.group.updateWorldMatrix(true, true);
  assert.ok(new THREE.Box3().setFromObject(crown).max.y > pavilion.group.position.y + 3.8);
  assert.ok(new THREE.Box3().setFromObject(grille).min.y > pavilion.group.position.y + 1.9,
    '檐下装饰不能侵入站立通行净高');
  pavilion.dispose();
});

test('朱红椽条沿曲面留在瓦顶下方，不在屋面中段露出红条', () => {
  // Independent geometry rays catch straight chords protruding through the curved tile surface.
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  pavilion.group.updateWorldMatrix(true, true);
  const roof = pavilion.group.getObjectByName('山亭弧瓦屋顶'), beams = pavilion.group.getObjectByName('山亭木梁与斜撑');
  const bounds = new THREE.Box3().setFromObject(roof), extent = bounds.max.x;
  const edges = [[[-extent, extent], [extent, extent]], [[extent, extent], [extent, -extent]],
    [[extent, -extent], [-extent, -extent]], [[-extent, -extent], [-extent, extent]]];
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 8);
  let checked = 0;
  for (const edge of edges) for (const t of [.25, .5, .75]) for (let r = .3; r <= .96; r += .03) {
    const x = (edge[0][0] + (edge[1][0] - edge[0][0]) * t) * r;
    const z = (edge[0][1] + (edge[1][1] - edge[0][1]) * t) * r;
    ray.ray.origin.set(x, pavilion.group.position.y + 6, z);
    const tile = ray.intersectObject(roof, false)[0], wood = ray.intersectObject(beams, false)[0];
    if (!wood) continue;
    assert.ok(tile && wood.point.y <= tile.point.y - .02, `椽条上缘应藏在实际瓦面下 ${x},${z}`);
    checked++;
  }
  assert.ok(checked > 100, '应密查四个坡面上实际椽条中段');
  pavilion.dispose();
});

test('四角缩小风铃独立随实时风摆动，固定吊点并保留站立净空', () => {
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  const anchors = namedObjects(pavilion.group, '山亭风铃根吊点'), swings = namedObjects(pavilion.group, '山亭风铃摆轴');
  const bells = namedObjects(pavilion.group, '山亭小铜风铃');
  assert.equal(anchors.length, 4, '每座亭四个檐角都需有独立风铃');
  assert.equal(swings.length, 4); assert.equal(bells.length, 4);
  assert.equal(namedObjects(pavilion.group, '山亭风铃悬舌').length, 4);
  assert.equal(namedObjects(pavilion.group, '山亭风铃风帆').length, 4);
  assert.ok(bells.every(bell => bell.material.metalness > .4));
  pavilion.group.updateWorldMatrix(true, true);
  const fixed = anchors.map(anchor => anchor.getWorldPosition(new THREE.Vector3()));
  assert.equal(new Set(fixed.map(point => `${Math.sign(point.x)},${Math.sign(point.z)}`)).size, 4, '四根吊点应分布在四个檐角');
  for (const bell of bells) {
    const bounds = new THREE.Box3().setFromObject(bell);
    assert.ok(bounds.max.x - bounds.min.x > .13 && bounds.max.x - bounds.min.x < .18, '铜铃应缩小至原先约六成，近景仍看得清');
  }
  const bodies = bells.map(bell => bell.geometry), largest = swings.map(() => -Infinity), smallest = swings.map(() => Infinity);
  let minHeight = Infinity;
  for (let i = 0; i <= 240; i++) {
    pavilion.update(i / 30, { windSpeed: 15, windDirection: [1, 0], gust: .6, daylight: .8, hours: 12, paused: true });
    pavilion.group.updateWorldMatrix(true, true);
    for (let j = 0; j < 4; j++) {
      assert.ok(anchors[j].getWorldPosition(new THREE.Vector3()).distanceTo(fixed[j]) < 1e-9, '铃身摇摆不能拖动根吊点');
      largest[j] = Math.max(largest[j], swings[j].rotation.z); smallest[j] = Math.min(smallest[j], swings[j].rotation.z);
      minHeight = Math.min(minHeight, new THREE.Box3().setFromObject(swings[j]).min.y - pavilion.group.position.y);
    }
  }
  assert.ok(largest.every((value, i) => value - smallest[i] > .08), '暂停天时后，四只风铃仍须独立来回摆动');
  assert.ok(new Set(swings.map(swing => swing.rotation.z.toFixed(3))).size === 4, '四角不能机械同步摆动');
  assert.ok(minHeight > 1.8, '风铃及风帆最下缘应留够人身净高');
  assert.deepEqual(bells.map(bell => bell.geometry), bodies, '风动只能改物体变换，不重建几何');
  pavilion.group.rotation.y = Math.PI / 2;
  for (let i = 241; i <= 480; i++) pavilion.update(i / 30, { windSpeed: 15, windDirection: [1, 0], gust: .6 });
  assert.ok(swings.every(swing => Math.abs(swing.rotation.x) > Math.abs(swing.rotation.z) * 5),
    '整亭旋转后，世界风向需正确映射到新的铃身摆轴');
  pavilion.dispose();
});

test('实际风摆过零触发空间风铃事件，静风静音且大风受冷却限制', () => {
  const { pavilion } = create({ heightAt: () => 12, position: { x: 4, z: -9 }, floorSize: 2 });
  const mouths = namedObjects(pavilion.group, '山亭风铃铃口'); assert.equal(mouths.length, 4);
  const events = [];
  pavilion.onChime = event => {
    assert.ok(Number.isInteger(event.bellIndex) && event.bellIndex >= 0 && event.bellIndex < 4);
    const actual = mouths[event.bellIndex].getWorldPosition(new THREE.Vector3());
    assert.ok(event.position instanceof THREE.Vector3 && event.position.distanceTo(actual) < 1e-8);
    assert.ok(event.strength > 0 && event.strength <= 1);
    assert.ok(Number.isInteger(event.variant) && event.variant >= 0 && event.variant < 5);
    assert.ok(Number.isFinite(event.time) && Number.isFinite(event.seed));
    events.push(event);
  };
  for (let i = 0; i <= 600; i++) pavilion.update(i / 30, { windSpeed: 0, windDirection: [1, 0], gust: 0 });
  assert.equal(events.length, 0, '没有风时不能按定时器自行响铃');
  for (let i = 601; i <= 2400; i++) pavilion.update(i / 30, { windSpeed: 22, windDirection: [1, 0], gust: 1 });
  assert.ok(events.length >= 4 && events.length <= 94, '四角暴风铃音必须仍受亭级限流');
  assert.equal(new Set(events.map(event => event.bellIndex)).size, 4, '四个檐角都应有对应的空间铃声来源');
  const previous = new Map();
  for (let i = 0; i < events.length; i++) {
    if (i) assert.ok(events[i].time - events[i - 1].time >= .64, '同亭四只铃不能同帧或密集叠响');
    const last = previous.get(events[i].bellIndex);
    if (last !== undefined) assert.ok(events[i].time - last >= 1.49, '每只风铃仍应有独立冷却间隔');
    previous.set(events[i].bellIndex, events[i].time);
  }
  assert.ok(new Set(events.map(event => event.variant)).size >= 3, '连续声音需要平滑的五声变体');
  const count = events.length;
  for (let i = 0; i < 200; i++) pavilion.update(80, { windSpeed: 22, windDirection: [1, 0], gust: 1 });
  assert.equal(events.length, count, '同一实时帧重复调用不能再撞击响铃');
  const position = events[0].position.clone();
  pavilion.update(81, { windSpeed: 22, windDirection: [0, 1], gust: 1 });
  assert.ok(events[0].position.equals(position), '事件位置需是独立的当次世界坐标快照');
  pavilion.dispose();
});

test('低画质仍保留风铃和风动事件，释放后不再通知或重建铃身资源', () => {
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  const bells = namedObjects(pavilion.group, '山亭小铜风铃'); assert.equal(bells.length, 4);
  const references = bells.map(bell => [bell.geometry, bell.material]), events = [];
  pavilion.onChime = event => events.push(event);
  pavilion.setQuality('low');
  for (let i = 0; i <= 900; i++) pavilion.update(i / 30, { windSpeed: 14, windDirection: [0, 1], gust: .4, quality: 'low' });
  assert.ok(events.length > 3 && bells.every(bell => bell.visible), '低画质应保留四只风铃');
  assert.deepEqual(bells.map(bell => [bell.geometry, bell.material]), references);
  assert.ok(bells.every(bell => !bell.castShadow));
  const count = events.length;
  const resources = new Set(references.flat()), disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  pavilion.dispose(); pavilion.dispose();
  for (let i = 901; i <= 1200; i++) pavilion.update(i / 30, { windSpeed: 22, windDirection: [0, 1], gust: 1 });
  assert.equal(events.length, count); assert.equal(pavilion.onChime, null);
  assert.ok([...disposed.values()].every(count => count === 1));
});

test('风铃实体吊扣贴住真实瓦檐，共用小型铃身几何而不留下悬挂空隙', () => {
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  pavilion.group.updateWorldMatrix(true, true);
  const roof = pavilion.group.getObjectByName('山亭弧瓦屋顶'), hooks = namedObjects(pavilion.group, '山亭风铃檐下铜扣');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 8);
  assert.ok(hooks.length);
  for (const hook of hooks) {
    const point = hook.getWorldPosition(new THREE.Vector3()), bounds = new THREE.Box3().setFromObject(hook);
    ray.ray.origin.set(point.x, pavilion.group.position.y + 6, point.z);
    const tile = ray.intersectObject(roof, false)[0];
    assert.ok(tile && Math.abs(tile.point.y - bounds.max.y) < .015, '实体铜扣上缘需接住实际瓦檐，而非固定到空中虚点');
  }
  const bells = namedObjects(pavilion.group, '山亭小铜风铃');
  assert.equal(new Set(bells.map(bell => bell.geometry)).size, 1, '四个缩小铜铃应共用一次生成的几何');
  pavilion.dispose();
});

test('下栏杆用与檐下呼应的朱红框式回纹，实际木格留出开敞空隙', () => {
  const { pavilion } = create({ heightAt: () => 12, position: { x: 0, z: 0 }, floorSize: 2 });
  pavilion.group.updateWorldMatrix(true, true);
  const rail = pavilion.group.getObjectByName('山亭三面木栏'), grille = pavilion.group.getObjectByName('山亭檐下回纹花格');
  assert.ok(rail.material === grille.material, '上下花格应使用一致的旧朱红木色');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, .6);
  let horizontalReturns = 0, openRow = 0, sampled = 0;
  for (let x = -.9; x <= .901; x += .045) {
    ray.ray.origin.set(x, pavilion.group.position.y + .47, -1.4);
    if (ray.intersectObject(rail, false).length) horizontalReturns++;
    ray.ray.origin.y = pavilion.group.position.y + .60;
    if (ray.intersectObject(rail, false).length) openRow++;
    sampled++;
  }
  assert.ok(horizontalReturns > sampled * .62, '栏杆应有实际横向回折木格，不能只由普通竖条组成');
  assert.ok(openRow < sampled * .5, '回纹之间应保留开敞格孔，不能成为密实木墙');
  pavilion.dispose();
});
