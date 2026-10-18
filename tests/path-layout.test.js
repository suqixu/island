import test from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, shoreDistance } from '../src/terrain.js';
import * as THREE from 'three';
import { CAVE_LAYOUT, caveToLocal } from '../src/cave-layout.js';

const paths = await import('../src/path-layout.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(paths?.getIslandPathLayout && paths?.pathDistanceAt, '道路需要一次预建的布局和通道距离查询');
  return paths;
};
const length = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cave = { x: 31.874, z: 38.343 };
const scenery = await import('../src/models/island-paths.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

test('道路布局缓存一次构建，环岛路闭合、连续并留在浪线内侧', () => {
  const m = api(), layout = m.getIslandPathLayout({ caveEndpoint: cave });
  assert.equal(layout, m.getIslandPathLayout({ caveEndpoint: { ...cave } }));
  const ring = layout.routes.find(route => route.id === 'coastal-loop');
  assert.ok(ring?.closed && ring.width >= 2 && ring.width <= 2.4);
  assert.ok(length(ring.points[0], ring.points.at(-1)) < .00001);
  let total = 0;
  for (let i = 0; i < ring.points.length; i++) {
    const point = ring.points[i], inland = shoreDistance(point.x, point.z);
    assert.ok(inland >= 7.9 && inland <= 15.1);
    assert.ok(point.y > 1 && Number.isFinite(point.y));
    if (i) { const step = length(point, ring.points[i - 1]); assert.ok(step <= .81); total += step; }
  }
  assert.ok(total > 350 && total < 550);
});

test('所有道路贴合实际地形三角面，小epsilon不造成悬浮或穿地', () => {
  const layout = api().getIslandPathLayout();
  for (const route of layout.routes) for (const point of route.points) {
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    const gap = point.y - layout.heightAtRendered(point.x, point.z);
    assert.ok(gap >= .02 && gap <= .08);
    assert.ok(heightAt(point.x, point.z) > (route.kind === 'beach' ? .15 : .6));
  }
  const grid = 310 / 256, ix = 124, iz = 143;
  const x0 = -155 + ix * grid, z0 = -155 + iz * grid;
  const a = layout.heightAtRendered(x0, z0), b = layout.heightAtRendered(x0, z0 + grid);
  const d = layout.heightAtRendered(x0 + grid, z0), c = layout.heightAtRendered(x0 + grid, z0 + grid);
  assert.ok(Math.abs(layout.heightAtRendered(x0 + grid * .2, z0 + grid * .3) - (a * .5 + d * .2 + b * .3)) < .0001);
  assert.ok(Math.abs(layout.heightAtRendered(x0 + grid * .8, z0 + grid * .7) - (c * .5 + b * .2 + d * .3)) < .0001);
});

test('上山路曲折爬升且避免直穿陡崖，支路连到山景和洞口', () => {
  const layout = api().getIslandPathLayout({ caveEndpoint: cave });
  const hikes = layout.routes.filter(route => route.kind === 'mountain');
  assert.ok(hikes.length >= 1);
  let highest = 0;
  for (const route of hikes) {
    assert.ok(route.width >= 1.05 && route.width <= 1.35);
    let total = 0, maximumGrade = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], distance = length(a, b);
      assert.ok(distance > .00001 && distance <= .81);
      total += distance; maximumGrade = Math.max(maximumGrade, Math.abs(a.y - b.y) / distance);
      highest = Math.max(highest, b.y);
    }
    assert.ok(maximumGrade <= .65001, `山径不能沿${maximumGrade}的陡崖直上`);
    assert.equal(route.forceSteps, true, '上山路线须明确采用连续石阶');
    assert.ok(total > length(route.points[0], route.points.at(-1)) * 1.12, '山径应沿缓坡绕行');
  }
  assert.ok(highest > 30);
  const branch = layout.routes.find(route => route.id === 'cave-approach');
  assert.ok(branch && length(branch.points.at(-1), cave) < .01);
  assert.ok(layout.distanceAt(branch.points[0].x, branch.points[0].z) <= 0);
  const dock = layout.routes.find(route => route.id === 'dock-link');
  assert.ok(dock && dock.points.some(point => Math.hypot(point.x, point.z - 64.5) < 1));
});

