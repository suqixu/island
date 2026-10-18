import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneVisibility } from '../src/scene-visibility.js';

function batch(...positions) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), positions.length);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  positions.forEach((position, index) => mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(...position)));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// Exercise the exact public culling boundary used by both renderer passes.
function drawnBy(mesh, camera) {
  camera.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return mesh.visible && (!mesh.frustumCulled || frustum.intersectsObject(mesh));
}

function cameraAt(x = 0) {
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.x = x;
  return camera;
}

test('动态实例仅省略镜头外绘制，可见实例和屏幕边缘仍保留', () => {
  const scene = new THREE.Scene(), inside = batch([0, 0, -10]), outside = batch([100, 0, -10]);
  const edge = batch([5.9, 0, -10]);
  scene.add(inside, outside, edge);
  const visibility = createSceneVisibility(scene);
  visibility.update(cameraAt());
  assert.equal(drawnBy(inside, cameraAt()), true);
  assert.equal(drawnBy(edge, cameraAt()), true, '几何触及边缘时不能按实例中心剔除');
  assert.equal(drawnBy(outside, cameraAt()), false);
  assert.equal(outside.visible, true, '不能用 visible 阻止阴影通道');
  visibility.dispose();
});

test('屏幕外投影物在独立阴影相机中仍绘制，并支持父组相机', () => {
  const scene = new THREE.Scene(), caster = batch([30, 0, -10]);
  caster.castShadow = true; scene.add(caster);
  const rig = new THREE.Group(), camera = cameraAt(); rig.position.x = 30; rig.add(camera);
  const visibility = createSceneVisibility(scene);
  visibility.update(camera);
  assert.equal(drawnBy(caster, cameraAt()), false);
  assert.equal(drawnBy(caster, camera), true);
  assert.equal(caster.castShadow, true);
  visibility.dispose();
});

test('移动实例和数量变化刷新边界，静止帧复用边界', () => {
  const scene = new THREE.Scene(), mesh = batch([100, 0, -10], [150, 0, -10]); scene.add(mesh);
  const visibility = createSceneVisibility(scene);
  visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), false);
  assert.equal(visibility.stats.boundsUpdated, 1);
  visibility.update();
  assert.equal(visibility.stats.boundsUpdated, 0, '未修改矩阵时不重复遍历实例');
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -10));
  mesh.instanceMatrix.needsUpdate = true;
  visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), true);
  mesh.count = 0; visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), false);
  mesh.count = 1; visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), true);
  visibility.dispose();
});

test('自定义顶点位移、粒子和已经启用原生剔除的物体保持原样', () => {
  const scene = new THREE.Scene(), shader = batch([100, 0, -10]), custom = batch([100, 0, -10]);
  shader.material = new THREE.ShaderMaterial();
  custom.material.onBeforeCompile = () => {};
  const original = batch([0, 0, -10]); original.frustumCulled = true;
  const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()); points.frustumCulled = false;
  scene.add(shader, custom, original, points);
  const visibility = createSceneVisibility(scene); visibility.update();
  assert.equal(shader.frustumCulled, false); assert.equal(custom.frustumCulled, false);
  assert.equal(points.frustumCulled, false); assert.equal(original.boundingSphere, null);
  assert.equal(visibility.stats.managed, 0);
  visibility.dispose();
});

test('新增和移除子树增量注册，释放恢复原来的剔除标记和包围球', () => {
  const scene = new THREE.Scene(), group = new THREE.Group(), mesh = batch([100, 0, -10]);
  const originalBounds = new THREE.Sphere(new THREE.Vector3(3, 4, 5), 6);
  mesh.boundingSphere = originalBounds; group.add(mesh);
  const visibility = createSceneVisibility(scene);
  scene.add(group); visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), false);
  assert.notEqual(mesh.boundingSphere, originalBounds);
  scene.remove(group);
  assert.equal(mesh.frustumCulled, false); assert.equal(mesh.boundingSphere, originalBounds);
  scene.add(group); visibility.update(); visibility.dispose(); visibility.dispose();
  assert.equal(mesh.frustumCulled, false); assert.equal(mesh.boundingSphere, originalBounds);
  const added = batch([100, 0, -10]); scene.add(added); visibility.update();
  assert.equal(added.frustumCulled, false, '释放后移除场景监听并停止修改');
});

test('材质变为未知位移时退回原有绘制，几何更换时采用新边界', () => {
  const scene = new THREE.Scene(), mesh = batch([100, 0, -10]); scene.add(mesh);
  const visibility = createSceneVisibility(scene); visibility.update();
  mesh.material.onBeforeCompile = () => {}; visibility.update();
  assert.equal(mesh.frustumCulled, false);
  mesh.material = new THREE.MeshStandardMaterial();
  mesh.geometry = new THREE.BoxGeometry(220, 1, 1); visibility.update();
  assert.equal(drawnBy(mesh, cameraAt()), true);
  visibility.dispose();
});
