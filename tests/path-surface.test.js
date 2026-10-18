import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandPaths } from '../src/models/island-paths.js';
import { caveToWorld } from '../src/cave-layout.js';

function hillside(flat = false) {
  // A known 55% climb with 42% side slope, and a separate coastal trail.
  const heightAt = flat ? () => 24 : (x, z) => 24 + x * .42 + z * .55;
  const route = (id, kind, x, width) => ({ id, kind, width, closed: false,
    points: Array.from({ length: 49 }, (_, i) => ({ x, z: -12 + i * .5, y: heightAt(x, -12 + i * .5) + .038 })) });
  const layout = { routes: [route('ascent', 'mountain', 0, 1.2), route('ring', 'coastal', 8, 2.2)],
    heightAtRendered: heightAt, distanceAt: (x, z) => Math.min(Math.abs(x) - .6, Math.abs(x - 8) - 1.1) };
  return { heightAt, layout };
}

test('山径颜色比环岛沙路更暗且混有岩色，边缘融合坐标仍随实际路宽', () => {
  const paths = createIslandPaths(new THREE.Group(), hillside());
  try {
    const road = paths.group.children.find(mesh => mesh.name === '环岛沙土与登山小径');
    const { color, position, aMountain, aPathEdge } = road.geometry.attributes;
    assert.ok(aMountain && aPathEdge, '窄山径需要独立的岩土色与融边控制');
    const lights = [[], []];
    for (let i = 0; i < position.count; i++) {
      const mountain = aMountain.getX(i) > .5, edge = aPathEdge.getX(i);
      assert.ok(Math.abs(edge) <= 1.00001);
      if (mountain) assert.ok(Math.abs(position.getX(i)) <= .64801, '宽度变化不能超出预留的±8%通道');
      lights[Number(mountain)].push(color.getX(i) * .2126 + color.getY(i) * .7152 + color.getZ(i) * .0722);
    }
    const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(mean(lights[1]) < mean(lights[0]) * .7, '山径不可延续明亮浅黄胶带');
    assert.ok(Math.max(...lights[1]) - Math.min(...lights[1]) > .045, '土砾岩色应有自然空间变化');
    assert.ok(road.material.transparent && !road.material.depthWrite && road.material.polygonOffset,
      '融边应露出真实地面，不能把透明边缘写进深度');
  } finally { paths.dispose(); }
});

test('融边后路面仍逐三角贴地，局部石阶与矮挡土石嵌进真实斜坡而非悬空', () => {
  const fixture = hillside(), paths = createIslandPaths(new THREE.Group(), fixture);
  try {
    const road = paths.group.children.find(mesh => mesh.name === '环岛沙土与登山小径');
    const position = road.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) assert.ok(Math.abs(position.getY(i) - fixture.heightAt(position.getX(i), position.getZ(i)) - .038) < .00001);
    const stoneMeshes = paths.group.children.filter(mesh => ['山径天然石阶', '山径下坡侧低矮护基'].includes(mesh.name));
    assert.equal(stoneMeshes.length, 2);
    assert.ok(paths.group.children.filter(mesh => mesh.isMesh).length <= 6, '石阶与基础应合并绘制');
    for (const mesh of stoneMeshes) {
      assert.ok(mesh.castShadow && mesh.receiveShadow);
      const vertices = mesh.geometry.attributes.position;
      let embedded = 0, exposed = 0;
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), gap = y - fixture.heightAt(x, z);
        assert.ok([x, y, z].every(Number.isFinite));
        // A 1.2 m level tread fills the fixture's .504 m cross-slope, plus
        // .165 m along its .30 m run; its embedded full-width base stays low.
        assert.ok(gap >= -.13 && gap <= .73, '整宽基础应填实横坡且与坡面接触');
        if (gap < -.02) embedded++; if (gap > .025) exposed++;
      }
      assert.ok(embedded > 0 && exposed > 0, '每组石块同时存在埋入的底座与地上可见表面');
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let treads = 0;
      for (let i = 0; i < vertices.count; i += 3) {
        a.fromBufferAttribute(vertices, i); b.fromBufferAttribute(vertices, i + 1); c.fromBufferAttribute(vertices, i + 2);
        if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) < .022) {
          assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).y > 0, '水平石阶正面必须向上，不能被背面剔除');
          treads++;
        }
      }
      assert.ok(treads > 0);
    }
  } finally { paths.dispose(); }
});

test('平缓山路用水平石板平台，爬升才有阶差且护基数量由横坡决定', () => {
  const steep = createIslandPaths(new THREE.Group(), hillside()), flat = createIslandPaths(new THREE.Group(), hillside(true));
  try {
    assert.ok(steep.counts.steps > 3 && steep.counts.supports > 3);
    assert.equal(flat.counts.steps, 0); assert.equal(flat.counts.supports, 0);
    assert.ok(flat.counts.platforms > 10);
  } finally { steep.dispose(); flat.dispose(); }
});

