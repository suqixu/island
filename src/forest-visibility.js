import * as THREE from 'three';

const TILE_SIZE = 40;
const WIND_MARGIN = 3;
// Chrome/Metal 实测保留约63%时不能抵消阴影绘制开销；仅剩较少实例时才分块。
const CHUNK_ENTER_RATIO = .5;
const CHUNK_EXIT_RATIO = .6;
const FOREST_NAME = /^(阔叶冠层-\d+|森林细枝-\d+|森林树干与分叉)$/;
const MATERIAL_LOCAL = new Set(['id', 'uuid', 'version', 'visible', 'userData', '_listeners']);

function visiblePrefix(indices, count) {
  let low = 0, high = indices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indices[middle] < count) low = middle + 1; else high = middle;
  }
  return low;
}

function instanceAttribute(source, indices, existing) {
  const values = existing?.array ?? new source.array.constructor(indices.length * source.itemSize);
  const attribute = existing ?? new THREE.InstancedBufferAttribute(values, source.itemSize, source.normalized);
  attribute.gpuType = source.gpuType;
  for (let at = 0; at < indices.length; at++) {
    const original = Math.floor(indices[at] / source.meshPerAttribute) * source.itemSize;
    for (let component = 0; component < source.itemSize; component++) {
      values[at * source.itemSize + component] = source.array[original + component];
    }
  }
  attribute.needsUpdate = true;
  return attribute;
}

// Three.js 在几何释放时删除所有引用的GPU属性，先解除共享顶点和索引缓冲。
function releaseGeometry(record) {
  const geometry = record.geometry;
  geometry.setIndex(null);
  for (const name of Object.keys(geometry.attributes)) {
    if (!record.owned.has(name)) geometry.deleteAttribute(name);
  }
  geometry.dispose();
}

/**
 * 为生成完成的森林建立空间绘制批次；源实例和原始索引继续供栖息地查询使用。
 * 每帧在海岛更新后调用 update；必须在 island.dispose 之前 dispose。
 */
