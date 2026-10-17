import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/island.js';
import { LIGHTHOUSE_SITE } from '../src/lighthouse-layout.js';

const module = await import('../src/lighthouse.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

// Catches an incorrect height sampler or a tower hidden behind the other summits.
test('实际海岛的灯室露出西峰，从全岛和赏月镜头能看见且原山路没有被塔身堵住', () => {
  assert.equal(typeof module.createLighthouse, 'function', '场景应有可渲染的山顶灯塔');
  const scene = new THREE.Scene(), island = createIsland(scene);
  const tower = module.createLighthouse(scene, { ...LIGHTHOUSE_SITE, heightAt: island.heightAtRendered });
  try {
    scene.updateMatrixWorld(true);
    const lamp = tower.group.getObjectByName('灯塔暖金灯芯').getWorldPosition(new THREE.Vector3());
    for (const [position, target, fov] of [
      [[160, 68, 200], [0, 15, 0], 46],
      [[150, 24, 200], [0, 65, 0], 66],
    ]) {
      const camera = new THREE.PerspectiveCamera(fov, 1280 / 720, .5, 65000);
      camera.position.fromArray(position); camera.lookAt(new THREE.Vector3(...target)); camera.updateMatrixWorld();
      const projection = lamp.clone().project(camera);
      assert.ok(Math.abs(projection.x) < .85 && Math.abs(projection.y) < .85 && projection.z < 1,
        '灯室需留在实际预设画幅内');
      const direction = lamp.clone().sub(camera.position), distance = direction.length();
      const hits = new THREE.Raycaster(camera.position, direction.normalize(), 0, distance + 2)
        .intersectObjects(scene.children, true).filter(hit => !hit.object.material?.transparent);
      assert.ok(hits.length > 0, '视线应命中实体塔身');
      let object = hits[0].object;
      while (object && object !== tower.group) object = object.parent;
      assert.equal(object, tower.group, '山体或植被不能挡住灯室');
    }
    const approach = LIGHTHOUSE_SITE.approach;
    const start = new THREE.Vector3(approach.x, island.heightAtRendered(approach.x, approach.z) + .3, approach.z);
    const hits = new THREE.Raycaster(start, new THREE.Vector3(0, 1, 0), 0, 3)
      .intersectObject(tower.group.getObjectByName('灯塔建筑'), true);
    assert.equal(hits.length, 0, '原西峰山路终点需要保留站立空间');
  } finally {
    tower.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    island.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      [object.material, object.customDepthMaterial].flat().filter(Boolean).forEach(item => {
        materials.add(item);
        Object.values(item).filter(value => value?.isTexture).forEach(value => textures.add(value));
      });
    });
    geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
  }
});
