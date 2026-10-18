import * as THREE from 'three';

const BASE_OFFSET = .015;
const vertexKey = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
function snowVariation(x, z) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** 独立的封闭屋面积雪。顶层抬高、底层贴屋面，整壳以 aSnowBase
 * 为零厚度位置。先合并屋面接缝，再让顶面与侧壁共用边缘法线。
 */
export function createSnowRoofShell(sourceGeometry, { thickness = .16 } = {}) {
  const source = sourceGeometry.attributes.position;
  const height = Number.isFinite(thickness) ? Math.max(.001, thickness) : .16;
  const points = [], remap = [], unique = new Map();
  for (let i = 0; i < source.count; i++) {
    const x = source.getX(i), y = source.getY(i), z = source.getZ(i);
    const key = vertexKey(x, y, z);
    if (!unique.has(key)) { unique.set(key, points.length); points.push([x, y, z]); }
    remap.push(unique.get(key));
  }
  const topFaces = [], edges = new Map(), sourceIndex = sourceGeometry.index;
  const count = sourceIndex ? sourceIndex.count : source.count;
  const read = index => remap[sourceIndex ? sourceIndex.getX(index) : index];
  for (let i = 0; i < count; i += 3) {
    let a = read(i), b = read(i + 1), c = read(i + 2);
    if (a === b || b === c || c === a) continue;
    const p = points[a], q = points[b], r = points[c];
    // 屋面是沿 Y 轴抬高的曲面，顶层统一朝上，底层与侧壁反向闭合。
    const up = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
    if (up < 0) [b, c] = [c, b];
    topFaces.push(a, b, c);
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(start, end), edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { start, end, count: 1 });
    }
  }
  const positions = [], bases = [], indices = [...topFaces], offset = points.length;
  for (const top of [true, false]) for (const [x, y, z] of points) {
    const baseY = y + BASE_OFFSET;
    positions.push(x, baseY + (top ? height * (.92 + snowVariation(x, z) * .16) : 0), z);
    bases.push(x, baseY, z);
  }
  for (let i = 0; i < topFaces.length; i += 3) {
    indices.push(topFaces[i] + offset, topFaces[i + 2] + offset, topFaces[i + 1] + offset);
  }
  for (const { start: a, end: b, count: uses } of edges.values()) {
    if (uses !== 1) continue;
    indices.push(b, a, a + offset, b, a + offset, b + offset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSnowBase', new THREE.Float32BufferAttribute(bases, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** 单位雪板按实例缩放厚度；所有顶点从底平面生长，融雪不会抬高根部。 */
export function createSnowBoardGeometry() {
  const geometry = new THREE.BoxGeometry(1, 1, 1), position = geometry.attributes.position;
  const bases = [];
  for (let i = 0; i < position.count; i++) bases.push(position.getX(i), -.5, position.getZ(i));
  geometry.setAttribute('aSnowBase', new THREE.Float32BufferAttribute(bases, 3));
  return geometry;
}
