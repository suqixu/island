import * as THREE from 'three';
import { isCaveReserved } from './cave-layout.js';
import { isLighthouseReserved } from './lighthouse-layout.js';
import { isRestPavilionReserved } from './rest-pavilion-layout.js';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
function visible(object) {
  for (let item = object; item; item = item.parent) if (!item.visible) return false;
  return !!object;
}
function instanceAvailable(mesh, index) {
  return !!mesh?.isInstancedMesh && index < mesh.count && visible(mesh);
}
function reserved(x, z) {
  return isCaveReserved(x, z, .4) || isLighthouseReserved(x, z, .5) || isRestPavilionReserved(x, z, .5);
}

/** 与树干和细枝着色器一致：固定根部、世界米振幅、按世界高度弯曲。 */
function bend(point, root, height, uniforms, time, normal) {
  const t = uniforms?.uTime?.value ?? time;
  const amplitudes = uniforms?.uTreeAmplitudes?.value, direction = uniforms?.uWindDirection?.value;
  const amplitude = amplitudes?.x ?? amplitudes?.[0] ?? 0;
  const dx = direction?.x ?? direction?.[0] ?? 0, dz = direction?.y ?? direction?.[1] ?? 0;
  const phase = root.x * .071 + root.z * .097;
  const h = clamp(((point.y - root.y) / Math.max(height, .1) - .06) / .94, 0, 1);
  const flex = h * h * (3 - 2 * h);
  const sway = .55 * Math.sin(t * .62 + phase) + .24 * Math.sin(t * .93 + phase * 1.7)
    + .11 * Math.sin(t * .27 + phase * .51) + .1 * Math.sin(t * .43);
  const along = sway * amplitude, across = Math.sin(t * .67 + phase + 1.7) * amplitude * .15;
  const x = dx * along - dz * across, z = dz * along + dx * across;
  if (normal) {
    const derivative = 12 * flex * h * (1 - h) / (.94 * Math.max(height, .1));
    normal.y -= (normal.x * x + normal.z * z) * derivative;
    normal.normalize();
  }
  point.x += x * flex * flex; point.z += z * flex * flex;
  return point;
}