export function createForestVisibility(island) {
  const sources = [], materialRecords = new Map();
  const stats = { sources: 0, chunks: 0, instances: 0, chunked: true, visibleTriangleRatio: 1 };
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4(), worldBounds = new THREE.Sphere();
  let disposed = false;
  let adaptiveChunked = false;
  island.traverse(object => {
    if (object.isInstancedMesh && FOREST_NAME.test(object.name) && !Array.isArray(object.material)) sources.push(object);
  });

  function materialFor(source) {
    let record = materialRecords.get(source);
    if (!record) {
      const material = source.clone();
      record = { source, material, visible: source.visible, version: -1 };
      materialRecords.set(source, record);
    }
    return record;
  }

  function syncMaterial(record) {
    const { source, material } = record;
    for (const name of Object.keys(source)) {
      if (MATERIAL_LOCAL.has(name)) continue;
      const value = source[name], current = material[name];
      if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isEuler) current.copy(value);
      else material[name] = value;
    }
    // clone/copy不复制编译回调；共享原闭包才能保持后加载纹理和风雪uniform一致。
    material.onBeforeCompile = source.onBeforeCompile;
    material.customProgramCacheKey = source.customProgramCacheKey;
    if (record.version !== source.version) {
      material.needsUpdate = true; record.version = source.version;
    }
    material.visible = record.visible;
    source.visible = false;
  }

  const records = sources.map(source => {
    const tiles = new Map(), roots = source.geometry.attributes.aPlantRoot;
    const values = source.instanceMatrix.array;
    for (let index = 0; index < source.instanceMatrix.count; index++) {
      const x = roots ? roots.getX(index) : values[index * 16 + 12];
      const z = roots ? roots.getZ(index) : values[index * 16 + 14];
      const key = `${Math.floor(x / TILE_SIZE)},${Math.floor(z / TILE_SIZE)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(index);
    }
    const material = materialFor(source.material);
    const chunks = [...tiles.values()].map(indices => {
      const mesh = new THREE.InstancedMesh(source.geometry, material.material, indices.length);
      mesh.matrixAutoUpdate = false;
      // 初始化期间立即用块专属包装几何替换借用引用，之后才交给渲染器。
      mesh.name = `森林空间块:${source.name}`;
      mesh.userData.forestVisibility = true;
      mesh.userData.originalIndices = Uint32Array.from(indices);
      source.add(mesh);
      return { mesh, indices: mesh.userData.originalIndices, geometries: new Map(), geometry: null, baseRadius: 0 };
    });
    return { source, chunks, matrixVersion: -1, colorVersion: -1, color: null, geometry: null, instanceVersions: new Map(), material };
  });
  stats.sources = records.length;
  stats.chunks = records.reduce((sum, record) => sum + record.chunks.length, 0);

  function geometryFor(chunk, source) {
    let record = chunk.geometries.get(source);
    if (!record) {
      const geometry = new THREE.BufferGeometry(), owned = new Set();
      for (const [name, attribute] of Object.entries(source.attributes)) {
        if (attribute.isInstancedBufferAttribute) {
          geometry.setAttribute(name, instanceAttribute(attribute, chunk.indices)); owned.add(name);
        } else geometry.setAttribute(name, attribute);
      }
      geometry.setIndex(source.index);
      geometry.groups = source.groups.map(group => ({ ...group }));
      if (!source.boundingSphere) source.computeBoundingSphere();
      geometry.boundingSphere = source.boundingSphere.clone();
      record = { geometry, owned, versions: new Map() };
      chunk.geometries.set(source, record);
    }
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (!attribute.isInstancedBufferAttribute) continue;
      if (record.versions.get(attribute) !== attribute.version) {
        instanceAttribute(attribute, chunk.indices, record.geometry.attributes[name]);
        record.versions.set(attribute, attribute.version);
      }
    }
    return record.geometry;
  }

  function windMargin(source) {
    // 风偏移以世界米计，包围球以局部坐标计；各祖先最小轴缩放乘积给出保守余量。
    let minimumScale = 1;
    for (let object = source; object; object = object.parent) {
      minimumScale *= Math.min(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z));
    }
    return minimumScale > 0 ? WIND_MARGIN / minimumScale : WIND_MARGIN;
  }

  function update(camera) {
    if (disposed) return;
    for (const record of materialRecords.values()) syncMaterial(record);
    stats.instances = 0;
    for (const record of records) {
      const { source, chunks } = record, geometryChanged = source.geometry !== record.geometry;
      const matrixChanged = source.instanceMatrix.version !== record.matrixVersion;
      const colorChanged = source.instanceColor !== record.color || (source.instanceColor?.version ?? -1) !== record.colorVersion;
      const instanceAttributes = Object.values(source.geometry.attributes).filter(attribute => attribute.isInstancedBufferAttribute);
      const attributesChanged = instanceAttributes.some(attribute => record.instanceVersions.get(attribute) !== attribute.version);
      const margin = windMargin(source);
      if (source.material !== record.material.source) {
        record.material = materialFor(source.material); syncMaterial(record.material);
      }
      for (const chunk of chunks) {
        const { mesh, indices } = chunk;
        if (geometryChanged || attributesChanged) mesh.geometry = geometryFor(chunk, source.geometry);
        if (matrixChanged) {
          for (let at = 0; at < indices.length; at++) {
            const offset = indices[at] * 16;
            mesh.instanceMatrix.array.set(source.instanceMatrix.array.subarray(offset, offset + 16), at * 16);
          }
          mesh.instanceMatrix.needsUpdate = true;
        }
        if (colorChanged) {
          if (!source.instanceColor && mesh.instanceColor) mesh.dispose();
          mesh.instanceColor = source.instanceColor ? instanceAttribute(source.instanceColor, indices, mesh.instanceColor) : null;
        }
        if (geometryChanged || matrixChanged) {
          mesh.count = indices.length;
          mesh.computeBoundingSphere(); chunk.baseRadius = mesh.boundingSphere.radius;
        }
        mesh.boundingSphere.radius = chunk.baseRadius + margin;
        mesh.count = visiblePrefix(indices, source.count);
        mesh.visible = mesh.count > 0;
        mesh.geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
        mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
        mesh.customDepthMaterial = source.customDepthMaterial;
        mesh.customDistanceMaterial = source.customDistanceMaterial;
        mesh.material = record.material.material;
        mesh.layers.mask = source.layers.mask; mesh.renderOrder = source.renderOrder;
        stats.instances += mesh.count;
      }
      record.geometry = source.geometry; record.matrixVersion = source.instanceMatrix.version;
      record.color = source.instanceColor; record.colorVersion = source.instanceColor?.version ?? -1;
      for (const attribute of instanceAttributes) record.instanceVersions.set(attribute, attribute.version);
    }
    if (camera?.isCamera) {
      camera.updateWorldMatrix(true, false);
      projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projectionView, camera.coordinateSystem, camera.reversedDepth);
      let totalTriangles = 0, visibleTriangles = 0;
      for (const { source, chunks } of records) {
        source.updateWorldMatrix(true, false);
        const triangles = Math.min(source.geometry.index?.count ?? source.geometry.attributes.position.count,
          source.geometry.drawRange.count) / 3;
        totalTriangles += triangles * source.count;
        for (const { mesh } of chunks) {
          if (!mesh.count) continue;
          worldBounds.copy(mesh.boundingSphere).applyMatrix4(source.matrixWorld);
          if (frustum.intersectsSphere(worldBounds)) visibleTriangles += triangles * mesh.count;
        }
      }
      stats.visibleTriangleRatio = totalTriangles > 0 ? visibleTriangles / totalTriangles : 1;
      const threshold = adaptiveChunked ? CHUNK_EXIT_RATIO : CHUNK_ENTER_RATIO;
      stats.chunked = stats.visibleTriangleRatio <= threshold;
      adaptiveChunked = stats.chunked;
    } else stats.chunked = true;
    // 全森林在视野内时维持原九批绘制。三角形显著减少才分块，滞回防止临界角抖动。
    for (const record of materialRecords.values()) {
      record.source.visible = stats.chunked ? false : record.visible;
      record.material.visible = stats.chunked ? record.visible : false;
    }
    // 回退后由原批次完整绘制及投影，块可直接跳过主/阴影通道的几何更新。
    for (const { chunks } of records) for (const { mesh } of chunks) mesh.visible = stats.chunked && mesh.count > 0;
  }

  update();
  return {
    stats,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { chunks } of records) for (const chunk of chunks) {
        chunk.mesh.removeFromParent(); chunk.mesh.dispose();
        for (const geometry of chunk.geometries.values()) releaseGeometry(geometry);
      }
      for (const record of materialRecords.values()) {
        record.source.visible = record.visible;
        record.material.dispose();
      }
      stats.sources = 0; stats.chunks = 0; stats.instances = 0;
    },
  };
}
