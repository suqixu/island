import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';

function windowDepth(point, camera) { return (point.clone().project(camera).z + 1) * .5; }
function depthSlope(mesh, faceIndex, camera, width, height) {
  const vertices = [0, 1, 2].map(offset => {
    const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, faceIndex * 3 + offset).project(camera);
    return new THREE.Vector3((point.x + 1) * width * .5, (point.y + 1) * height * .5, (point.z + 1) * .5);
  });
  const [a, b, c] = vertices, dx1 = b.x - a.x, dy1 = b.y - a.y, dz1 = b.z - a.z;
  const dx2 = c.x - a.x, dy2 = c.y - a.y, dz2 = c.z - a.z, determinant = dx1 * dy2 - dx2 * dy1;
  return Math.max(Math.abs((dz1 * dy2 - dz2 * dy1) / determinant), Math.abs((dx1 * dz2 - dx2 * dz1) / determinant));
}

test('码头台阶近景中底层土路的深度偏移不能把土色矩形拉到踏面前', () => {
  const island = createIsland(new THREE.Scene());
  const camera = new THREE.PerspectiveCamera(48, 1440 / 900, .15, 65000);
  camera.position.set(14, 9, 85); camera.lookAt(1, 5, 57); camera.updateMatrixWorld();
  island.group.updateMatrixWorld(true);
  const stone = island.group.getObjectByName('山径天然石阶'), road = island.group.getObjectByName('环岛沙土与登山小径');
  const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)), ray = new THREE.Raycaster();
  const depthUnit = 1 / (2 ** 24 - 1);
  try {
    for (const [x, z] of [[-2.04405, 58.07254], [-2.26479, 57.28121], [-1.23448, 59.30047]]) {
      down.ray.origin.set(x, 100, z);
      const surface = down.intersectObject(stone, false)[0];
      assert.ok(surface, '红框对应的走线必须有完整踏面');
      const clearance = surface.point.y - island.heightAtRendered(x, z);
      assert.ok(clearance > .035 && clearance < .05, '石阶保留原有局部净空，不能靠整体抬高来遮土色');
      ray.set(camera.position, surface.point.clone().sub(camera.position).normalize());
      const step = ray.intersectObject(stone, false)[0], trail = ray.intersectObject(road, false)[0];
      assert.ok(step && trail && trail.distance > step.distance, '真实土路几何应在石阶之后');
      const slope = depthSlope(road, trail.faceIndex, camera, 1440, 900);
      const material = road.material;
      const offset = material.polygonOffset ? material.polygonOffsetFactor * slope + material.polygonOffsetUnits * depthUnit : 0;
      const gap = windowDepth(trail.point, camera) + offset - windowDepth(step.point, camera);
      assert.ok(gap > depthUnit * 4, `土路的实际渲染深度应留在石阶之后，当前偏移后深度差${gap}`);
    }
  } finally { island.dispose(); }
});
