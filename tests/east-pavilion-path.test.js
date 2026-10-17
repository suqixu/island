import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIslandPaths } from '../src/island-paths.js';
import { getIslandPathLayout } from '../src/path-layout.js';
import { CAVE_LAYOUT } from '../src/cave-layout.js';
import { REST_PAVILION_SITES } from '../src/rest-pavilion-layout.js';
import { createRestPavilion } from '../src/rest-pavilion.js';
import { createPavilionSurfaceSampler } from '../src/rest-pavilion-surface.js';

test('东峰主梯接入转身平台时没有被盖住的踏面或只剩两厘米的残阶', () => {
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const paths = createIslandPaths(new THREE.Group(), { layout, heightAt: layout.heightAtRendered });
  let probeGeometry;
  try {
    const stone = paths.group.getObjectByName('山径天然石阶');
    const positions = stone.geometry.attributes.position, normals = stone.geometry.attributes.normal, caps = [];
    // Probe the rendered horizontal triangles around the reported joint.
    // Keeping only this region makes dense footstep checks inexpensive.
    for (let i = 0; i < positions.count; i += 3) {
      if (normals.getY(i) < .9999) continue;
      if ([0, 1, 2].some(j => positions.getX(i + j) < 11 || positions.getX(i + j) > 14.5
        || positions.getZ(i + j) < -24 || positions.getZ(i + j) > -19.5)) continue;
      for (let j = 0; j < 3; j++) caps.push(positions.getX(i + j), positions.getY(i + j), positions.getZ(i + j));
    }
    probeGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(caps, 3));
    const probe = new THREE.Mesh(probeGeometry, stone.material);
    const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), q = Math.SQRT1_2;
    const centreV = -8.45 * q;
    for (const offset of [-.487, .013, .487]) {
      let previous, lastRiser;
      for (let u = 22.9913; u < 24.211; u += .0061) {
        const v = centreV + offset;
        down.ray.origin.set((u + v) * q, 100, (v - u) * q);
        const levels = [...new Set(down.intersectObject(probe, false).map(hit => hit.point.y.toFixed(4)))].map(Number);
        assert.equal(levels.length, 1, `主梯接头不能有平台盖着下层踏面 u=${u},offset=${offset},levels=${levels}`);
        if (previous !== undefined && levels[0] - previous > .001) {
          if (lastRiser !== undefined) assert.ok(u - lastRiser >= .27,
            `上一级必须保留完整落脚深度，不能被平台截成短唇 depth=${u - lastRiser}`);
          assert.ok(levels[0] - previous <= .1951, '接头不能出现超过19.5cm的高坎');
          lastRiser = u;
        }
        assert.ok(previous === undefined || levels[0] >= previous - .0001, '接头上行不能反跌');
        previous = levels[0];
      }
    }
  } finally { probeGeometry?.dispose(); paths.dispose(); }
});

test('东峰末四米消除逆坎，最终一米以上路面组成同高整宽转身平台', () => {
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const paths = createIslandPaths(new THREE.Group(), { layout, heightAt: layout.heightAtRendered });
  try {
    const mesh = paths.group.getObjectByName('山径天然石阶');
    const rows = mesh.geometry.userData.rows.filter(row => row.routeId === 'ridge-east'), total = rows.at(-1).end;
    const terminal = rows.filter(row => row.start >= total - 4);
    for (let i = 1; i < terminal.length; i++) {
      assert.ok(terminal[i].top >= terminal[i - 1].top - .00002, '上行不能在转弯前忽然反跌13.55cm');
      assert.ok(terminal[i].top - terminal[i - 1].top <= .19502);
    }
    const landing = [rows.at(-1)];
    assert.ok(landing.reduce((sum, row) => sum + row.run, 0) >= 1.1, '终点需要可转身的连续平台');
    assert.ok(landing.every(row => row.role === 'landing' && Math.abs(row.width - 1.1) < .000001));
    assert.ok(Math.max(...landing.map(row => row.top)) - Math.min(...landing.map(row => row.top)) < .00002,
      '保留真实转弯 footprint 的相邻平台应共面，不能仍是高低破碎板');
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const samples = [[12.8, -22.05], [12.6, -22.05], [12.4, -22.05], [12.8, -21.7], [12.6, -21.7], [12.4, -21.7],
      [13.160873004131071, -22.17931418974491]];
    for (const [x, z] of samples) {
      ray.ray.origin.set(x, 100, z); const hit = ray.intersectObject(mesh, false)[0];
      assert.ok(hit && Math.abs(hit.point.y - landing.at(-1).top) < .00002, '真正平台内要有整宽共面石踏面');
    }
    const route = layout.routes.find(route => route.id === 'ridge-east'), arc = [0];
    for (let i = 1; i < route.points.length; i++) arc.push(arc.at(-1)
      + Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].z - route.points[i - 1].z));
    for (const offset of [-.45, 0, .45]) {
      let previous;
      for (let distance = total - 3.9; distance < total - .015; distance += .01) {
        let i = 1; while (i < arc.length - 1 && arc[i] < distance) i++;
        const a = route.points[i - 1], b = route.points[i], span = arc[i] - arc[i - 1], t = (distance - arc[i - 1]) / span;
        const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span;
        ray.ray.origin.set(a.x + (b.x - a.x) * t - dz * offset, 100, a.z + (b.z - a.z) * t + dx * offset);
        const hit = ray.intersectObject(mesh, false)[0];
        assert.ok(hit, '末四米三条实际脚位都要有落脚石面');
        if (previous !== undefined) {
          assert.ok(hit.point.y >= previous - .00002, `真实交叠踏面不能留下隐藏的反坎 distance=${distance},offset=${offset},from=${previous},to=${hit.point.y}`);
          assert.ok(hit.point.y - previous <= .19502, '真实上行步差不超过19.5cm');
        }
        previous = hit.point.y;
      }
    }
  } finally { paths.dispose(); }
});