test('三座真实峰顶都接入环岛道路网络，不能止步于山腰', () => {
  const layout = api().getIslandPathLayout({ caveEndpoint: cave });
  assert.equal(layout.summits?.length, 3, '必须提供三个实际峰顶');
  const centres = { west: { x: -17, z: -9 }, east: { x: 16, z: -22 }, south: { x: 11, z: 19 } };
  const step = 310 / 256;
  const connected = new Set(['coastal-loop']);
  for (let pass = 0; pass < layout.routes.length; pass++) for (const route of layout.routes) {
    if (connected.has(route.id)) continue;
    if ([route.points[0], route.points.at(-1)].some(endpoint => layout.routes.some(other => connected.has(other.id)
      && other.points.some(point => length(point, endpoint) < .00001)))) connected.add(route.id);
  }
  assert.equal(connected.size, layout.routes.length, '所有分叉与山脊步道须连续相接');
  for (const summit of layout.summits) {
    const centre = centres[summit.id]; assert.ok(centre);
    assert.ok(length(summit, centre) <= 5);
    let maximum = -Infinity;
    for (let iz = Math.floor((centre.z - 5 + 155) / step); iz <= Math.ceil((centre.z + 5 + 155) / step); iz++) {
      for (let ix = Math.floor((centre.x - 5 + 155) / step); ix <= Math.ceil((centre.x + 5 + 155) / step); ix++) {
        const x = -155 + ix * step, z = -155 + iz * step;
        if (Math.hypot(x - centre.x, z - centre.z) <= 5) maximum = Math.max(maximum, heightAt(x, z));
      }
    }
    assert.ok(summit.y >= maximum - .1, '终点必须接近真实局部最高点');
    const landing = layout.landings?.find(point => point.id === summit.id);
    assert.ok(landing, '真实峰尖旁须有可达的落脚位置');
    assert.ok(length(landing, summit) <= 2.5 && summit.y - landing.y <= 1 && landing.y <= summit.y + .00001);
    assert.ok(layout.routes.some(route => connected.has(route.id) && route.kind === 'mountain'
      && [route.points[0], route.points.at(-1)].some(point => length(point, landing) < .00001)));
  }
  assert.equal(layout.viewpoints.length, 3);
});

test('山路以缓坡回折为主，短陡段有石阶标记且全程贴实际网格', () => {
  const layout = api().getIslandPathLayout();
  let stepped = 0;
  for (const route of layout.routes.filter(item => item.kind === 'mountain')) {
    assert.ok(Array.isArray(route.stepSegments), '陡段需要可供真实石阶使用的metadata');
    const stairIndices = new Set(route.stepSegments.map(item => item.index));
    let total = 0, gentle = 0, run = 0, longestSteep = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], span = length(a, b), grade = Math.abs(b.y - a.y) / span;
      total += span; if (grade <= .85) gentle += span;
      if (grade > .85) run += span; else run = 0;
      longestSteep = Math.max(longestSteep, run);
      if (grade > .45) { assert.ok(stairIndices.has(i)); stepped++; }
      for (const point of [a, b]) assert.ok(Math.abs(point.y - layout.heightAtRendered(point.x, point.z) - .038) < .00001);
    }
    assert.ok(gentle / total > .70, '长路段应优先沿缓坡和鞍部');
    assert.equal(longestSteep, 0, '不能用短陡段绕过可走坡度的硬上限');
    for (const item of route.stepSegments) {
      assert.ok(Number.isInteger(item.index) && item.index > 0 && item.index < route.points.length);
      assert.ok(Number.isFinite(item.grade) && item.grade > .08 && item.grade <= .65001);
    }
  }
  assert.ok(stepped > 0);
});

