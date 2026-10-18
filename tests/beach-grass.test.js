import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { shoreDistance } from '../src/terrain.js';

let island, patches, pathPatches, pathFlowers;
before(() => {
  island = createIsland(new THREE.Scene());
  const readPatches = name => {
    const grass = island.group.getObjectByName(name);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    const result = [];
    for (let i = 0; i < grass.count; i++) {
      grass.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      result.push({ x: position.x, y: position.y, z: position.z, distance: shoreDistance(position.x, position.z), scale: scale.clone() });
    }
    return result;
  };
  patches = readPatches('海岛草丛');
  pathPatches = readPatches('路旁低矮草簇');
  pathFlowers = readPatches('路旁细小野花');
});
after(() => island.dispose());

test('主沙滩和湿沙保留连续空地，草簇仅进入靠林一侧', () => {
  assert.equal(patches.filter(patch => patch.distance < 11.5).length, 0);
  const coastal = patches.filter(patch => patch.distance < 18);
  assert.ok(coastal.length > 30, '仍应保留可见的海岸草簇');
  assert.ok(coastal.length < 350, '靠林沙地应有大块留白');
});

test('海岸草簇低矮且各方向尺度变化，林内保留原有高草', () => {
  const coastal = patches.filter(patch => patch.distance < 18);
  assert.ok(coastal.length > 0);
  assert.ok(coastal.every(patch => patch.scale.y < .7));
  assert.ok(coastal.every(patch => patch.scale.y < Math.max(patch.scale.x, patch.scale.z)));
  assert.ok(coastal.some(patch => Math.abs(patch.scale.x - patch.scale.z) > .1));
  assert.ok(patches.filter(patch => patch.distance > 24 && patch.scale.y > 1.2).length > 200);
});

test('海岸草形成带有多个邻株的斑簇，而非等密度散布', () => {
  const coastal = patches.filter(patch => patch.distance < 18);
  const cellCounts = new Map();
  for (const patch of coastal) {
    const key = `${Math.floor(patch.x / 6)},${Math.floor(patch.z / 6)}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const clustered = [...cellCounts.values()].filter(count => count >= 3).reduce((sum, count) => sum + count, 0);
  assert.ok(clustered / coastal.length > .6, '多数草应处于包含多个邻株的小斑块中');
  assert.ok(cellCounts.size < 100, '应有完整空白地块打断沿海草带');
});

test('低位沙地路边打断等间距草花围边，仅保留少量低草簇', () => {
  assert.equal(pathPatches.filter(patch => patch.distance < 11.5).length, 0);
  const coastal = pathPatches.filter(patch => patch.distance < 18);
  assert.ok(coastal.length < 120);
  assert.ok(coastal.every(patch => patch.scale.y < .7));
  assert.ok(pathPatches.some(patch => patch.distance < 24 && Math.abs(patch.scale.x - patch.scale.z) > .01));
  assert.ok(pathPatches.filter(patch => patch.distance >= 24).length > 150, '林间路边草仍保留');
  assert.equal(pathFlowers.filter(patch => patch.distance < 18 && patch.y < 5.4).length, 0);
});