test('山径和石阶共用冬雪驱动，不逐帧重建，新增资源释放一次', () => {
  const parent = new THREE.Group(), paths = createIslandPaths(parent, hillside());
  const road = paths.group.children.find(mesh => mesh.name === '环岛沙土与登山小径');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  road.material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uPathSnow, '真实材质编译要接收到季节积雪');
  const geometries = new Set(paths.group.children.map(mesh => mesh.geometry)), resources = new Set();
  for (const mesh of paths.group.children) {
    resources.add(mesh.geometry); resources.add(mesh.material); if (mesh.material.map) resources.add(mesh.material.map);
  }
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  paths.update(0, { season: 'summer', snow: 0 }); assert.equal(shader.uniforms.uPathSnow.value, 0);
  paths.update(2, { season: 'winter', snow: .8, quality: 'low' }); assert.ok(shader.uniforms.uPathSnow.value >= .65);
  assert.deepEqual(new Set(paths.group.children.map(mesh => mesh.geometry)), geometries);
  paths.dispose(); paths.dispose();
  assert.equal(parent.children.length, 0); assert.ok([...counts.values()].every(count => count === 1));
});

test('通往海滩的浅坡支路实际铺出连续多级石阶，低处路色逐渐融入沙滩', () => {
  const heightAt = (x, z) => .9 + .03 * x + .22 * z;
  const make = forceSteps => {
    const route = { id: 'beach-descent', kind: 'beach', width: 1.2, closed: false, forceSteps,
      points: Array.from({ length: 81 }, (_, i) => ({ x: 0, z: i * .3, y: heightAt(0, i * .3) + .038 })) };
    return createIslandPaths(new THREE.Group(), { heightAt, layout: { routes: [route], heightAtRendered: heightAt,
      distanceAt: x => Math.abs(x) - .6 } });
  };
  const stairs = make(true), plain = make(false);
  try {
    assert.ok(stairs.counts.steps >= 27, '5.28m爬升以不超过20cm的整行踏面覆盖，不能按陡坡阈值隐去');
    assert.equal(plain.counts.steps, 0);
    const mesh = stairs.group.children.find(mesh => mesh.name === '山径天然石阶');
    assert.ok(mesh);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let hits = 0;
    for (let z = .1; z <= 23.9; z += .3) {
      ray.ray.origin.set(0, 30, z); const top = ray.intersectObject(mesh)[0];
      if (top) { hits++; assert.ok(top.point.y - heightAt(0, z) > .03 && top.point.y - heightAt(0, z) < .3); }
    }
    assert.ok(hits >= 72, '石阶应连续覆盖下行支路，不能只摆零散横石');
    const road = stairs.group.children.find(mesh => mesh.name === '环岛沙土与登山小径'), p = road.geometry.attributes.position,
      colors = road.geometry.attributes.color, low = [], high = [];
    for (let i = 0; i < p.count; i++) {
      const luminance = colors.getX(i) * .2126 + colors.getY(i) * .7152 + colors.getZ(i) * .0722;
      if (p.getY(i) < 1.5) low.push(luminance); if (p.getY(i) > 5) high.push(luminance);
    }
    const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(mean(low) > mean(high) * 1.6, '低处石砾路应逐渐混入明亮沙色');
  } finally { stairs.dispose(); plain.dispose(); }
});

test('整条上山路有同级水平宽踏面，三条实际走线无空白且相邻步高不超二十厘米', () => {
  const heightAt = (x, z) => 8 + .28 * x + .5 * z;
  const route = { id: 'walkable-ascent', kind: 'mountain', width: 1.2, forceSteps: true, closed: false,
    points: Array.from({ length: 61 }, (_, i) => ({ x: 0, z: i * .3, y: heightAt(0, i * .3) + .038 })) };
  const paths = createIslandPaths(new THREE.Group(), { heightAt,
    layout: { routes: [route], heightAtRendered: heightAt, distanceAt: x => Math.abs(x) - .6 } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    assert.ok(mesh);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), previous = [null, null, null];
    const footprints = [-.36, 0, .36]; let samples = 0, covered = 0;
    for (let z = .05; z < 17.95; z += .025) {
      const tops = [];
      for (let line = 0; line < footprints.length; line++) {
        ray.ray.origin.set(footprints[line], 40, z); const hit = ray.intersectObject(mesh)[0]; samples++;
        if (!hit) { previous[line] = null; continue; }
        covered++; tops.push(hit.point.y);
        assert.ok(hit.face.normal.y > .99999, '踏面必须水平，不能是起伏小石头或斜坡');
        if (previous[line] !== null) assert.ok(Math.abs(hit.point.y - previous[line]) <= .20001, '相邻阶不能高到无法迈步');
        previous[line] = hit.point.y;
      }
      if (tops.length === 3) assert.ok(Math.max(...tops) - Math.min(...tops) < .00002, '整级横向踏面应共用同一水平高度');
    }
    assert.ok(covered / samples > .995, '三条走线需要连续石踏面，不能每隔一米放装饰');
    const rows = mesh.geometry.userData.rows;
    assert.ok(rows?.length > 40);
    for (const row of rows) {
      assert.ok(row.width >= 1.1 && row.run >= .28);
      if (row.role === 'stair') assert.ok(row.rise >= .119 && row.rise <= .20);
    }
    assert.ok(paths.group.children.filter(mesh => mesh.isMesh).length <= 6);
  } finally { paths.dispose(); }
});