test('山径与洞支路每个实际网格短段坡度均不超过0.65，普通泥土段不超过0.30', () => {
  const layout = api().getIslandPathLayout();
  for (const route of layout.routes.filter(item => item.kind === 'mountain' || item.kind === 'cave')) {
    let total = 0, gentle = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], span = length(a, b), pieces = Math.ceil(span / .025);
      let previous = layout.heightAtRendered(a.x, a.z);
      for (let at = 1; at <= pieces; at++) {
        const t = at / pieces, y = layout.heightAtRendered(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        const grade = Math.abs(y - previous) / (span / pieces);
        assert.ok(grade <= .65001, `${route.id} 实际网格局部坡${grade}不可行走`);
        if (!route.forceSteps) assert.ok(grade <= .30001, '普通土路须保持缓坡');
        if (grade <= .3) gentle += span / pieces;
        total += span / pieces; previous = y;
      }
    }
    if (!route.forceSteps) assert.ok(gentle / total > .5, `${route.id} 普通泥土路应以缓坡为主`);
  }
});

test('不设石阶的环岛和码头土路在实际网格面上全段坡度不超过0.30', () => {
  const layout = api().getIslandPathLayout();
  for (const route of layout.routes.filter(item => !item.forceSteps)) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], span = length(a, b), count = Math.ceil(span / .025);
    let last = layout.heightAtRendered(a.x, a.z);
    for (let j = 1; j <= count; j++) {
      const y = layout.heightAtRendered(a.x + (b.x - a.x) * j / count, a.z + (b.z - a.z) * j / count);
      assert.ok(Math.abs(y - last) / (span / count) <= .30001, `${route.id} 非石阶短段不能过陡`); last = y;
    }
  }
});

test('登山台地只切填沿路两米，实际网格仍保留岸线海床洞口和三座原峰', () => {
  const layout = api().getIslandPathLayout(), stats = layout.terrainStats;
  assert.ok(stats && stats.maxCut <= 2.000001 && stats.maxFill <= 2.000001);
  assert.ok(stats.affectedArea > 100 && stats.affectedArea < 2500, '只能修沿路台地，不能整体抹平山体');
  assert.ok(stats.maximumGrade <= .65001);
  const step = 310 / 256;
  let changed = 0;
  for (let iz = 0; iz <= 256; iz++) for (let ix = 0; ix <= 256; ix++) {
    const x = -155 + ix * step, z = -155 + iz * step, actual = layout.heightAtRendered(x, z), raw = heightAt(x, z);
    assert.ok(Number.isFinite(actual) && Math.abs(actual - raw) <= 2.000001);
    const local = caveToLocal({ x, y: raw, z }), inCave = Math.abs(local.side) <= 5.2
      && local.forward >= -CAVE_LAYOUT.depth - .8 && local.forward <= 3.2;
    if (shoreDistance(x, z) < 6 || inCave) assert.ok(Math.abs(actual - raw) < .000001, '岸线、泻湖/海床和洞物理区域必须保留');
    if (Math.abs(actual - raw) > .001) {
      changed++;
      assert.ok(layout.distanceAt(x, z) < 3.2, '台地改动必须局限在道路两侧');
    }
  }
  assert.ok(Math.abs(stats.affectedArea - changed * step * step) < .001);
  for (const top of layout.summits) assert.ok(Math.abs(layout.heightAtRendered(top.x, top.z) - top.y) < .000001);
});

test('自定义异常地形不能通过放宽坡度或返回NaN伪造安全路线', () => {
  assert.throws(() => api().getIslandPathLayout({ heightAt: () => NaN }), /高度必须有限/);
});

