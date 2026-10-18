import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { createLagoonLife } from '../src/models/lagoon-life.js';

// Query the actual final terrain triangles, independently of either height API.
function terrainFloor(surface) {
  surface.updateWorldMatrix(true, false);
  const position = surface.geometry.attributes.position, indices = surface.geometry.index;
  const bins = new Map(), binSize = 2;
  const key = (x, z) => `${Math.floor(x / binSize)}:${Math.floor(z / binSize)}`;
  for (let i = 0; i < indices.count; i += 3) {
    const points = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i + offset)).applyMatrix4(surface.matrixWorld));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    if (maxX < 35 || minX > 80 || maxZ < 55 || minZ > 105) continue;
    for (let ix = Math.floor(minX / binSize); ix <= Math.floor(maxX / binSize); ix++) {
      for (let iz = Math.floor(minZ / binSize); iz <= Math.floor(maxZ / binSize); iz++) {
        const id = `${ix}:${iz}`; if (!bins.has(id)) bins.set(id, []); bins.get(id).push(points);
      }
    }
  }
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), hit = new THREE.Vector3();
  return (x, z) => {
    ray.origin.set(x, 80, z); let floor = -Infinity;
    for (const points of bins.get(key(x, z)) ?? []) {
      if (ray.intersectTriangle(...points, false, hit)) floor = Math.max(floor, hit.y);
    }
    assert.ok(Number.isFinite(floor), `应击中实际地形 ${x},${z}`); return floor;
  };
}
function releaseIsland(scene, island) {
  const resources = new Set();
  island.group.traverse(item => {
    if (item.geometry) resources.add(item.geometry);
    for (const material of [item.material, item.customDepthMaterial].flat()) {
      if (!material) continue; resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
    if (item.isInstancedMesh) resources.add(item);
  });
  for (const resource of resources) resource.dispose(); scene.remove(island.group);
}

test('真实岛屿API驱动泻湖居民，各画质脚尖贴实际最终三角面、完整身体不穿床', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: name => {
    assert.equal(name, 'canvas');
    return { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
  } };
  const scene = new THREE.Scene(); let island, life;
  try {
    island = createIsland(scene);
    assert.equal(typeof island.heightAtRendered, 'function', '生产岛屿必须暴露真实三角地形高度，原始heightAt不能替代');
    life = createLagoonLife(scene, { heightAt: island.heightAtRendered, seed: 7319 });
    const surface = island.group.children.find(mesh => mesh.name === '连续海床与火山岛');
    const floor = terrainFloor(surface), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (const [quality, expected] of [['high', [42, 3, 8, 5]], ['medium', [33, 3, 6, 4]], ['low', [24, 2, 4, 3]]]) {
      life.setQuality(quality);
      for (const time of [0, 58, 137]) {
        life.update(time, { daylight: 0, storm: 1, rain: 1 });
        const counts = ['fish', 'turtle', 'crab', 'lobster'].map(kind => life.group.children
          .filter(mesh => mesh.userData.kind === kind && mesh.userData.role === 'body').reduce((sum, mesh) => sum + mesh.count, 0));
        assert.deepEqual(counts, expected, `${quality}/${time}常驻物种必须保留`);
        for (const mesh of life.group.children) {
          const vertices = mesh.geometry.attributes.position;
          for (let member = 0; member < mesh.count; member++) {
            mesh.getMatrixAt(member, matrix);
            point.setFromMatrixPosition(matrix);
            if (mesh.userData.role === 'body') assert.ok(point.y >= floor(point.x, point.z) - .004, '根部不能穿床');
            if (mesh.userData.role === 'leg') {
              if (member % 2 === 1) {
                point.set(0, -.5, 0).applyMatrix4(matrix);
                const ground = floor(point.x, point.z), gap = point.y - ground;
                assert.ok(gap >= 0 && gap <= .03, `${quality}/${time}/${mesh.name}/${member}脚尖实际床面间距 ${gap}`);
                assert.ok(Math.abs(island.heightAtRendered(point.x, point.z) - ground) < .001, '公开高度API必须与最终地形三角面一致');
              }
              continue;
            }
            // Include the last vertex and appendages, rather than only checking body centres.
            for (let i = 0; i < vertices.count; i++) {
              point.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
              assert.ok(point.y > floor(point.x, point.z) + .004,
                `${quality}/${time}/${mesh.name}/${member}/${i}真实模型顶点不能穿床`);
              if (['fish', 'turtle'].includes(mesh.userData.kind)) assert.ok(point.y < -.05, '鱼背和龟壳保持水下');
            }
          }
        }
      }
    }
  } finally {
    life?.dispose(); if (island) releaseIsland(scene, island); globalThis.document = previousDocument;
  }
});