test('山路回折处有实心水平平台，转弯内外脚位都不会落入空洞', () => {
  const heightAt = (x, z) => 8 + .35 * z + .10 * x;
  const points = [...Array.from({ length: 17 }, (_, i) => ({ x: 0, z: i * .5 })),
    ...Array.from({ length: 16 }, (_, i) => ({ x: (i + 1) * .5, z: 8 }))];
  for (const p of points) p.y = heightAt(p.x, p.z) + .038;
  const route = { id: 'switchback', kind: 'mountain', width: 1.2, forceSteps: true, closed: false, points };
  const paths = createIslandPaths(new THREE.Group(), { heightAt, layout: { routes: [route], heightAtRendered: heightAt,
    distanceAt: (x, z) => Math.min(Math.abs(x) - .6, Math.abs(z - 8) - .6) } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    assert.ok(mesh.geometry.userData.rows.some(row => row.role === 'landing' && row.width >= 1.1 && row.run >= .28),
      '短回折平台保留整宽踏面，不把正在爬升的长弯合成一片高墙');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const [x, z] of [[0, 8], [-.36, 8], [.36, 8], [0, 7.64], [0, 8.36], [.3, 8.3]]) {
      ray.ray.origin.set(x, 40, z); const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit, `回折平台不能漏掉脚位${x},${z}`); assert.ok(hit.face.normal.y > .99999);
    }
    let previous;
    for (let s = 6.7; s < 9.3; s += .01) {
      ray.ray.origin.set(s <= 8 ? 0 : s - 8, 40, s <= 8 ? s : 8);
      const hit = ray.intersectObject(mesh)[0]; assert.ok(hit);
      if (previous !== undefined) assert.ok(Math.abs(hit.point.y - previous) <= .20001, '转弯实际脚位不可跳过级');
      previous = hit.point.y;
    }
  } finally { paths.dispose(); }
});