test('山路在已有鞍部节点分叉，避免沿峰顶进路重复铺两条长重合路面', () => {
  const routes = api().getIslandPathLayout().routes.filter(route => route.kind === 'mountain');
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    let run = 0, longest = 0;
    for (let at = 1; at < routes[i].points.length; at++) {
      const a = routes[i].points[at - 1], b = routes[i].points[at], middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const overlap = routes[j].points.slice(1).some((d, index) => {
        const c = routes[j].points[index], dx = d.x - c.x, dz = d.z - c.z;
        const t = Math.max(0, Math.min(1, ((middle.x - c.x) * dx + (middle.z - c.z) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(middle.x - c.x - dx * t, middle.z - c.z - dz * t) < .08;
      });
      run = overlap ? run + length(a, b) : 0; longest = Math.max(longest, run);
    }
    assert.ok(longest < 3, `${routes[i].id}与${routes[j].id}不能长段重叠重复铺面`);
  }
});

test('登山回折留出全宽石阶通道，非相邻路段不能靠微型锯齿叠面爬升', () => {
  const layout = api().getIslandPathLayout();
  for (const route of layout.routes.filter(item => item.kind === 'mountain')) {
    const arc = [0];
    for (let i = 1; i < route.points.length; i++) arc.push(arc.at(-1) + length(route.points[i - 1], route.points[i]));
    for (let i = 0; i < route.points.length; i++) for (let j = i + 1; j < route.points.length; j++) {
      if (arc[j] - arc[i] <= 4) continue;
      assert.ok(length(route.points[i], route.points[j]) >= 1.4,
        `${route.id} 相隔${(arc[j] - arc[i]).toFixed(2)}m的回折只有${length(route.points[i], route.points[j]).toFixed(2)}m净间距`);
    }
  }
});

test('三峰网络只初始化一次，初始化和林地批量保留查询在可交互预算内', () => {
  const start = performance.now(), sampleHeight = (x, z) => heightAt(x, z);
  const layout = api().getIslandPathLayout({ heightAt: sampleHeight });
  assert.ok(performance.now() - start < 4000, '网络规划不能长时间阻塞启动');
  const queryStart = performance.now();
  for (let i = 0; i < 40000; i++) layout.distanceAt(Math.sin(i * .71) * 73, Math.cos(i * .43) * 73);
  assert.ok(performance.now() - queryStart < 2500, '批量清树查询需要继续使用空间索引');
  assert.equal(layout, api().getIslandPathLayout({ heightAt: sampleHeight }));
});

test('石阶海滩支路从山脚接现有环岛节点，持续下降至南侧干沙而非止步海岸路', () => {
  const layout = api().getIslandPathLayout(), descent = layout.routes.find(route => route.id === 'beach-descent');
  assert.ok(descent, '需要从山脚真正下到海滩的独立石阶支路');
  assert.equal(descent.kind, 'beach'); assert.equal(descent.forceSteps, true);
  assert.ok(descent.width >= 1.05 && descent.width <= 1.35);
  const start = descent.points[0], end = descent.points.at(-1);
  assert.ok(start.y >= 4 && start.y <= 6.1);
  assert.ok(layout.routes.find(route => route.id === 'mountain-ascent').points.some(point => length(point, start) < .00001));
  const ring = layout.routes.find(route => route.id === 'coastal-loop');
  assert.ok(descent.points.some(point => ring.points.some(other => length(point, other) < .00001)), '需精确连接环岛现有节点');
  assert.ok(shoreDistance(end.x, end.z) >= 3 && shoreDistance(end.x, end.z) <= 4.5);
  assert.ok(end.y >= .43 && end.y <= .8);
  assert.ok(end.x < -8 && end.x > -25 && end.z > 70, '终点避开码头和右侧泻湖');
  let total = 0, maximumGrade = 0, upward = 0, stairCount = 0;
  const steps = new Set(descent.stepSegments.map(item => item.index));
  for (let i = 1; i < descent.points.length; i++) {
    const a = descent.points[i - 1], b = descent.points[i], span = length(a, b), grade = Math.abs(b.y - a.y) / span;
    total += span; maximumGrade = Math.max(maximumGrade, grade); upward += Math.max(0, b.y - a.y);
    assert.ok(span > .000001 && span <= .81);
    assert.ok([b.x, b.y, b.z].every(Number.isFinite));
    assert.ok(shoreDistance(b.x, b.z) >= 1 && layout.heightAtRendered(b.x, b.z) > .25, '全程在干沙/山脚，不穿海');
    assert.ok(Math.abs(b.y - layout.heightAtRendered(b.x, b.z) - .038) < .00001);
    if (grade > .08) { assert.ok(steps.has(i)); stairCount++; }
  }
  assert.ok(total > 20 && maximumGrade < .8);
  assert.ok(upward < .3, '下山至沙滩不应绕上更高的山坡');
  assert.ok(stairCount > 15, '台阶通道要覆盖持续下降段');
  assert.equal(layout.summits.length, 3, '既有三峰仍保持');
});

test('空间查询返回道路外缘距离，树草保留通道且远点不会误清空', () => {
  const m = api(), layout = m.getIslandPathLayout();
  for (const route of layout.routes) for (let i = 3; i < route.points.length - 3; i += 31) {
    const point = route.points[i];
    assert.ok(m.pathDistanceAt(point.x, point.z, layout) <= -route.width * .49);
  }
  assert.ok(layout.distanceAt(140, 140) > 40);
  assert.equal(layout.distanceAt(NaN, 2), Infinity);
  const before = layout.routes.map(route => route.points.length);
  for (let i = 0; i < 10000; i++) layout.distanceAt(Math.sin(i * .71) * 73, Math.cos(i * .43) * 73);
  assert.deepEqual(layout.routes.map(route => route.points.length), before);
});

test('保留查询与独立逐线段距离一致，不因空间网格边界漏掉道路', () => {
  const layout = api().getIslandPathLayout();
  for (const [x, z] of [[0, 0], [50, 50], [-40, 32], [-64, -30], [8, 52], [31.874, 38.343], [80, 4]]) {
    let expected = Infinity;
    for (const route of layout.routes) for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
      const amount = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      expected = Math.min(expected, Math.hypot(x - a.x - dx * amount, z - a.z - dz * amount) - route.width * .5);
    }
    assert.ok(Math.abs(layout.distanceAt(x, z) - expected) < .00001);
  }
});

test('真实路面每个三角形都贴住terrain面，路边装饰有限且不占通道', () => {
  assert.ok(scenery?.createIslandPaths, '道路需要可复用的真实路面与沿路装饰');
  const parent = new THREE.Group(), layout = api().getIslandPathLayout();
  const paths = scenery.createIslandPaths(parent, { heightAt, layout });
  const road = paths.group.children.find(mesh => mesh.name === '环岛沙土与登山小径');
  assert.ok(road?.isMesh && road.receiveShadow && road.material.polygonOffset);
  const points = road.geometry.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < points.count; i += 3) {
    a.fromBufferAttribute(points, i); b.fromBufferAttribute(points, i + 1); c.fromBufferAttribute(points, i + 2);
    const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3, y = (a.y + b.y + c.y) / 3;
    assert.ok(y - layout.heightAtRendered(x, z) >= .02 && y - layout.heightAtRendered(x, z) <= .08);
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).y > 0, '路面正面应朝上');
  }
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const mesh of paths.group.children.filter(item => item.isInstancedMesh)) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); assert.ok(matrix.elements.every(Number.isFinite));
    position.setFromMatrixPosition(matrix); assert.ok(layout.distanceAt(position.x, position.z) >= .09);
  }
  assert.ok(paths.counts.flowers > 40 && paths.counts.grass > 100 && paths.counts.pebbles > 150);
  paths.dispose();
});

