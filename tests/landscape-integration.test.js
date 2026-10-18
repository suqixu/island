import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';

test('岛内道路和洞口为森林留出连续通道，洞口地形真实切开', async () => {
  const [{ getIslandPathLayout }, { CAVE_LAYOUT, isCaveReserved, caveToWorld }] = await Promise.all([
    import('../src/path-layout.js'), import('../src/cave-layout.js'),
  ]);
  const scene = new THREE.Scene();
  const island = createIsland(scene);
  const layout = getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach });
  try {
    const surface = island.group.children.find(item => item.name === '连续海床与火山岛');
    // Boundary cells are now split to retain the mountain skin; their triangle
    // count can grow even though the opening is correctly cut out.
    surface.updateWorldMatrix(true, false);
    const openingOrigin = new THREE.Vector3(...Object.values(caveToWorld(0, 2, 10)));
    const openingTarget = new THREE.Vector3(...Object.values(caveToWorld(0, 2, -2)));
    const openingHits = new THREE.Raycaster(openingOrigin, openingTarget.sub(openingOrigin).normalize(), 0, 12)
      .intersectObject(surface, false);
    assert.equal(openingHits.length, 0, '洞口中央应实际挖空，不能被地形封住');
    let checked = 0, rootMostAboveGround = null, rootGap = -Infinity;
    island.group.traverse(object => {
      for (const tree of object.userData.trees ?? []) {
        assert.ok(layout.distanceAt(tree.x, tree.z) >= 2, '路上不能长树或被树冠堵住');
        assert.equal(isCaveReserved(tree.x, tree.z, 2), false, '树不能堵洞口');
        const gap = Math.abs(tree.y - layout.heightAtRendered(tree.x, tree.z));
        assert.ok(gap < .025, '所有树根需贴住可见地形面');
        if (gap > rootGap) { rootGap = gap; rootMostAboveGround = tree; }
        checked++;
      }
    });
    assert.ok(checked > 500, '保留岛上主体森林');
    surface.updateWorldMatrix(true, false);
    const root = rootMostAboveGround;
    const hit = new THREE.Raycaster(new THREE.Vector3(root.x, 80, root.z), new THREE.Vector3(0, -1, 0))
      .intersectObject(surface, false)[0];
    assert.ok(hit && Math.abs(root.y - hit.point.y) < .025, '清出的山路附近树根必须贴住实际山坡，不能悬空');
    assert.ok(island.group.userData.stats.pathLength > 350, '实际场景已加入环岛和上山网络');
    const count = island.group.children.length;
    island.update(30, { season: 'summer', daylight: 1, windSpeed: 9 });
    assert.equal(island.group.children.length, count, '运动更新不重建地景');
    const caveLights = [];
    island.group.traverse(object => {
      if (object.isPointLight && /洞/.test(object.name)) caveLights.push(object);
    });
    assert.equal(caveLights.length, 1, '仅洞内转角保留局部微光');
    island.update(31, { season: 'summer', daylight: 0, windSpeed: 9 });
    assert.equal(island.group.getObjectByName('山洞暖光-1'), undefined, '夜间不会重新创建洞灯');
    island.update(32, { season: 'summer', daylight: 1, windSpeed: 9 });
    assert.equal(island.group.getObjectByName('山洞暖光-1'), undefined);
  } finally {
    const geometry = new Set(), materials = new Set(), textures = new Set();
    island.group.traverse(object => {
      if (object.geometry) geometry.add(object.geometry);
      for (const material of [object.material, object.customDepthMaterial].flat()) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    geometry.forEach(value => value.dispose());
    scene.remove(island.group);
  }
});
