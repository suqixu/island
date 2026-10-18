import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { getIslandPathLayout } from '../src/path-layout.js';
import { CAVE_LAYOUT } from '../src/cave-layout.js';
import { createRestPavilion } from '../src/models/rest-pavilion.js';
import { createPavilionSurfaceSampler } from '../src/rest-pavilion-surface.js';

const layoutModule = await import('../src/rest-pavilion-layout.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

// This test copies actual rendered triangles, then lets Three raycast them.
// It does not reuse the sampler's triangle selection, normals, or barycentric code.
function actualPatch(source, site) {
  source.updateWorldMatrix(true, false);
  const positions = source.geometry.attributes.position, indices = source.geometry.index;
  const count = indices ? indices.count : positions.count, copied = [];
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const anchor = site.approach || site.position;
  const minX = Math.min(site.position.x, anchor.x) - 7, maxX = Math.max(site.position.x, anchor.x) + 7;
  const minZ = Math.min(site.position.z, anchor.z) - 7, maxZ = Math.max(site.position.z, anchor.z) + 7;
  for (let i = 0; i + 2 < count; i += 3) {
    for (let j = 0; j < 3; j++) points[j].fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(source.matrixWorld);
    if (Math.max(...points.map(p => p.x)) < minX || Math.min(...points.map(p => p.x)) > maxX
      || Math.max(...points.map(p => p.z)) < minZ || Math.min(...points.map(p => p.z)) > maxZ) continue;
    for (const point of points) copied.push(point.x, point.y, point.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(copied, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, source.material); mesh.updateMatrixWorld(true); return mesh;
}

function independentSurface(patches) {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 200);
  return (x, z) => {
    ray.ray.origin.set(x, 120, z);
    const hits = ray.intersectObjects(patches, false);
    assert.ok(hits.length, '真实山顶地形射线应有落脚地面');
    return hits[0].point.y;
  };
}

function disposeIsland(island) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  island.group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material, object.customDepthMaterial].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

test('南峰和东峰两座确认样式的木亭真实接到既有石阶并保持原路通行', async t => {
  const sites = layoutModule.REST_PAVILION_SITES;
  assert.ok(Array.isArray(sites), '应提供已选定的南峰与东峰两处实际场地');
  assert.deepEqual(sites.map(site => site.id).sort(), ['east', 'south'], '西峰只保留灯塔，其余两峰各一亭');
  const scene = new THREE.Scene(), island = createIsland(scene), pavilions = [], ownedPatches = [];
  try {
    scene.updateMatrixWorld(true);
    const heightAt = createPavilionSurfaceSampler(island, sites);
    const pathLayout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
    for (const site of sites) {
      const patches = ['连续海床与火山岛', '山径天然石阶'].map(name => actualPatch(island.group.getObjectByName(name), site));
      ownedPatches.push(...patches);
      const realHeight = independentSurface(patches);
      const actualApproach = { ...site.approach, y: heightAt(site.approach.x, site.approach.z) };
      const pavilion = createRestPavilion(scene, { ...site, approach: actualApproach, heightAt }); pavilions.push(pavilion);
      scene.updateMatrixWorld(true);
      const half = pavilion.group.userData.floorSize / 2;
      const angle = pavilion.group.rotation.y, sin = Math.sin(angle), cos = Math.cos(angle);
      const world = (x, z) => ({ x: site.position.x + x * cos + z * sin, z: site.position.z - x * sin + z * cos });
      await t.test(`${site.id}：薄木地板在真实坡面之上，四支木柱完整落地且邻近该峰`, () => {
        const summit = pathLayout.summits.find(point => point.id === site.id);
        assert.ok(summit && Math.hypot(site.position.x - summit.x, site.position.z - summit.z) < 8,
          '木亭应留在指定山顶附近');
        assert.ok(pavilion.group.position.y > summit.y - 6, '不能退到低处山腰替代山顶观景台');
        assert.ok(pavilion.group.userData.floorSize >= 2 && pavilion.group.userData.floorSize <= 2.3);
        for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
          const point = world(-half + i / 12 * half * 2, -half + j / 12 * half * 2);
          const actual = realHeight(point.x, point.z);
          assert.ok(Math.abs(heightAt(point.x, point.z) - actual) < .00003, '地面采样必须与独立实际几何射线一致');
          assert.ok(pavilion.group.position.y - actual > .03, '亭内地板不能被原石阶或山体穿过');
        }
        assert.ok(!pavilion.group.getObjectByName('山亭贴坡石基'), '新亭不能保留满墙石基');
        const deck = pavilion.group.getObjectByName('山亭架空木台地板'); assert.ok(deck?.isMesh);
        const bounds = new THREE.Box3().setFromObject(deck);
        assert.ok(bounds.max.y - bounds.min.y <= .2, '地板需是薄木板台而非实体高墩');
        const support = pavilion.group.getObjectByName('山亭贴坡支承木柱'); assert.ok(support?.isMesh);
        const p = support.geometry.attributes.position, normal = support.geometry.attributes.normal, caps = [];
        for (let i = 0; i < p.count; i++) if (normal.getY(i) < -.9) {
          const foot = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(support.matrixWorld);
          assert.ok(foot.y <= realHeight(foot.x, foot.z) + .002, `木柱完整底面不得悬空 ${foot.x},${foot.z}`);
          let cap = caps.find(points => Math.hypot(points[0].x - foot.x, points[0].z - foot.z) < .29);
          if (!cap) { cap = []; caps.push(cap); } cap.push(foot);
        }
        assert.equal(caps.length, 4, '应有四个独立、贴真实坡面落脚的支承柱脚');
        const roofPosts = pavilion.group.getObjectByName('山亭旧木柱');
        const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 20);
        for (const cap of caps) {
          const center = cap.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(cap.length);
          down.ray.origin.set(center.x, pavilion.group.position.y + 3, center.z);
          assert.ok(down.intersectObject(roofPosts, false).length, '承柱必须在屋柱下方形成贯通的支撑轴线');
        }
      });
      await t.test(`${site.id}：新入口三条脚位连续接到实际石阶，相邻步高可正常迈步`, () => {
        assert.equal(pavilion.group.userData.approachConnected, true);
        const entry = pavilion.group.userData.entranceWorld, end = actualApproach;
        assert.ok(end, '每座木亭都需要实际进路接头');
        assert.ok(Math.abs(end.y - realHeight(end.x, end.z)) < .08, '接头必须取实际石阶顶面而非只取soil');
        const dx = end.x - entry.x, dz = end.z - entry.z, run = Math.hypot(dx, dz);
        const sideX = -dz / run, sideZ = dx / run;
        const walkMeshes = [pavilion.group.getObjectByName('山亭架空木台地板'), patches[1]];
        pavilion.group.traverse(object => { if (object.name.startsWith('山亭入口石阶')) walkMeshes.push(object); });
        const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 200);
        for (const offset of [-.45, 0, .45]) {
          let previous;
          for (let i = 0; i <= 80; i++) {
            const fraction = i / 80;
            const x = entry.x + dx * fraction + sideX * offset, z = entry.z + dz * fraction + sideZ * offset;
            ray.ray.origin.set(x, 120, z);
            const hits = ray.intersectObjects(walkMeshes, false);
            assert.ok(hits.length, `入口每条真实脚位都需要连续石踏面 offset=${offset},fraction=${fraction},point=${x},${z}`);
            const top = Math.max(realHeight(x, z), hits[0].point.y);
            if (previous !== undefined) assert.ok(Math.abs(top - previous) <= .2001, `真实接路处不能产生过高台阶：${top - previous}`);
            previous = top;
          }
        }
      });
      await t.test(`${site.id}：四角小风铃贴真实瓦檐并在完整风摆下避开坡面与入口人身`, () => {
        const swings = [], hooks = [];
        pavilion.group.traverse(object => {
          if (object.name === '山亭风铃摆轴') swings.push(object);
          if (object.name === '山亭风铃檐下铜扣') hooks.push(object);
        });
        assert.equal(swings.length, 4); assert.equal(hooks.length, 4);
        const roof = pavilion.group.getObjectByName('山亭弧瓦屋顶');
        const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 200);
        for (const hook of hooks) {
          const point = hook.getWorldPosition(new THREE.Vector3()), bounds = new THREE.Box3().setFromObject(hook);
          down.ray.origin.set(point.x, 120, point.z);
          const tile = down.intersectObject(roof, false)[0];
          assert.ok(tile && Math.abs(tile.point.y - bounds.max.y) < .015, '旋转后的实际吊扣需贴住对应檐角瓦面');
        }
        const body = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 1.75);
        for (let i = 0; i <= 64; i++) {
          pavilion.update(i / 12, { windSpeed: 22, windDirection: [Math.cos(i / 17), Math.sin(i / 17)], gust: 1 });
          pavilion.group.updateWorldMatrix(true, true);
          for (const swing of swings) {
            const bounds = new THREE.Box3().setFromObject(swing);
            for (const x of [bounds.min.x, (bounds.min.x + bounds.max.x) / 2, bounds.max.x]) {
              for (const z of [bounds.min.z, (bounds.min.z + bounds.max.z) / 2, bounds.max.z]) {
                assert.ok(bounds.min.y - realHeight(x, z) > 2, '四角风铃的整个摆动包络不能侵入实际坡地人身净空');
              }
            }
          }
          for (const x of [-.55, 0, .55]) for (const z of [-.35, 0, .8]) {
            const point = world(x, z); body.ray.origin.set(point.x, pavilion.group.position.y + .25, point.z);
            assert.equal(body.intersectObjects(swings, true).length, 0, '四角风铃不能摆进中央和1.13m入口通道');
          }
        }
      });
      await t.test(`${site.id}：原山路全宽密集走线保留站立空间和正常步差`, () => {
        const walk = [pavilion.group.getObjectByName('山亭架空木台地板')], obstacles = [];
        pavilion.group.traverse(object => {
          if (!object.isMesh) return;
          if (object.name.startsWith('山亭入口石阶')) walk.push(object);
          else if (object.name !== '山亭架空木台地板') obstacles.push(object);
        });
        const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 200);
        const up = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0, 1.75);
        // Cover the complete 1.1 m walking strip, keeping the previous +/- .45 checks too.
        const offsets = [-.55, -.45, -.44, -.33, -.22, -.11, 0, .11, .22, .33, .44, .45, .55];
        let checked = 0;
        for (const route of pathLayout.routes.filter(route => route.kind !== 'coastal')) {
          const previous = offsets.map(() => undefined), previousOriginal = offsets.map(() => undefined);
          for (let segment = 1; segment < route.points.length; segment++) {
            const a = route.points[segment - 1], b = route.points[segment];
            if (Math.min(Math.hypot(a.x - site.position.x, a.z - site.position.z), Math.hypot(b.x - site.position.x, b.z - site.position.z)) > 4) {
              previous.fill(undefined); previousOriginal.fill(undefined); continue;
            }
            const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), count = Math.max(1, Math.ceil(length / .02));
            for (let i = 0; i <= count; i++) for (let line = 0; line < offsets.length; line++) {
              const offset = offsets[line], x = a.x + dx * i / count - dz / length * offset;
              const z = a.z + dz * i / count + dx / length * offset;
              down.ray.origin.set(x, 120, z); const hits = down.intersectObjects(walk, false);
              const original = realHeight(x, z), top = Math.max(original, hits[0]?.point.y ?? -Infinity);
              if (previous[line] !== undefined) {
                const oldRise = Math.abs(original - previousOriginal[line]);
                assert.ok(Math.abs(top - previous[line]) <= Math.max(.2001, oldRise + .00003),
                  `木亭不得新增或放大原路高台阶 route=${route.id},line=${line},point=${x},${z},from=${previous[line]},to=${top},oldRise=${oldRise},new=${hits[0]?.point.y}`);
              }
              previous[line] = top; previousOriginal[line] = original;
              up.ray.origin.set(x, top + .25, z);
              const blocked = up.intersectObjects(obstacles, false);
              assert.equal(blocked.length, 0,
                `完整原路宽度不能被亭柱凳栏堵住 route=${route.id},offset=${offset},point=${x},${z},floor=${top},obstacle=${blocked[0]?.object.name}`);
              checked++;
            }
          }
        }
        assert.ok(checked > 250, '需密查木亭附近完整真实路宽，不可只看模型中心');
      });
    }
  } finally {
    for (const pavilion of pavilions) pavilion.dispose();
    for (const patch of ownedPatches) patch.geometry.dispose();
    disposeIsland(island);
  }
});