test('花朵按季节收放，更新不重建geometry，dispose去重且幂等', () => {
  assert.ok(scenery?.createIslandPaths);
  const parent = new THREE.Group(), paths = scenery.createIslandPaths(parent, { heightAt, layout: api().getIslandPathLayout() });
  const flowers = paths.group.children.find(mesh => mesh.name === '路旁细小野花');
  const meshes = [...paths.group.children], geometries = new Set(meshes.map(mesh => mesh.geometry));
  const resources = new Set();
  for (const mesh of meshes) { resources.add(mesh.geometry); resources.add(mesh.material); if (mesh.material.map) resources.add(mesh.material.map); }
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  paths.update(0, { season: 'spring' }); const full = flowers.count;
  paths.update(20, { season: 'autumn' }); assert.ok(flowers.count < full && flowers.count > 0);
  paths.update(40, { season: 'winter' }); assert.equal(flowers.count, 0); assert.equal(flowers.visible, false);
  paths.update(60, { season: 'summer' }); assert.ok(flowers.count > full * .5);
  assert.deepEqual(new Set(paths.group.children.map(mesh => mesh.geometry)), geometries);
  paths.dispose(); paths.dispose(); paths.update(70, {});
  assert.equal(parent.children.length, 0); assert.equal(paths.group.children.length, 0);
  assert.ok([...counts.values()].every(count => count === 1));
});