test('普通石檐交叠仍限制在正常步差，不沿整条曲路合成高平台', () => {
  const heightAt = (x, z) => 10 + .70 * x + .30 * z;
  const routes = [0, .8].map((x, index) => ({ id: `parallel-${index}`, kind: 'mountain', width: 1.1, forceSteps: true,
    points: Array.from({ length: 25 }, (_, i) => ({ x, z: i * .5, y: heightAt(x, i * .5) + .038 })) }));
  const paths = createIslandPaths(new THREE.Group(), { heightAt, layout: { routes, heightAtRendered: heightAt,
    distanceAt: x => Math.min(Math.abs(x) - .55, Math.abs(x - .8) - .55) } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    // Sample inside treads: a ray exactly on a riser legitimately hits both
    // adjoining levels, whereas positive-area cross-route overlap must not.
    for (let z = .237; z < 11.8; z += .25) {
      ray.ray.origin.set(.4, 40, z);
      const tops = ray.intersectObject(mesh).filter(hit => hit.face.normal.y > .99999).map(hit => hit.point.y);
      assert.ok(tops.length > 0); assert.ok(Math.max(...tops) - Math.min(...tops) <= .20001, '普通石檐交叠最多相差一级，不能跨行骤降');
    }
    assert.ok(mesh.geometry.userData.rows.every(row => Math.abs(row.width - 1.1) < .00001), '真实踏面跟随可行山路宽度');
  } finally { paths.dispose(); }
});

test('山阶与海滩或洞穴支路在同一节点接平，连续踏面不会突然跌落', () => {
  const heightAt = (x, z) => 10 + .40 * x + .30 * z;
  const p = (x, z) => ({ x, z, y: heightAt(x, z) + .038 });
  const routes = [{ id: 'ascent', kind: 'mountain', width: 1.1, forceSteps: true,
    points: Array.from({ length: 25 }, (_, i) => p(0, i * .5)) },
  ...['beach', 'cave'].map((kind, i) => ({ id: kind, kind, width: 1.2, forceSteps: true,
    points: Array.from({ length: 25 }, (_, j) => p(-j * .25, 4 + i * 4)) }))];
  const paths = createIslandPaths(new THREE.Group(), { heightAt, layout: { routes, heightAtRendered: heightAt,
    distanceAt: () => -1 } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const z of [4, 8]) {
      let previous;
      for (let x = .2; x > -5.8; x -= .025) {
        ray.ray.origin.set(x, 40, z); const hit = ray.intersectObject(mesh)[0];
        assert.ok(hit, '从同一节点到支路末端都需有连续踏面');
        assert.ok(hit.face.normal.y > .99999);
        if (previous !== undefined) assert.ok(Math.abs(hit.point.y - previous) <= .20001, '支路接头不可突然掉落');
        previous = hit.point.y;
      }
    }
  } finally { paths.dispose(); }
});

test('最大合法坡度的长石阶不因踏深和步高矛盾累计抬高基础', () => {
  const heightAt = (x, z) => 8 + .1 * x + .65 * z;
  const route = { id: 'grade-limit', kind: 'mountain', width: 1.1, forceSteps: true,
    points: Array.from({ length: 49 }, (_, i) => ({ x: 0, z: i * .5, y: heightAt(0, i * .5) + .038 })) };
  const paths = createIslandPaths(new THREE.Group(), { heightAt, layout: { routes: [route], heightAtRendered: heightAt,
    distanceAt: x => Math.abs(x) - .55 } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) assert.ok(p.getY(i) - heightAt(p.getX(i), p.getZ(i)) < .36,
      '65%长坡基础仅填踏面与横坡，不可累计变成抬高的长墙');
    for (const row of mesh.geometry.userData.rows) {
      assert.ok(row.run >= .28 && row.rise <= .18501);
    }
  } finally { paths.dispose(); }
});

test('护基底边沿真实三角面转折嵌入，不可跨过凹地留下悬空洞', () => {
  // x=0 is an actual terrain grid seam. Each side is planar, but connecting
  // just the outside corners would bridge 16.5 cm above its valley floor.
  const heightAt = (x, z) => 8 + .30 * Math.abs(x) + .30 * z;
  const route = { id: 'creased-ground', kind: 'mountain', width: 1.1, forceSteps: true,
    points: Array.from({ length: 21 }, (_, i) => ({ x: 0, z: i * .5, y: heightAt(0, i * .5) + .038 })) };
  const paths = createIslandPaths(new THREE.Group(), { heightAt, layout: { routes: [route], heightAtRendered: heightAt,
    distanceAt: x => Math.abs(x) - .55 } });
  try {
    const mesh = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 8.02, -.3), new THREE.Vector3(0, 0, 1), 0, .4);
    assert.ok(ray.intersectObject(mesh).length > 0, '地面上2cm仍需有实心石基础，不能露悬桥底');
  } finally { paths.dispose(); }
});

test('洞尾沿实际洞地面补出接头，石阶与较低洞floor之间没有三十厘米坎', () => {
  const parent = new THREE.Group(), corners = [[-3.1, -.5], [3.1, -.5], [3.1, 3.1], [-3.1, 3.1]]
    .map(([side, forward]) => caveToWorld(side, -.2, forward));
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(p => [p.x, p.y, p.z]), 3));
  floorGeometry.setIndex([0, 2, 1, 0, 3, 2]); floorGeometry.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  floor.name = '洞穴坡口与地面'; parent.add(floor);
  const heightAt = () => 10, points = [5, 4.5, 4, 3.5, 3].map(forward => ({ ...caveToWorld(0, 0, forward), y: 10.038 }));
  const route = { id: 'cave-approach', kind: 'cave', width: 1.2, forceSteps: true, points };
  const paths = createIslandPaths(parent, { heightAt, layout: { routes: [route], heightAtRendered: heightAt, distanceAt: () => -1 } });
  try {
    const stone = paths.group.children.find(mesh => mesh.name === '山径天然石阶');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let previous;
    for (let forward = 4.9; forward > .8; forward -= .025) {
      const p = caveToWorld(0, 0, forward); ray.ray.origin.set(p.x, 30, p.z);
      const hit = ray.intersectObjects([stone, floor])[0]; assert.ok(hit);
      if (previous !== undefined) assert.ok(Math.abs(hit.point.y - previous) <= .20001, '洞floor入口必须用连续正常步高接平');
      previous = hit.point.y;
    }
  } finally { paths.dispose(); floorGeometry.dispose(); floor.material.dispose(); }
});
