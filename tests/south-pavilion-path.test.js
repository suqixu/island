import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandPaths } from '../src/island-paths.js';
import { getIslandPathLayout } from '../src/path-layout.js';
import { CAVE_LAYOUT } from '../src/cave-layout.js';
import { REST_PAVILION_SITES } from '../src/rest-pavilion-layout.js';
import { createRestPavilion } from '../src/rest-pavilion.js';
import { createPavilionSurfaceSampler } from '../src/rest-pavilion-surface.js';

function actualFlight() {
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const paths = createIslandPaths(new THREE.Group(), { layout, heightAt: layout.heightAtRendered });
  const mesh = paths.group.getObjectByName('山径天然石阶');
  const route = layout.routes.find(route => route.id === 'mountain-ascent');
  const rows = mesh.geometry.userData.rows.filter(row => row.routeId === route.id);
  const arc = [0];
  for (let i = 1; i < route.points.length; i++) arc.push(arc.at(-1)
    + Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].z - route.points[i - 1].z));
  const pointAt = distance => {
    let i = 1; while (i < arc.length - 1 && arc[i] < distance) i++;
    const a = route.points[i - 1], b = route.points[i], length = arc[i] - arc[i - 1], t = (distance - arc[i - 1]) / length;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
      dx: (b.x - a.x) / length, dz: (b.z - a.z) / length };
  };
  return { paths, mesh, rows, total: arc.at(-1), pointAt };
}

test('南峰亭前实际直梯三条脚线持续上行，没有高侧岩面制造的反坎', () => {
  const flight = actualFlight(), ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  try {
    for (const offset of [-.45, 0, .45]) {
      let previous;
      for (let distance = flight.total - 3.05; distance < flight.total - .015; distance += .01) {
        const p = flight.pointAt(distance);
        ray.ray.origin.set(p.x - p.dz * offset, 100, p.z + p.dx * offset);
        const hit = ray.intersectObject(flight.mesh, false)[0];
        assert.ok(hit, '固定1.1m通道内的脚位需要有真实连续踏面');
        if (previous !== undefined) {
          assert.ok(hit.point.y >= previous - .00002, `亭前上行不可忽然下跌 ${hit.point.y - previous}m`);
          assert.ok(hit.point.y - previous <= .19502, '每级实际步差仍应不超过19.5cm');
        }
        previous = hit.point.y;
      }
    }
  } finally { flight.paths.dispose(); }
});

test('亭前保留足够踏深和整宽平缓落脚面，接头高度与固定木亭入口相容', () => {
  const flight = actualFlight();
  try {
    const terminal = flight.rows.at(-1), stairs = flight.rows.filter(row => row.start >= flight.total - 3.1);
    assert.ok(stairs.length >= 5 && stairs.length <= 9, '最后直梯应减少短密踏面，并保留可辨的阶梯');
    assert.ok(stairs.filter(row => row !== terminal).every(row => row.run >= .30 && row.run <= .50), '正常上行踏深应至少30cm');
    assert.equal(terminal.role, 'landing');
    assert.ok(terminal.run >= .8 && terminal.run <= 1.05, '门前应有可站稳转身的短平台');
    assert.ok(stairs.every(row => Math.abs(row.width - 1.1) < .000001));
    const site = REST_PAVILION_SITES.find(site => site.id === 'south');
    const ray = new THREE.Raycaster(new THREE.Vector3(site.approach.x, 100, site.approach.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(flight.mesh, false)[0];
    assert.ok(hit && Math.abs(hit.point.y - site.approach.y) < .00002, '固定接头不能因重分阶梯被抬高或悬断');
  } finally { flight.paths.dispose(); }
});

test('南亭木台直接接原路平台，不再叠放门前窄长石条', () => {
  const flight = actualFlight(), scene = new THREE.Scene(); scene.add(flight.paths.group);
  const site = REST_PAVILION_SITES.find(site => site.id === 'south');
  const heightAt = createPavilionSurfaceSampler({ group: flight.paths.group,
    heightAtRendered: getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach }).heightAtRendered }, [site]);
  const pavilion = createRestPavilion(scene, { ...site, heightAt,
    approach: { ...site.approach, y: heightAt(site.approach.x, site.approach.z) } });
  try {
    assert.equal(pavilion.group.children.filter(mesh => mesh.name.startsWith('山亭入口石阶')).length, 0,
      '原平台已到木台边时，必须移除重复的横长薄石条');
    scene.updateMatrixWorld(true);
    const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const deck = pavilion.group.getObjectByName('山亭架空木台地板'), entry = pavilion.group.userData.entranceWorld;
    for (const offset of [-.5, 0, .5]) {
      let previous;
      for (let i = 0; i <= 30; i++) {
        down.ray.origin.set(entry.x - .04 + .24 * i / 30, 100, entry.z + offset);
        const hits = down.intersectObjects([deck, flight.mesh], false);
        assert.ok(hits.length, '去掉石条后原平台和木台仍需整宽无缝接合');
        if (previous !== undefined) assert.ok(Math.abs(hits[0].point.y - previous) < .19501);
        previous = hits[0].point.y;
      }
    }
  } finally { pavilion.dispose(); flight.paths.dispose(); }
});

test('南亭前露出的支撑是连续粗石斜面，邻阶之间不再保留整片高封墙', () => {
  const flight = actualFlight();
  try {
    const p = flight.mesh.geometry.attributes.position;
    const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let walls = 0;
    for (let i = 0; i < p.count; i += 3) {
      for (let j = 0; j < 3; j++) vertices[j].fromBufferAttribute(p, i + j);
      if (vertices.some(v => v.x < 11.6 || v.x > 13.34 || v.z < 18.5 || v.z > 20.2)) continue;
      const normal = new THREE.Vector3().subVectors(vertices[1], vertices[0])
        .cross(new THREE.Vector3().subVectors(vertices[2], vertices[0])).normalize();
      if (Math.abs(normal.y) > .25) continue;
      assert.ok(Math.max(...vertices.map(v => v.y)) - Math.min(...vertices.map(v => v.y)) < .23,
        '侧面实物不能继续由一整片近一米高直墙组成');
      walls++;
    }
    assert.ok(walls > 12, '要检查真实支撑面而非只看平整踏面');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const top = flight.rows.at(-1).top, profile = [];
    for (const drop of [.10, .44, .72]) {
      ray.ray.origin.set(12.85, top - drop, 18);
      const hit = ray.intersectObject(flight.mesh, false)[0];
      assert.ok(hit, '外侧石层需要连续支撑，不能只删除墙留下空腔');
      profile.push(hit.point.z);
    }
    assert.ok(profile[0] - profile[2] > .04 && profile[0] - profile[2] < .19,
      '下层应小幅顺坡展开，使整片高墙实际收分，不是只细分共面三角形');
    let previous, straightSamples = 0, longestStraight = 0;
    for (let drop = .08; drop <= .72; drop += .02) {
      ray.ray.origin.set(12.85, top - drop, 18);
      const hit = ray.intersectObject(flight.mesh, false)[0];
      assert.ok(hit, '连续粗石斜面不能在旧环阶位置留下裂缝');
      straightSamples = previous !== undefined && Math.abs(hit.point.z - previous) < .00001 ? straightSamples + 1 : 0;
      longestStraight = Math.max(longestStraight, straightSamples); previous = hit.point.z;
    }
    assert.ok(longestStraight < 3, '外裙应沿总高连续收分，不能仍由直立层面和水平环阶相连');
  } finally { flight.paths.dispose(); }
});