/** 只在路径周边小网格中找线段，不对整岛反复扫描。 */
function routeIndex(routes) {
  const buckets = new Map(), size = 12;
  for (const route of routes) {
    if (route.kind === 'cave') continue;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
      const squared = dx * dx + dz * dz;
      if (squared < 1e-8) continue;
      const item = { a, b, dx, dz, squared, radius: (route.width ?? 1.2) / 2, route };
      const margin = item.radius + 10;
      for (let z = Math.floor((Math.min(a.z, b.z) - margin) / size); z <= Math.floor((Math.max(a.z, b.z) + margin) / size); z++) {
        for (let x = Math.floor((Math.min(a.x, b.x) - margin) / size); x <= Math.floor((Math.max(a.x, b.x) + margin) / size); x++) {
          const key = `${x},${z}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(item);
        }
      }
    }
  }
  const near = (x, z) => buckets.get(`${Math.floor(x / size)},${Math.floor(z / size)}`) ?? [];
  function nearest(x, z) {
    let best = null;
    for (const segment of near(x, z)) {
      const t = clamp(((x - segment.a.x) * segment.dx + (z - segment.a.z) * segment.dz) / segment.squared, 0, 1);
      const px = segment.a.x + segment.dx * t, pz = segment.a.z + segment.dz * t;
      const distance = Math.hypot(x - px, z - pz) - segment.radius;
      if (!best || distance < best.distance) best = { segment, x: px, z: pz, distance };
    }
    return best;
  }
  return { near, nearest };
}

function trunkSampler(mesh, index, actual, uniforms) {
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), root = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), local = new THREE.Vector3();
  const triangle = new THREE.Triangle(a, b, c), weights = new THREE.Vector3(), scratchNormal = new THREE.Vector3();
  const geometry = mesh.geometry, position = geometry.attributes.position;
  const sides = geometry.parameters.radialSegments, rows = geometry.parameters.heightSegments;
  const top = geometry.parameters.radiusTop, bottom = geometry.parameters.radiusBottom, height = geometry.parameters.height;
  return function sampleTrunk(time, fraction, angle, standOff, target, normal = scratchNormal) {
    mesh.updateWorldMatrix(true, false); mesh.getMatrixAt(index, matrix); matrix.premultiply(mesh.matrixWorld);
    root.set(actual.x, actual.y, actual.z).applyMatrix4(mesh.matrixWorld);
    const f = clamp(fraction, 0, 1), theta = THREE.MathUtils.euclideanModulo(Math.PI / 2 - angle, TAU);
    const sector = Math.min(sides - 1, Math.floor(theta / TAU * sides));
    const faceAngle = Math.PI / 2 - (sector + .5) / sides * TAU;
    const difference = Math.atan2(Math.sin(angle - faceAngle), Math.cos(angle - faceAngle));
    const radius = THREE.MathUtils.lerp(bottom, top, f) * Math.cos(Math.PI / sides) / Math.cos(difference);
    local.set(Math.cos(angle) * radius, (f - .5) * height, Math.sin(angle) * radius);
    const row = Math.min(rows - 1, Math.floor((1 - f) * rows)), first = row * (sides + 1) + sector;
    const below = first + sides + 1;
    a.fromBufferAttribute(position, first); b.fromBufferAttribute(position, below); c.fromBufferAttribute(position, first + 1);
    triangle.getBarycoord(local, weights);
    if (Math.min(weights.x, weights.y, weights.z) < -1e-5) {
      a.fromBufferAttribute(position, below); b.fromBufferAttribute(position, below + 1); c.fromBufferAttribute(position, first + 1);
      triangle.getBarycoord(local, weights);
    }
    a.applyMatrix4(matrix); b.applyMatrix4(matrix); c.applyMatrix4(matrix);
    target.copy(a).multiplyScalar(weights.x).addScaledVector(b, weights.y).addScaledVector(c, weights.z);
    normal.set(Math.cos(angle), (bottom - top) / height, Math.sin(angle));
    normalMatrix.getNormalMatrix(matrix); normal.applyMatrix3(normalMatrix).normalize();
    // 法线按同一高度剪切场逆转置；表面位置按真实三角形的三个顶点采样。
    bend(target, root, actual.scale * 5.1, uniforms, time, normal);
    bend(a, root, actual.scale * 5.1, uniforms, time); bend(b, root, actual.scale * 5.1, uniforms, time); bend(c, root, actual.scale * 5.1, uniforms, time);
    return target.copy(a).multiplyScalar(weights.x).addScaledVector(b, weights.y).addScaledVector(c, weights.z)
      .addScaledVector(normal, Math.max(0, standOff));
  };
}

function branchPerch(mesh, instance, actual, available, uniforms, rank) {
  const geometry = mesh.geometry, positions = geometry.attributes.position, indices = geometry.index;
  const triangle = new THREE.Triangle(), normal = new THREE.Vector3(), matrix = new THREE.Matrix4();
  mesh.getMatrixAt(instance, matrix);
  const options = [];
  // 前 16 点是中央枝干，之后每 12 点为一根三环四边的横向枝条。
  for (let shoot = 0; shoot < 8; shoot++) {
    const start = 16 + shoot * 12;
    for (let at = 0; at < indices.count; at += 3) {
      const ids = [indices.getX(at), indices.getX(at + 1), indices.getX(at + 2)];
      if (!ids.every(id => id >= start && id < start + 12) || !ids.some(id => id >= start + 4 && id < start + 8)) continue;
      triangle.a.fromBufferAttribute(positions, ids[0]).applyMatrix4(matrix);
      triangle.b.fromBufferAttribute(positions, ids[1]).applyMatrix4(matrix);
      triangle.c.fromBufferAttribute(positions, ids[2]).applyMatrix4(matrix);
      triangle.getNormal(normal);
      if (normal.y > .35) options.push(ids);
    }
  }
  if (!options.length) return null;
  const ids = options[rank % options.length], root = new THREE.Vector3();
  const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id));
  const bent = points.map(() => new THREE.Vector3());
  const shootStart = 16 + Math.floor((ids[0] - 16) / 12) * 12;
  const ring = ids.some(id => id >= shootStart + 8) ? 1 : 0;
  const axisPoints = [0, 1].map(offset => {
    const point = new THREE.Vector3();
    for (let i = 0; i < 4; i++) point.add(new THREE.Vector3().fromBufferAttribute(positions, shootStart + (ring + offset) * 4 + i));
    return point.multiplyScalar(.25);
  });
  const axisBent = [new THREE.Vector3(), new THREE.Vector3()], edge = new THREE.Vector3();
  return { kind: 'branch', available,
    sample(time, target) {
      mesh.updateWorldMatrix(true, false); mesh.getMatrixAt(instance, matrix); matrix.premultiply(mesh.matrixWorld);
      root.set(actual.x, actual.y, actual.z).applyMatrix4(mesh.matrixWorld);
      target.set(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        bent[i].copy(points[i]).applyMatrix4(matrix);
        bend(bent[i], root, actual.scale * 5.1, uniforms, time); target.addScaledVector(bent[i], 1 / 3);
      }
      return target;
    },
    sampleFrame(time, target, normalTarget, tangentTarget) {
      this.sample(time, target);
      normalTarget.subVectors(bent[1], bent[0]); edge.subVectors(bent[2], bent[0]); normalTarget.cross(edge).normalize();
      for (let i = 0; i < 2; i++) bend(axisBent[i].copy(axisPoints[i]).applyMatrix4(matrix), root, actual.scale * 5.1, uniforms, time);
      tangentTarget.subVectors(axisBent[1], axisBent[0]);
      tangentTarget.addScaledVector(normalTarget, -tangentTarget.dot(normalTarget)).normalize();
      return target;
    } };
}

function crosses(a, b, segment) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const determinant = dx * segment.dz - dz * segment.dx;
  if (Math.abs(determinant) < 1e-8) return false;
  const x = segment.a.x - a.x, z = segment.a.z - a.z;
  const t = (x * segment.dz - z * segment.dx) / determinant;
  const u = (x * dz - z * dx) / determinant;
  return t > .1 && t < .9 && u >= 0 && u <= 1;
}

function safeSlope(points) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], rise = Math.abs(b.y - a.y), run = Math.hypot(b.x - a.x, b.z - a.z);
    if (rise > .18 || rise > run * .7 || !Number.isFinite(rise + run)) return false;
  }
  return true;
}

function groundCrossings(group, selected, paths, heightAt, random) {
  const surfaces = [];
  group.traverse(mesh => {
    if (mesh.isMesh && ['环岛沙土与登山小径', '山径天然石阶'].includes(mesh.name)) surfaces.push(mesh);
  });
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
  const candidates = [], result = [], used = new Set();
  // 只让距离较近、真正跨过路径中心线的树根配对。
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const a = selected[i], b = selected[j], distance = Math.hypot(a.actual.x - b.actual.x, a.actual.z - b.actual.z);
    if (distance < 4 || distance > 16) continue;
    const near = paths.near((a.actual.x + b.actual.x) / 2, (a.actual.z + b.actual.z) / 2);
    if (near.some(segment => crosses(a.actual, b.actual, segment))) candidates.push({ a, b, distance, rank: distance + random() * 5, lowQuality: a.lowQuality && b.lowQuality });
  }
  candidates.sort((a, b) => Number(b.lowQuality) - Number(a.lowQuality) || a.rank - b.rank);
  let casts = 0;
  for (const { a, b, distance } of candidates) {
    if (result.length >= 6 || casts >= 144) break;
    if (used.has(a) || used.has(b)) continue;
    const steps = Math.ceil(distance / .24), local = [], touched = new Set();
    let valid = true;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = THREE.MathUtils.lerp(a.actual.x, b.actual.x, t), z = THREE.MathUtils.lerp(a.actual.z, b.actual.z, t);
      const y = heightAt(x, z);
      if (!Number.isFinite(y) || y < .2 || reserved(x, z)) { valid = false; break; }
      local.push(new THREE.Vector3(x, y, z));
    }
    if (!valid || !safeSlope(local)) continue;
    const points = local.map(point => point.clone().applyMatrix4(group.matrixWorld));
    for (let i = 0; i < local.length && surfaces.length; i++) {
      const near = paths.nearest(local[i].x, local[i].z);
      if (!near || near.distance > .30) continue;
      if (casts >= 144) { valid = false; break; }
      origin.copy(points[i]); origin.y += 2; ray.set(origin, down); ray.near = 0; ray.far = 4; casts++;
      const hits = ray.intersectObjects(surfaces, false);
      const hit = hits.find(item => item.point.y >= points[i].y - .001 && visible(item.object));
      if (hit) { points[i].copy(hit.point); touched.add(hit.object); }
    }
    if (!valid || !safeSlope(points)) continue;
    result.push({ from: a.tree, to: b.tree, points,
      available: () => a.tree.available() && b.tree.available() && [...touched].every(visible) });
    used.add(a); used.add(b);
  }
  return result;
}

/** 从已有森林和路径生成少量真实栖息位置；不生成动物或额外场景资源。 */
export function createWoodlandHabitats({ group, forest, uniforms = {}, pathLayout, random = Math.random }) {
  const perches = [], trees = [], crossings = [], fireflyHabitats = [];
  if (!forest?.trees?.length || !forest.trunks || !pathLayout?.routes?.length || !pathLayout.heightAtRendered) {
    return { perches, trees, crossings, fireflyHabitats };
  }
  group.updateWorldMatrix(true, true);
  const paths = routeIndex(pathLayout.routes), counters = [0, 0, 0, 0], candidates = [];
  const heightAt = pathLayout.heightAtRendered;
  forest.trees.forEach((actual, index) => {
    const variant = actual.variant ?? index % 4, instance = counters[variant]++;
    const near = paths.nearest(actual.x, actual.z);
    if (!near || near.distance < .5 || near.distance > 9 || reserved(actual.x, actual.z)) return;
    const canopy = forest.canopies[variant], branches = group.getObjectByName(`森林细枝-${variant + 1}`);
    if (!canopy || !branches) return;
    const root = new THREE.Vector3(actual.x, actual.y, actual.z).applyMatrix4(group.matrixWorld);
    const available = () => instanceAvailable(forest.trunks, index * 3)
      && instanceAvailable(canopy, instance) && instanceAvailable(branches, instance);
    const tree = { root, height: actual.scale * 5.1, available,
      sampleTrunk: trunkSampler(forest.trunks, index * 3, actual, uniforms) };
    const lowQuality = index < Math.floor(forest.trees.length * .5) && instance < Math.floor(canopy.count * .5) && instance < Math.floor(branches.count * .5);
    candidates.push({ actual, tree, branches, instance, near, lowQuality, score: near.distance + random() * 7 });
  });
  candidates.sort((a, b) => a.score - b.score);
  // 安全跨路配对先从全部真实候选中找，再用剩余名额补近路径树，避免只选到陡坡。
  crossings.push(...groundCrossings(group, candidates, paths, heightAt, random));
  const paired = new Set(crossings.flatMap(crossing => [crossing.from, crossing.to]));
  const ordered = [...candidates.filter(candidate => paired.has(candidate.tree)), ...candidates.filter(candidate => !paired.has(candidate.tree))];
  const selected = [];
  for (const candidate of ordered) {
    if (selected.length >= 30) break;
    if (!paired.has(candidate.tree) && selected.some(item => item.tree.root.distanceTo(candidate.tree.root) < 2.2)) continue;
    selected.push(candidate); trees.push(candidate.tree);
    const perch = branchPerch(candidate.branches, candidate.instance, candidate.actual, candidate.tree.available, uniforms, Math.floor(random() * 1000));
    if (perch) perches.push(perch);
    const { actual, near } = candidate, dx = actual.x - near.x, dz = actual.z - near.z;
    const radius = near.segment.radius + .85, distance = Math.hypot(dx, dz);
    const x = near.x + dx / distance * radius, z = near.z + dz / distance * radius, y = heightAt(x, z);
    const pathGap = paths.nearest(x, z)?.distance ?? Infinity;
    const slope = Math.max(Math.abs(heightAt(x + .3, z) - heightAt(x - .3, z)),
      Math.abs(heightAt(x, z + .3) - heightAt(x, z - .3))) / .6;
    if (Number.isFinite(y) && y > .2 && slope < .7 && pathGap > .45 && pathGap < 3 && !reserved(x, z)) {
      const point = new THREE.Vector3(x, y, z);
      fireflyHabitats.push({ available: candidate.tree.available,viewFrom:new THREE.Vector3(near.x,heightAt(near.x,near.z)+1,near.z).applyMatrix4(group.matrixWorld),
        sample(time, target) { group.updateWorldMatrix(true, false); return target.copy(point).applyMatrix4(group.matrixWorld); } });
    }
  }
  return { perches, trees, crossings, fireflyHabitats };
}

/** 最高平横栏来自实际合并几何；亭高、地台高度与世界变换均无需推算。 */
export function createRailPerches(roots) {
  const perches = [];
  for (const entry of roots ?? []) {
    const root = entry?.group ?? entry;
    if (!root?.traverse) continue;
    root.traverse(mesh => {
      if (!mesh.isMesh || mesh.name !== '山亭三面木栏') return;
      const { geometry } = mesh, position = geometry.attributes.position, indices = geometry.index;
      const triangle = new THREE.Triangle(), normal = new THREE.Vector3(), candidates = [];
      let highest = -Infinity;
      for (let at = 0; at < (indices?.count ?? position.count); at += 3) {
        triangle.a.fromBufferAttribute(position, indices ? indices.getX(at) : at);
        triangle.b.fromBufferAttribute(position, indices ? indices.getX(at + 1) : at + 1);
        triangle.c.fromBufferAttribute(position, indices ? indices.getX(at + 2) : at + 2);
        triangle.getNormal(normal);
        if (normal.y < .99 || Math.max(triangle.a.y, triangle.b.y, triangle.c.y) - Math.min(triangle.a.y, triangle.b.y, triangle.c.y) > 1e-5) continue;
        const point = triangle.getMidpoint(new THREE.Vector3()); highest = Math.max(highest, point.y); candidates.push({ point, at });
      }
      const accepted = [];
      for (const { point, at } of candidates) {
        if (point.y < highest - 1e-5 || accepted.some(other => other.distanceTo(point) < .22)) continue;
        accepted.push(point);
        const ids = [0, 1, 2].map(offset => indices ? indices.getX(at + offset) : at + offset);
        const vertices = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
        const edges = vertices.map((vertex, i) => vertex.clone().sub(vertices[(i + 1) % 3]));
        edges.sort((a, b) => b.lengthSq() - a.lengthSq());
        const axis = edges[0].normalize(), normalMatrix = new THREE.Matrix3();
        perches.push({ kind: 'rail',
          available: () => visible(mesh) && at >= geometry.drawRange.start && at + 3 <= geometry.drawRange.start + geometry.drawRange.count,
          sample(time, target) { mesh.updateWorldMatrix(true, false); return target.copy(point).applyMatrix4(mesh.matrixWorld); },
          sampleFrame(time, target, normalTarget, tangentTarget) {
            this.sample(time, target); normalMatrix.getNormalMatrix(mesh.matrixWorld);
            normalTarget.set(0, 1, 0).applyMatrix3(normalMatrix).normalize(); tangentTarget.copy(axis).transformDirection(mesh.matrixWorld);
            return target;
          } });
      }
    });
  }
  return perches;
}