test('东峰转身落脚面至门前石阶正对开放入口，不再斜切木台门框', () => {
  const site = REST_PAVILION_SITES.find(site => site.id === 'east');
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const scene = new THREE.Scene(), paths = createIslandPaths(scene, { layout, heightAt: layout.heightAtRendered });
  const heightAt = createPavilionSurfaceSampler({ group: paths.group, heightAtRendered: layout.heightAtRendered }, [site]);
  const pavilion = createRestPavilion(scene, { ...site, heightAt,
    approach: { ...site.approach, y: heightAt(site.approach.x, site.approach.z) } });
  try {
    const entry = pavilion.group.userData.entranceWorld;
    const connection = new THREE.Vector3(site.approach.x - entry.x, 0, site.approach.z - entry.z).normalize();
    const facing = new THREE.Vector3(Math.sin(pavilion.group.rotation.y), 0, Math.cos(pavilion.group.rotation.y));
    assert.ok(connection.dot(facing) > .9998, '入口与连接台阶应同轴，不能仍偏约四十四度');
    assert.ok(Math.abs(heightAt(site.approach.x, site.approach.z) - site.approach.y) < .00002,
      '保存的接头高度应等于实际转身石面');
    const steps = pavilion.group.children.filter(mesh => mesh.name.startsWith('山亭入口石阶'));
    const treadTops = [];
    for (const step of steps) {
      const position = step.geometry.attributes.position, normal = step.geometry.attributes.normal, index = step.geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        if (ids.some(id => normal.getY(id) < .9999) || Math.abs(ids.reduce((sum, id) => sum + position.getX(id), 0) / 3) > .45) continue;
        const top = position.getY(ids[0]) + pavilion.group.position.y;
        if (!treadTops.some(value => Math.abs(value - top) < .00002)) treadTops.push(top);
      }
    }
    treadTops.sort((a, b) => b - a);
    assert.equal(treadTops.length, 1, '十五厘米总高差应接一块完整落脚面，不能拆成两条五厘米薄阶');
    const landingBounds = new THREE.Box3().setFromBufferAttribute(steps[0].geometry.attributes.position);
    assert.ok(landingBounds.max.x - landingBounds.min.x >= 1.095,
      '接亭落脚面应与1.1m主梯整宽一致');
    assert.ok(landingBounds.max.z - landingBounds.min.z > .65 && landingBounds.max.z - landingBounds.min.z < .9,
      '接阶需是一块能完整站立的落脚面，并让已有平台继续供应下段而非叠放长薄唇');
    const previous = [pavilion.group.position.y];
    for (const top of treadTops) {
      assert.ok(Math.abs(top - previous.at(-1)) <= .19001, '进入木台前保持正常小步差');
      previous.push(top);
    }
  } finally { pavilion.dispose(); paths.dispose(); }
});

