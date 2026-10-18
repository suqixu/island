import * as THREE from 'three';

// 每个场景复用视锥、矩阵和包围球，检测过程中不创建逐帧临时对象。
export function createWildlifeView() {
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4(), sphere = new THREE.Sphere();
  let enabled = false;
  function intersects(position, radius = 1) {
    if (!enabled) return true;
    sphere.center.copy(position); sphere.radius = Math.max(0, radius);
    return frustum.intersectsSphere(sphere);
  }
  return {
    update(camera) {
      enabled = Boolean(camera);
      if (!camera) return;
      camera.updateWorldMatrix(true, false);
      projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projectionView, camera.coordinateSystem, camera.reversedDepth);
    },
    intersects,
    any(positions, radius = 1) {
      if (!enabled) return true;
      for (const position of positions) if (intersects(position, radius)) return true;
      return false;
    },
  };
}
