import * as THREE from 'three';

const positionKey = (position, i) => [position.getX(i), position.getY(i), position.getZ(i)]
  .map(value => Math.round(value * 1e5)).join(',');

/** 雪面单独使用平滑法线；裸岩仍保留原来的逐面法线和所有原始属性。
 * 同位置的非索引副本参与同一平均，避免 IcosahedronGeometry 的三角面接缝。
 */
export function addSmoothSnowNormals(geometry) {
  if (geometry.hasAttribute('aSnowNormal')) return geometry;
  const position = geometry.attributes.position;
  if (!position) return geometry;
  const source = geometry.attributes.normal, normals = new Float64Array(position.count * 3);
  if (source) {
    for (let i = 0; i < position.count; i++) {
      normals[i * 3] = source.getX(i);
      normals[i * 3 + 1] = source.getY(i);
      normals[i * 3 + 2] = source.getZ(i);
    }
  } else {
    // 无 normal 的输入在独立数组中累加面积加权面法线，不补写原 normal。
    const index = geometry.index, count = index ? index.count : position.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const vertices = [0, 1, 2].map(offset => index ? index.getX(triangle + offset) : triangle + offset);
      a.fromBufferAttribute(position, vertices[0]);
      b.fromBufferAttribute(position, vertices[1]).sub(a);
      c.fromBufferAttribute(position, vertices[2]).sub(a);
      b.cross(c);
      for (const vertex of vertices) {
        normals[vertex * 3] += b.x;
        normals[vertex * 3 + 1] += b.y;
        normals[vertex * 3 + 2] += b.z;
      }
    }
  }
  const groups = new Map(), keys = [];
  for (let i = 0; i < position.count; i++) {
    const key = positionKey(position, i), sum = groups.get(key) ?? [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const value = normals[i * 3 + axis];
      if (Number.isFinite(value)) sum[axis] += value;
    }
    groups.set(key, sum); keys.push(key);
  }
  for (const sum of groups.values()) {
    const length = Math.hypot(...sum);
    if (length > 1e-12 && Number.isFinite(length)) {
      for (let axis = 0; axis < 3; axis++) sum[axis] /= length;
    } else { sum[0] = 0; sum[1] = 1; sum[2] = 0; }
  }
  const output = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) output.set(groups.get(keys[i]), i * 3);
  geometry.setAttribute('aSnowNormal', new THREE.Float32BufferAttribute(output, 3));
  return geometry;
}