test('东亭最后接头是一块整宽石平台，没有交叠顶面和斜插的小薄阶', () => {
  const site = REST_PAVILION_SITES.find(site => site.id === 'east');
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const scene = new THREE.Scene(), paths = createIslandPaths(scene, { layout, heightAt: layout.heightAtRendered });
  const heightAt = createPavilionSurfaceSampler({ group: paths.group, heightAtRendered: layout.heightAtRendered }, [site]);
  const pavilion = createRestPavilion(scene, { ...site, heightAt,
    approach: { ...site.approach, y: heightAt(site.approach.x, site.approach.z) } });
  try {
    scene.updateMatrixWorld(true);
    const stone = paths.group.getObjectByName('山径天然石阶');
    const level = heightAt(site.approach.x, site.approach.z);
    const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let checked = 0;
    // Offset the probes from triangle edges: two horizontal hits then mean
    // real overlapping cap area, rather than a shared triangulation seam.
    for (let x = 12.367; x < 13.2; x += .071) for (let z = -22.083; z < -21.2; z += .073) {
      down.ray.origin.set(x, 100, z);
      const caps = down.intersectObject(stone, false).filter(hit => Math.abs(hit.point.y - level) < .00002 && hit.face.normal.y > .99);
      if (!caps.length) continue;
      assert.equal(caps.length, 1, `同高平台不能叠着多块斜拼顶面 point=${x},${z}`);
      checked++;
    }
    assert.ok(checked > 40, '需检查实际转身平台的整片面积');
    const positions = stone.geometry.attributes.position, points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let groundedEdges = 0;
    for (let i = 0; i < positions.count; i += 3) {
      for (let j = 0; j < 3; j++) points[j].fromBufferAttribute(positions, i + j).applyMatrix4(stone.matrixWorld);
      if (points.some(p => p.x < 11 || p.x > 14 || p.z < -24 || p.z > -20)) continue;
      const bottom = points.filter(p => {
        const gap = p.y - layout.heightAtRendered(p.x, p.z);
        return gap >= -.065 && gap < -.035;
      });
      if (bottom.length !== 2) continue;
      for (let sample = 0; sample <= 12; sample++) {
        const point = bottom[0].clone().lerp(bottom[1], sample / 12);
        const gap = point.y - layout.heightAtRendered(point.x, point.z);
        assert.ok(gap >= -.09 && gap < .002, `新平台外露底边应逐真实三角面贴地，不悬空或深埋 gap=${gap},point=${point.x},${point.z}`);
      }
      groundedEdges++;
    }
    assert.ok(groundedEdges > 8, '应密查平台完整外轮廓的实际基础边');
    const entry = pavilion.group.userData.entranceWorld;
    const dx = site.approach.x - entry.x, dz = site.approach.z - entry.z, run = Math.hypot(dx, dz);
    const steps = pavilion.group.children.filter(mesh => mesh.name.startsWith('山亭入口石阶'));
    for (const t of [.74, .84, .96]) for (const offset of [-.5, 0, .5]) {
      const x = entry.x + dx * t - dz / run * offset, z = entry.z + dz * t + dx / run * offset;
      down.ray.origin.set(x, 100, z);
      const landing = down.intersectObject(stone, false)[0];
      assert.ok(landing && Math.abs(landing.point.y - level) < .00002, '门前末段整个宽度应收进平整平台，不能留下三角尖角');
      const cap = down.intersectObjects(steps, false)[0];
      assert.ok(!cap || cap.point.y <= level + .002, '既有站立平台上不能再斜插三四厘米的小薄阶');
    }
  } finally { pavilion.dispose(); paths.dispose(); }
});

