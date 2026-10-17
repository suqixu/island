import * as THREE from 'three';

const REGION_RADIUS = 8;
const BUCKET_SIZE = 1.5;

/**
 * Capture the actual rendered stone tread tops near the supplied pavilion sites.
 * The returned world-space height callback combines those tops with rendered soil.
 * Construction copies only numbers; sampling creates no meshes or GPU resources.
 */
export function createPavilionSurfaceSampler(island, sites) {
  if (typeof island?.heightAtRendered !== 'function' || !island?.group) {
    throw new TypeError('木亭地面采样需要实际海岛与渲染地形高度');
  }
  const regions = [];
  for (const site of sites || []) for (const point of [site?.position, site?.approach]) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) continue;
    regions.push({ minX: point.x - REGION_RADIUS, maxX: point.x + REGION_RADIUS,
      minZ: point.z - REGION_RADIUS, maxZ: point.z + REGION_RADIUS });
  }
  const buckets = new Map(), triangles = [];
  const stone = island.group.getObjectByName('山径天然石阶');
  if (stone?.isMesh && regions.length) {
    stone.updateWorldMatrix(true, false);
    const geometry = stone.geometry, position = geometry.attributes.position, index = geometry.index;
    const count = index ? index.count : position.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(stone.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(stone.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(stone.matrixWorld);
      const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
      const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
      if (!regions.some(region => maxX >= region.minX && minX <= region.maxX && maxZ >= region.minZ && minZ <= region.maxZ)) continue;
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny <= 0 || ny / Math.hypot(nx, ny, nz) < .75) continue;
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) continue;
      const triangle = { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
        cx: c.x, cy: c.y, cz: c.z, denominator, minX, maxX, minZ, maxZ };
      const triangleIndex = triangles.length; triangles.push(triangle);
      for (let bx = Math.floor(minX / BUCKET_SIZE); bx <= Math.floor(maxX / BUCKET_SIZE); bx++) {
        for (let bz = Math.floor(minZ / BUCKET_SIZE); bz <= Math.floor(maxZ / BUCKET_SIZE); bz++) {
          const key = `${bx},${bz}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(triangleIndex);
        }
      }
    }
  }
  return (x, z) => {
    let height = island.heightAtRendered(x, z);
    const candidates = buckets.get(`${Math.floor(x / BUCKET_SIZE)},${Math.floor(z / BUCKET_SIZE)}`);
    if (!candidates) return height;
    for (let i = 0; i < candidates.length; i++) {
      const triangle = triangles[candidates[i]];
      if (x < triangle.minX - 1e-7 || x > triangle.maxX + 1e-7 || z < triangle.minZ - 1e-7 || z > triangle.maxZ + 1e-7) continue;
      const dx = x - triangle.cx, dz = z - triangle.cz;
      const a = ((triangle.bz - triangle.cz) * dx + (triangle.cx - triangle.bx) * dz) / triangle.denominator;
      const b = ((triangle.cz - triangle.az) * dx + (triangle.ax - triangle.cx) * dz) / triangle.denominator;
      const c = 1 - a - b;
      if (a >= -1e-7 && b >= -1e-7 && c >= -1e-7) height = Math.max(height, a * triangle.ay + b * triangle.by + c * triangle.cy);
    }
    return height;
  };
}
