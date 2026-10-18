import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const api = await import('../src/wildlife-visibility.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
function create() {
  assert.equal(typeof api.createWildlifeView, 'function', '需要可复用的真实相机视锥检查');
  return api.createWildlifeView();
}

test('没有相机时保持可见，真实相机按球体边界剔除，包含近远裁剪面', () => {
  const view = create(), point = new THREE.Vector3();
  view.update(); assert.ok(view.intersects(point)); assert.ok(view.any([]));
  const camera = new THREE.PerspectiveCamera(90, 1, .1, 100); view.update(camera);
  assert.ok(view.intersects(point.set(0, 0, -10), 0));
  assert.ok(!view.intersects(point.set(11, 0, -10), .5));
  assert.ok(view.intersects(point, 1), '球体部分进入屏幕应保留');
  assert.ok(view.intersects(point.set(0, 0, -.05), .1));
  assert.ok(view.intersects(point.set(0, 0, -100.5), 1));
  assert.ok(!view.intersects(point.set(0, 0, -102), 1));
  assert.ok(!view.intersects(point.set(0, 0, 10), 1));
  assert.ok(view.any([new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -10)]));
  assert.ok(!view.any([new THREE.Vector3(0, 0, 10)])); assert.ok(!view.any([]));
  view.update(); assert.ok(view.intersects(point)); assert.ok(view.any([]));
});

test('相机父组的平移旋转立即生效，各检查实例互不影响', () => {
  const view = create(), other = create(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  rig.position.set(50, 3, 20); rig.rotation.y = Math.PI / 2; camera.position.z = 2; rig.add(camera);
  view.update(camera);
  assert.ok(view.intersects(new THREE.Vector3(42, 3, 20)));
  assert.ok(!view.intersects(new THREE.Vector3(62, 3, 20)));
  assert.ok(other.intersects(new THREE.Vector3(62, 3, 20)), '另一个无相机视图不受影响');
  rig.rotation.y = -Math.PI / 2; view.update(camera);
  assert.ok(view.intersects(new THREE.Vector3(62, 3, 20))); assert.ok(!view.intersects(new THREE.Vector3(42, 3, 20)));
  camera.zoom = 4; camera.updateProjectionMatrix(); view.update(camera);
  assert.ok(!view.intersects(new THREE.Vector3(62, 8, 20), .1), '使用相机当前投影矩阵');
});