test('东亭平台外边收成正交轮廓，入口阶复用山径石材和季节驱动', () => {
  const site = REST_PAVILION_SITES.find(site => site.id === 'east');
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const scene = new THREE.Scene(), paths = createIslandPaths(scene, { layout, heightAt: layout.heightAtRendered });
  const stone = paths.group.getObjectByName('山径天然石阶');
  const heightAt = createPavilionSurfaceSampler({ group: paths.group, heightAtRendered: layout.heightAtRendered }, [site]);
  const pavilion = createRestPavilion(scene, { ...site, heightAt, stoneSurface: stone,
    approach: { ...site.approach, y: heightAt(site.approach.x, site.approach.z) } });
  try {
    scene.updateMatrixWorld(true);
    const level = heightAt(site.approach.x, site.approach.z), angle = pavilion.group.rotation.y;
    const sin = Math.sin(angle), cos = Math.cos(angle), position = stone.geometry.attributes.position;
    const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let outsideEdges = 0;
    for (let i = 0; i < position.count; i += 3) {
      for (let j = 0; j < 3; j++) points[j].fromBufferAttribute(position, i + j);
      if (points.some(p => p.x < 11 || p.x > 14 || p.z < -24 || p.z > -20)) continue;
      const top = points.filter(p => Math.abs(p.y - level) < .00002);
      if (top.length !== 2 || points.every(p => p.y >= level - .01)) continue;
      const dx = top[1].x - top[0].x, dz = top[1].z - top[0].z;
      assert.ok(Math.abs(dx * cos - dz * sin) < .00001 || Math.abs(dx * sin + dz * cos) < .00001,
        '平台实际外边应与门框平行或垂直，不能保留突出的三角尖角');
      outsideEdges++;
    }
    assert.ok(outsideEdges >= 8, '核对的是完整实体侧墙的顶沿');
    const steps = pavilion.group.children.filter(mesh => mesh.name.startsWith('山亭入口石阶'));
    assert.equal(steps.length, 1, '完整入口阶应合并绘制，避免重复的石材Mesh');
    assert.equal(steps[0].material, stone.material, '上部入口阶必须使用同一山径材质而非浅黄模型石材');
    const geometry = steps[0].geometry;
    assert.ok(geometry.attributes.color && geometry.attributes.uv, '共享山径材质要带真实石色和世界纹理坐标');
    for (let i = 0; i < geometry.attributes.color.count; i++) {
      assert.ok(geometry.attributes.color.getX(i) < .7, '不能用默认纯白顶点色把上部石阶照成浅黄');
      const point = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(steps[0].matrixWorld);
      assert.ok(Math.abs(geometry.attributes.uv.getX(i) - point.x / 2.8) < .00001
        && Math.abs(geometry.attributes.uv.getY(i) - point.z / 2.8) < .00001, '共享石纹应在接头连续');
    }
    let released = 0; stone.material.addEventListener('dispose', () => released++);
    paths.update(1, { season: 'winter' }); pavilion.update(1, { season: 'winter' });
    pavilion.dispose();
    assert.equal(released, 0, '亭子不拥有山径共享材质的释放权');
    paths.dispose(); assert.equal(released, 1);
  } finally { pavilion.dispose(); paths.dispose(); }
});

test('东亭高侧裙与入口阶按坡面分层支撑，不留下整片一米多高外墙', () => {
  const site = REST_PAVILION_SITES.find(site => site.id === 'east');
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  const scene = new THREE.Scene(), paths = createIslandPaths(scene, { layout, heightAt: layout.heightAtRendered });
  const stone = paths.group.getObjectByName('山径天然石阶');
  const heightAt = createPavilionSurfaceSampler({ group: paths.group, heightAtRendered: layout.heightAtRendered }, [site]);
  const pavilion = createRestPavilion(scene, { ...site, heightAt, stoneSurface: stone,
    approach: { ...site.approach, y: heightAt(site.approach.x, site.approach.z) } });
  try {
    scene.updateMatrixWorld(true);
    let walls = 0;
    for (const mesh of [stone, ...pavilion.group.children.filter(m => m.name.startsWith('山亭入口石阶'))]) {
      const geometry = mesh.geometry, p = geometry.attributes.position, index = geometry.index;
      const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let i = 0; i < (index?.count ?? p.count); i += 3) {
        for (let j = 0; j < 3; j++) vertices[j].fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
        if (vertices.some(v => v.x < 11.8 || v.x > 13.8 || v.z < -23.4 || v.z > -20.8)) continue;
        const normal = new THREE.Vector3().subVectors(vertices[1], vertices[0])
          .cross(new THREE.Vector3().subVectors(vertices[2], vertices[0])).normalize();
        if (Math.abs(normal.y) > .25) continue;
        assert.ok(Math.max(...vertices.map(v => v.y)) - Math.min(...vertices.map(v => v.y)) < .23,
          '东亭平台和上部阶的侧面必须实际分层，不能保留1.39m矩形墙');
        walls++;
      }
    }
    assert.ok(walls > 20);
    // This is the exposed high side visible in the actual East pavilion view.
    // Measure rendered support, not an outset setting or a vertex count.
    const level = heightAt(site.approach.x, site.approach.z);
    const outward = new THREE.Vector3(site.entranceDirection.z, 0, -site.entranceDirection.x).normalize();
    const ray = new THREE.Raycaster(new THREE.Vector3(), outward.clone().negate()), profile = [];
    for (const drop of [.10, .44, .90]) {
      ray.ray.origin.set(13.763309 + outward.x * 2, level - drop, -21.427071 + outward.z * 2);
      const hit = ray.intersectObject(stone, false)[0];
      assert.ok(hit, '高平台侧面仍需真实连续支撑到坡脚');
      profile.push(hit.point.dot(outward));
    }
    assert.ok(profile[2] - profile[0] > .24 && profile[2] - profile[0] < .9,
      '东亭高侧墙应明显顺坡展开，不能继续以不足二十厘米的收分保留方墩轮廓');
  } finally { pavilion.dispose(); paths.dispose(); }
});