test('沿路草花与石子在实际位置贴住地形三角面，偏移后不会悬空或埋入', () => {
  const parent = new THREE.Group(), layout = api().getIslandPathLayout();
  const paths = scenery.createIslandPaths(parent, { heightAt, layout });
  paths.update(0, { season: 'spring' });
  const terrain = new THREE.PlaneGeometry(310, 310, 256, 256); terrain.rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, layout.heightAtRendered(positions.getX(i), positions.getZ(i)));
  const patchGeometry = new THREE.BufferGeometry();
  patchGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), patch = new THREE.Mesh(patchGeometry, material);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), step = 310 / 256;
  for (const mesh of paths.group.children.filter(item => item.isInstancedMesh)) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
    const cell = Math.floor((position.z + 155) / step) * 256 + Math.floor((position.x + 155) / step);
    for (let corner = 0; corner < 6; corner++) {
      const vertex = terrain.index.getX(cell * 6 + corner);
      patchGeometry.attributes.position.setXYZ(corner, positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
    }
    patchGeometry.computeBoundingSphere(); ray.ray.origin.set(position.x, 200, position.z);
    const hit = ray.intersectObject(patch)[0]; assert.ok(hit, '根部下方应是实际地形面');
    const expectedGap = mesh.name === '路旁零散碎石' ? scale.z * .27 : -.015;
    assert.ok(Math.abs(position.y - hit.point.y - expectedGap) < .0001,
      `${mesh.name} 第${i}株根部偏离实际地面 ${position.y - hit.point.y}m`);
  }
  paths.dispose(); terrain.dispose(); patchGeometry.dispose(); material.dispose();
});

test('草花和碎石避开真实洞体与入口地板，洞外观赏走廊仍保留路旁装饰', () => {
  const parent = new THREE.Group(), layout = api().getIslandPathLayout({ caveEndpoint: cave });
  const paths = scenery.createIslandPaths(parent, { heightAt, layout });
  paths.update(0, { season: 'spring' });
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const mesh of paths.group.children.filter(item => item.isInstancedMesh)) {
    let corridorCount = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      const local = caveToLocal(position), betweenWalls = Math.abs(local.side) <= 5.2;
      const inPhysicalCave = betweenWalls && local.forward >= -CAVE_LAYOUT.depth - .8 && local.forward <= 3.2;
      assert.equal(inPhysicalCave, false, `${mesh.name} 第${i}处不能长入开洞地形或洞口地板`);
      if (betweenWalls && local.forward > 3.2 && local.forward <= 24) corridorCount++;
    }
    assert.ok(corridorCount > 0, `${mesh.name} 仍应出现在洞外观赏走廊沿路`);
  }
  paths.dispose();
});
