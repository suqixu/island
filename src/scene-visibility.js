import * as THREE from 'three';

function ordinaryMaterial(material) {
  return Boolean(material && !material.isShaderMaterial && !material.displacementMap &&
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile);
}

function safeGeometry(mesh) {
  const geometry = mesh.geometry;
  if (!geometry?.attributes.position || mesh.isSkinnedMesh || mesh.morphTexture ||
      geometry.morphAttributes.position?.length ||
      geometry.attributes.position.usage !== THREE.StaticDrawUsage ||
      mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      mesh.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow) return false;
  if (Array.isArray(mesh.material)) {
    if (!mesh.material.every(ordinaryMaterial)) return false;
  } else if (!ordinaryMaterial(mesh.material)) return false;
  return (!mesh.customDepthMaterial || ordinaryMaterial(mesh.customDepthMaterial)) &&
    (!mesh.customDistanceMaterial || ordinaryMaterial(mesh.customDistanceMaterial));
}

/**
 * 补齐普通网格关闭的原生视锥剔除。必须在实例动画更新后、render 前调用 update。
 * 原生渲染器分别使用主相机和阴影相机，镜头外的物体仍可投下屏幕内阴影。
 * 天空、粒子和未知顶点位移保留原逻辑；已经启用剔除的网格不重复处理。
 */
export function createSceneVisibility(scene) {
  const observed = new Set(), records = new Map();
  const stats = { managed: 0, boundsUpdated: 0, totalBoundsUpdated: 0 };
  let disposed = false;

  function restore(mesh, record) {
    mesh.frustumCulled = record.frustumCulled;
    if (record.hadBoundingSphere) mesh.boundingSphere = record.boundingSphere;
    else delete mesh.boundingSphere;
    record.active = false;
  }

  function observe(object) {
    if (disposed || observed.has(object)) return;
    observed.add(object);
    object.addEventListener('childadded', added);
    object.addEventListener('childremoved', removed);
    if (object.isMesh && !object.frustumCulled && safeGeometry(object)) {
      records.set(object, {
        frustumCulled: object.frustumCulled,
        hadBoundingSphere: Object.hasOwn(object, 'boundingSphere'),
        boundingSphere: object.boundingSphere,
        sphere: new THREE.Sphere(), active: false,
        geometry: null, positionVersion: -1, matrixVersion: -1, count: -1,
      });
    }
    for (const child of object.children) observe(child);
  }

  function unobserve(object) {
    if (!observed.delete(object)) return;
    object.removeEventListener('childadded', added);
    object.removeEventListener('childremoved', removed);
    const record = records.get(object);
    if (record) { restore(object, record); records.delete(object); }
    for (const child of object.children) unobserve(child);
  }

  function added(event) { observe(event.child); }
  function removed(event) { unobserve(event.child); }

  function update() {
    if (disposed) return;
    stats.boundsUpdated = 0; stats.managed = 0;
    for (const [mesh, record] of records) {
      // A runtime material change may introduce displacement; fail open until
      // ordinary geometry is restored instead of risking a stale small bound.
      if (!safeGeometry(mesh)) {
        if (record.active) restore(mesh, record);
        continue;
      }
      const geometry = mesh.geometry, position = geometry.attributes.position;
      const matrixVersion = mesh.instanceMatrix?.version ?? 0;
      const count = mesh.isInstancedMesh ? mesh.count : 1;
      const geometryChanged = geometry !== record.geometry;
      if (!record.active || geometryChanged || position.version !== record.positionVersion ||
          matrixVersion !== record.matrixVersion || count !== record.count) {
        if (!geometry.boundingSphere || (geometryChanged ? position.version > 0 : position.version !== record.positionVersion)) {
          geometry.computeBoundingSphere();
        }
        mesh.boundingSphere = record.sphere;
        if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
        else record.sphere.copy(geometry.boundingSphere);
        record.geometry = geometry; record.positionVersion = position.version;
        record.matrixVersion = matrixVersion; record.count = count;
        record.active = true; stats.boundsUpdated++; stats.totalBoundsUpdated++;
      }
      mesh.frustumCulled = true; stats.managed++;
    }
  }

  observe(scene);
  return {
    update,
    stats,
    dispose() {
      if (disposed) return;
      unobserve(scene); disposed = true;
      stats.managed = 0; stats.boundsUpdated = 0;
    },
  };
}
