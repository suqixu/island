import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt as terrainHeight, seededRandom, hash, noise } from './terrain.js';
import { getIslandPathLayout, TERRAIN_GRID, PATH_LIFT } from './path-layout.js';
import { CAVE_LAYOUT, caveToLocal } from './cave-layout.js';
import { REST_PAVILION_SITES } from './rest-pavilion-layout.js';
import { getVegetationFlex, createVegetationWindState, advanceVegetationWind,
  configureVegetationWindShader } from './vegetation-motion.js';

const area = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const MAX_RISER = .195;

function clipTriangle(polygon, triangle) {
  const direction = Math.sign(area(...triangle)); let result = polygon;
  for (let edge = 0; edge < 3 && result.length; edge++) {
    const a = triangle[edge], b = triangle[(edge + 1) % 3], input = result; result = [];
    let previous = input.at(-1), before = area(a, b, previous) * direction;
    for (const point of input) {
      const next = area(a, b, point) * direction;
      if ((next >= -1e-9) !== (before >= -1e-9)) {
        const amount = before / (before - next);
        result.push({ x: previous.x + (point.x - previous.x) * amount, z: previous.z + (point.z - previous.z) * amount,
          edge: (previous.edge ?? 0) + ((point.edge ?? 0) - (previous.edge ?? 0)) * amount });
      }
      if (next >= -1e-9) result.push(point);
      previous = point; before = next;
    }
  }
  return result;
}

function roadGeometry(layout) {
  const positions = [], colors = [], uvs = [], edges = [], mountains = [], step = TERRAIN_GRID.step;
  const sand = new THREE.Color('#c7b591'), trail = new THREE.Color('#b2ac94'), color = new THREE.Color();
  const earth = new THREE.Color('#766654'), stone = new THREE.Color('#72776d');
  const add = (point, mountain, beach) => {
    const y = layout.heightAtRendered(point.x, point.z);
    positions.push(point.x, y + PATH_LIFT, point.z);
    if (mountain) {
      const patch = (noise(point.x * .30 + 13, point.z * .30 - 7) + 1) * .5;
      color.copy(earth).lerp(stone, patch * .78).multiplyScalar(.84 + patch * .31);
      if (beach) color.lerp(sand, 1 - THREE.MathUtils.smoothstep(y, .7, 4.8));
    } else color.copy(sand).lerp(trail, THREE.MathUtils.smoothstep(y, 4, 20));
    color.multiplyScalar(.93 + hash(point.x * 4.7, point.z * 4.7) * .12);
    color.toArray(colors, colors.length); uvs.push(point.x / 2.8, point.z / 2.8);
    edges.push(point.edge); mountains.push(mountain ? 1 : 0);
  };
  for (const route of layout.routes) {
    const points = route.points, mountain = route.kind !== 'coastal', beach = route.kind === 'beach';
    const edgeAt = index => {
      const point = points[index];
      const before = points[index > 0 ? index - 1 : route.closed ? points.length - 2 : 0];
      const after = points[index < points.length - 1 ? index + 1 : route.closed ? 1 : points.length - 1];
      const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1;
      const half = mountain ? route.width * .5 * (1 + Math.sin(point.x * .53 + point.z * .37) * .05
        + noise(point.x * .18, point.z * .18) * .025) : route.width * .5 + Math.sin(point.x * .53 + point.z * .37) * .045;
      return [{ x: point.x - dz / length * half, z: point.z + dx / length * half, edge: -1 },
        { x: point.x + dz / length * half, z: point.z - dx / length * half, edge: 1 }];
    };
    let previous = edgeAt(0);
    for (let segment = 1; segment < points.length; segment++) {
      const next = edgeAt(segment), quad = [previous[0], previous[1], next[1], next[0]];
      const left = Math.max(0, Math.floor((Math.min(...quad.map(point => point.x)) + 155) / step));
      const right = Math.min(255, Math.floor((Math.max(...quad.map(point => point.x)) + 155) / step));
      const bottom = Math.max(0, Math.floor((Math.min(...quad.map(point => point.z)) + 155) / step));
      const top = Math.min(255, Math.floor((Math.max(...quad.map(point => point.z)) + 155) / step));
      for (let iz = bottom; iz <= top; iz++) for (let ix = left; ix <= right; ix++) {
        const x = -155 + ix * step, z = -155 + iz * step;
        const a = { x, z }, b = { x, z: z + step }, c = { x: x + step, z: z + step }, d = { x: x + step, z };
        for (const triangle of [[a, b, d], [b, c, d]]) {
          const clipped = clipTriangle(quad, triangle);
          for (let i = 1; i < clipped.length - 1; i++) {
            const signed = area(clipped[0], clipped[i], clipped[i + 1]);
            if (Math.abs(signed) < 1e-9) continue;
            add(clipped[0], mountain, beach); add(clipped[signed < 0 ? i : i + 1], mountain, beach); add(clipped[signed < 0 ? i + 1 : i], mountain, beach);
          }
        }
      }
      previous = next;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aPathEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aMountain', new THREE.Float32BufferAttribute(mountains, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

const PATH_NOISE = /* glsl */ `
  float pathHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float pathNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), u.x),
      mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float pathStoneNoise(vec3 p) {
    float layer = floor(p.y), f = fract(p.y), u = f * f * (3.0 - 2.0 * f);
    return mix(pathNoise(p.xz + layer * vec2(19.17, 7.73)),
      pathNoise(p.xz + (layer + 1.0) * vec2(19.17, 7.73)), u);
  }
`;

function configurePathMaterial(material, snow, feather) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uPathSnow = snow;
    shader.vertexShader = `varying vec3 vPathWorld; varying float vMountain;
      ${feather ? 'attribute float aMountain; attribute float aPathEdge; varying float vPathEdge;' : ''}
      ${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vPathWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vMountain = ${feather ? 'aMountain' : '1.0'};
      ${feather ? 'vPathEdge = aPathEdge;' : ''}`);
    shader.fragmentShader = `uniform float uPathSnow; varying vec3 vPathWorld; varying float vMountain;
      ${feather ? 'varying float vPathEdge;' : ''}
      ${PATH_NOISE}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float pathBroad = ${feather ? 'pathNoise(vPathWorld.xz * 0.38 + 4.3)' : 'pathStoneNoise(vPathWorld * 0.85 + 4.3)'};
      float pathMedium = ${feather ? 'pathNoise(vPathWorld.xz * 3.7 - 7.1)' : 'pathStoneNoise(vPathWorld * 4.7 - 7.1)'};
      float pathFootprint = length(fwidth(${feather ? 'vPathWorld.xz' : 'vPathWorld'} * 16.0));
      float pathFine = mix(0.5, ${feather ? 'pathNoise(vPathWorld.xz * 16.0)' : 'pathStoneNoise(vPathWorld * 16.0)'},
        1.0 - smoothstep(0.35, 1.3, pathFootprint));
      float pathRelief = (pathMedium * 0.014 + pathFine * 0.010) * vMountain;
      diffuseColor.rgb *= mix(1.0, 0.81 + pathBroad * 0.21 + pathMedium * 0.10 + pathFine * 0.08, vMountain);
      vec3 pathFace = cross(dFdx(vPathWorld), dFdy(vPathWorld));
      float pathUp = abs(pathFace.y) / max(length(pathFace), 0.00001);
      ${feather ? '' : `float pathStrata = pathStoneNoise(vec3(vPathWorld.x * 1.4,
          vPathWorld.y * 7.5 + pathBroad * 0.8, vPathWorld.z * 1.4));
        float pathWall = 1.0 - smoothstep(0.45, 0.85, pathUp);
        diffuseColor.rgb *= mix(1.0, 0.68 + pathStrata * 0.42, pathWall);
        pathRelief += pathWall * (pathStrata * 0.025 + pathMedium * 0.018);`}
      float pathSnow = uPathSnow * smoothstep(12.0, 30.0, vPathWorld.y)
        * smoothstep(0.35, 0.8, pathUp) * vMountain;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.80, 0.76), pathSnow * 0.75);
      ${feather ? `float pathEdgeNoise = pathNoise(vPathWorld.xz * 2.5 + 9.1);
        float pathFeather = 1.0 - smoothstep(0.74 + (pathEdgeNoise - 0.5) * 0.15 - fwidth(vPathEdge),
          1.0, abs(vPathEdge));
        diffuseColor.a *= mix(1.0, pathFeather, vMountain);` : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #ifdef USE_BUMPMAP
        normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(pathRelief), dFdy(pathRelief)), faceDirection);
      #endif`);
  };
  material.customProgramCacheKey = () => feather ? 'island-path-feather-v1' : 'island-path-stone-v2';
}

function rowTriangles(footprint) {
  return THREE.ShapeUtils.triangulateShape(footprint.map(p => new THREE.Vector2(p.x, p.z)), [])
    .map(indices => indices.map(index => footprint[index]));
}

function convexPerimeter(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = input => {
    const result = [];
    for (const p of input) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= .000000001) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

// Square the standing area to the door, using the existing strips' bounds.
// One rectangular cap has neither diagonal ears nor intersecting slab edges.
function landingPerimeter(polygons, site) {
  const span = Math.hypot(site.entranceDirection.x, site.entranceDirection.z);
  const sin = site.entranceDirection.x / span, cos = site.entranceDirection.z / span;
  let left = Infinity, right = -Infinity, front = Infinity, back = -Infinity;
  for (const polygon of polygons) for (const p of polygon) {
    const dx = p.x - site.position.x, dz = p.z - site.position.z;
    const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
    left = Math.min(left, x); right = Math.max(right, x); front = Math.min(front, z); back = Math.max(back, z);
  }
  return [[left, front], [right, front], [right, back], [left, back]].map(([x, z]) => ({
    x: site.position.x + x * cos + z * sin, z: site.position.z - x * sin + z * cos,
  }));
}

function terrainPerimeter(points) {
  const result = [], step = TERRAIN_GRID.step;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], cuts = [0];
    for (const [start, end, origin] of [[a.x, b.x, -155], [a.z, b.z, -155], [a.x + a.z, b.x + b.z, -310]]) {
      if (Math.abs(end - start) < .0000001) continue;
      const first = Math.floor((Math.min(start, end) - origin) / step) + 1;
      const last = Math.floor((Math.max(start, end) - origin) / step);
      for (let grid = first; grid <= last; grid++) {
        const t = (origin + grid * step - start) / (end - start);
        if (t > .000001 && t < .999999) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let j = 0; j < cuts.length; j++) {
      if (j && cuts[j] - cuts[j - 1] < .000001) continue;
      const t = cuts[j]; result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return result;
}

/** Rough battered stone support, with only visible risers at neighbouring treads. */
export function appendTerracedStoneSkirt(footprint, top, groundAt, emit, { edgeFloor, edgeOutset, maxOutset = .16 } = {}) {
  let signed = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length]; signed += a.x * b.z - b.x * a.z;
  }
  const points = signed < 0 ? [...footprint].reverse() : footprint;
  const normals = points.map((a, i) => {
    const b = points[(i + 1) % points.length], span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return edgeOutset?.(a, b) === false ? { x: 0, z: 0 } : { x: (b.z - a.z) / span, z: -(b.x - a.x) / span };
  });
  const outward = points.map((p, i) => {
    const a = normals[(i + points.length - 1) % points.length], b = normals[i];
    const x = a.x + b.x, z = a.z + b.z, length = Math.hypot(x, z);
    if (length < .00001) return { x: 0, z: 0 };
    const projection = a.x || a.z ? (x * a.x + z * a.z) / length : (x * b.x + z * b.z) / length;
    const scale = Math.min(1.4, 1 / Math.max(.7, projection));
    return { x: x / length * scale, z: z / length * scale };
  });
  const ends = points.flatMap((p, i) => normals[i].x || normals[i].z ? [] : [[p, points[(i + 1) % points.length]]]);
  const endClearance = p => {
    let distance = Infinity;
    for (const [a, b] of ends) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      distance = Math.min(distance, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
    }
    return THREE.MathUtils.smoothstep(distance, .02, .12);
  };
  const level = (k, p) => top - k * .16 + (k ? noise(p.x * 5.1 + k * 1.83, p.z * 4.7 - k * 2.91) * .028 : 0);
  for (let edge = 0; edge < points.length; edge++) {
    const a = points[edge], b = points[(edge + 1) % points.length], va = outward[edge], vb = outward[(edge + 1) % points.length];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .06));
    for (let part = 0; part < count; part++) {
      const sample = t => {
        const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        const floor = edgeFloor?.(p, a, b), lift = top - groundAt(p.x, p.z);
        // Side batter also returns to zero at a closed end corner, so the
        // support never wraps under the adjoining wooden threshold.
        const mask = Number.isFinite(floor) ? 0 : THREE.MathUtils.clamp((lift - .23) / .33, 0, 1) * endClearance(p);
        const vector = { x: (va.x + (vb.x - va.x) * t) * mask, z: (va.z + (vb.z - va.z) * t) * mask };
        // Only the East landing's tall exposed walls need a broad slope toe.
        // Low support and every South tread keep their accepted narrow profile.
        const broad = THREE.MathUtils.smoothstep(lift, 1, 1.2) * (maxOutset - .16);
        const outset = (.16 + broad) * (1 + (.045 + broad * .12) * noise(p.x * 6.5 + 3, p.z * 6.5 - 8));
        const foot = { x: p.x + vector.x * outset, z: p.z + vector.z * outset };
        const bed = Math.max(groundAt(foot.x, foot.z) - .06, floor ?? -Infinity);
        const depth = Math.max(.16, top - bed);
        return { p, floor, bed, at(k) {
          const y = level(k, p), progress = THREE.MathUtils.clamp((top - y) / depth, 0, 1);
          const roughness = (.014 + broad * .05) * Math.sin(progress * Math.PI) * noise(p.x * 4.7 + (top - y) * 4.8, p.z * 5.3 - (top - y) * 2.3);
          const offset = THREE.MathUtils.clamp(outset * progress + roughness, 0, outset);
          return { x: p.x + vector.x * offset, z: p.z + vector.z * offset, y, edgeT: t };
        } };
      };
      const start = sample(part / count), end = sample((part + 1) / count);
      const base = point => {
        const p = { x: a.x + (b.x - a.x) * point.edgeT, z: a.z + (b.z - a.z) * point.edgeT };
        return Math.max(groundAt(point.x, point.z) - .06, edgeFloor?.(p, a, b) ?? -Infinity);
      };
      const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t, edgeT: a.edgeT + (b.edgeT - a.edgeT) * t });
      const courses = Math.max(1, Math.ceil((top - Math.min(start.bed, end.bed)) / .16) + 1);
      for (let k = 0; k < courses; k++) {
        const quad = [start.at(k), start.at(k + 1), end.at(k + 1), end.at(k)], clipped = [];
        let before = quad.at(-1), beforeGap = before.y - base(before);
        for (const point of quad) {
          const gap = point.y - base(point);
          if ((gap >= 0) !== (beforeGap >= 0)) {
            // The lower endpoints have moved outward. Clip against soil at
            // those actual positions, rather than reuse the upper edge's bed.
            let lo = 0, hi = 1;
            for (let i = 0; i < 14; i++) {
              const middle = (lo + hi) * .5, p = lerp(before, point, middle);
              if ((p.y >= base(p)) === (beforeGap >= 0)) lo = middle; else hi = middle;
            }
            clipped.push(lerp(before, point, (lo + hi) * .5));
          }
          if (gap >= 0) clipped.push(point);
          before = point; beforeGap = gap;
        }
        if (clipped.length < 3) continue;
        const centre = clipped.reduce((p, v) => ({ x: p.x + v.x / clipped.length,
          y: p.y + v.y / clipped.length, z: p.z + v.z / clipped.length }), { x: 0, y: 0, z: 0 });
        const shade = .82 + (noise(centre.x * 4.1 + centre.y * 3.7, centre.z * 4.3 - centre.y * 2.9) + 1) * .045;
        for (let i = 1; i < clipped.length - 1; i++) {
          emit(clipped[0], clipped[i], clipped[i + 1], shade);
        }
      }
    }
  }
}

function rowGroundMax(triangles, layout, extraGround = []) {
  let maximum = -Infinity;
  const step = TERRAIN_GRID.step;
  // The land mesh is piecewise linear. Its exact maximum inside a tread is at
  // a clipped terrain vertex, including grid edges a coarse sample could miss.
  for (const triangle of triangles) {
    const left = Math.max(0, Math.floor((Math.min(...triangle.map(p => p.x)) + 155) / step));
    const right = Math.min(255, Math.floor((Math.max(...triangle.map(p => p.x)) + 155) / step));
    const bottom = Math.max(0, Math.floor((Math.min(...triangle.map(p => p.z)) + 155) / step));
    const top = Math.min(255, Math.floor((Math.max(...triangle.map(p => p.z)) + 155) / step));
    for (const p of triangle) maximum = Math.max(maximum, layout.heightAtRendered(p.x, p.z));
    for (let iz = bottom; iz <= top; iz++) for (let ix = left; ix <= right; ix++) {
      const x = -155 + ix * step, z = -155 + iz * step;
      const a = { x, z }, b = { x, z: z + step }, c = { x: x + step, z: z + step }, d = { x: x + step, z };
      for (const cell of [[a, b, d], [b, c, d]]) for (const p of clipTriangle(triangle, cell)) {
        maximum = Math.max(maximum, layout.heightAtRendered(p.x, p.z));
      }
    }
    for (const ground of extraGround) {
      if (Math.max(...ground.map(p => p.x)) < Math.min(...triangle.map(p => p.x))
        || Math.min(...ground.map(p => p.x)) > Math.max(...triangle.map(p => p.x))
        || Math.max(...ground.map(p => p.z)) < Math.min(...triangle.map(p => p.z))
        || Math.min(...ground.map(p => p.z)) > Math.max(...triangle.map(p => p.z))) continue;
      for (const p of clipTriangle(triangle, ground)) maximum = Math.max(maximum, layout.heightAtRendered(p.x, p.z));
    }
  }
  return maximum;
}

function caveWalkingGround(floor, fallback) {
  if (!floor?.isMesh) return null;
  floor.updateWorldMatrix(true, false);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const cache = new Map(), triangles = [], p = floor.geometry.attributes.position, indices = floor.geometry.index;
  const count = indices?.count ?? p.count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [];
    for (let j = 0; j < 3; j++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, indices ? indices.getX(i + j) : i + j).applyMatrix4(floor.matrixWorld);
      triangle.push({ x: v.x, z: v.z });
    }
    triangles.push(triangle);
  }
  return { triangles, sample(x, z) {
    const key = `${x},${z}`;
    if (!cache.has(key)) {
      ray.ray.origin.set(x, 1000, z);
      const hit = ray.intersectObject(floor, false)[0]; cache.set(key, hit ? hit.point.y : fallback(x, z));
    }
    return cache.get(key);
  } };
}

function coupleOverlappingRows(rows) {
  const buckets = new Map(), pairs = new Set(), size = 2;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], p = row.footprint;
    const bounds = { left: Math.min(...p.map(v => v.x)), right: Math.max(...p.map(v => v.x)),
      bottom: Math.min(...p.map(v => v.z)), top: Math.max(...p.map(v => v.z)) };
    row.bounds = bounds;
    for (let iz = Math.floor(bounds.bottom / size); iz <= Math.floor(bounds.top / size); iz++) {
      for (let ix = Math.floor(bounds.left / size); ix <= Math.floor(bounds.right / size); ix++) {
        const key = `${ix},${iz}`, bucket = buckets.get(key) ?? [];
        for (const otherIndex of bucket) {
          const other = rows[otherIndex], pair = `${otherIndex},${index}`;
          if (pairs.has(pair)) continue; pairs.add(pair);
          if (row.routeId === other.routeId && Math.abs(row.index - other.index) <= 1) continue;
          // Normal neighbouring stone lips keep their riser. Only a fold
          // crossing the walking lines adds a non-neighbour step constraint.
          const b = other.bounds;
          if (bounds.left >= b.right || bounds.right <= b.left || bounds.bottom >= b.top || bounds.top <= b.bottom) continue;
          if (row.routeId === other.routeId) {
            const contact = (lines, triangles) => lines.some(line => {
              for (let i = 1; i < line.length; i++) for (const triangle of triangles) {
                if (clipTriangle([line[i - 1], line[i]], triangle).length) return true;
              }
              return false;
            });
            if (!contact(row.walkLines, other.triangles) && !contact(other.walkLines, row.triangles)) continue;
          }
          let overlap = false;
          for (const a of row.triangles) {
            for (const b of other.triangles) {
              const clipped = clipTriangle(a, b);
              let signed = 0;
              for (let i = 0; i < clipped.length; i++) {
                const p = clipped[i], q = clipped[(i + 1) % clipped.length]; signed += p.x * q.z - q.x * p.z;
              }
              if (Math.abs(signed) > .00002) { overlap = true; break; }
            }
            if (overlap) break;
          }
          if (overlap) {
            row.neighbors.push({ row: other, limit: MAX_RISER }); other.neighbors.push({ row, limit: MAX_RISER });
          }
        }
        bucket.push(index); buckets.set(key, bucket);
      }
    }
  }
}

function walkableMountainRows(routes, layout, caveGround) {
  const paths = [];
  for (let route of routes.filter(route => route.kind === 'mountain' || route.forceSteps && route.kind !== 'coastal')) {
    const groundAt = route.kind === 'cave' && caveGround ? caveGround.sample : layout.heightAtRendered;
    if (route.kind === 'cave' && caveGround) {
      const last = route.points.at(-1), local = caveToLocal(last);
      if (Math.abs(local.side) < 2 && local.forward > 1.2 && local.forward < 4.5) {
        const extension = local.forward - 1;
        const end = { x: last.x - CAVE_LAYOUT.direction.x * extension, z: last.z - CAVE_LAYOUT.direction.z * extension };
        route = { ...route, points: [...route.points, { ...end, y: groundAt(end.x, end.z) + PATH_LIFT }] };
      }
    }
    const distance = [0];
    for (let i = 1; i < route.points.length; i++) distance.push(distance.at(-1)
      + Math.hypot(route.points[i].x - route.points[i - 1].x, route.points[i].z - route.points[i - 1].z));
    const total = distance.at(-1);
    if (total < .28) continue;
    const at = value => {
      const s = THREE.MathUtils.clamp(value, 0, total); let low = 0, high = distance.length - 1;
      while (high - low > 1) { const middle = (low + high) >> 1; if (distance[middle] <= s) low = middle; else high = middle; }
      const a = route.points[low], b = route.points[high], t = (s - distance[low]) / Math.max(distance[high] - distance[low], .000001);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };
    const section = value => {
      const p = at(value), before = at(value - .18), after = at(value + .18);
      const span = Math.hypot(after.x - before.x, after.z - before.z) || 1;
      return { ...p, dx: (after.x - before.x) / span, dz: (after.z - before.z) / span };
    };
    const cells = []; let s = 0;
    if (route.kind === 'mountain') {
      const count = Math.max(1, Math.floor(total / .28));
      for (let i = 0; i < count; i++) cells.push({ start: total * i / count, end: total * (i + 1) / count, landing: false });
      s = total;
    }
    while (s < total - .000001) {
      const a = at(s), b = at(Math.min(total, s + .35)), probe = Math.min(.35, total - s);
      const grade = Math.abs(groundAt(b.x, b.z) - groundAt(a.x, a.z)) / Math.max(probe, .001);
      const run = THREE.MathUtils.clamp(.15 / Math.max(grade, .1), .28, .95);
      if (total - s < .28 && cells.length) {
        // Spread the short remainder across the flight, rather than doubling
        // its final tread and raising many earlier risers to meet that slab.
        const scale = total / cells.at(-1).end;
        for (const cell of cells) { cell.start *= scale; cell.end *= scale; }
        break;
      }
      cells.push({ start: s, end: Math.min(total, s + run), landing: false }); s += run;
    }
    if (route.id === 'mountain-ascent' && route.kind === 'mountain' && total > 3.1) {
      // The final straight flight serves the south pavilion. Its old 28 cm
      // cells followed each high-side rock peak, producing an up/down notch
      // immediately before the door. Keep the curved mountain route intact,
      // give this short flight usable treads, and finish on a standing landing.
      const first = cells.findIndex(cell => cell.start >= total - 3.1);
      if (first >= 0) {
        const start = cells[first].start, landingStart = total - .85;
        const count = Math.max(1, Math.floor((landingStart - start) / .30));
        const terminal = Array.from({ length: count }, (_, i) => ({
          start: start + (landingStart - start) * i / count,
          end: start + (landingStart - start) * (i + 1) / count,
          landing: false, smoothAscent: true,
        }));
        terminal.push({ start: landingStart, end: total, landing: true, smoothAscent: true });
        cells.splice(first, cells.length - first, ...terminal);
      }
    }
    if (route.id === 'ridge-east' && route.kind === 'mountain' && total > 4) {
      // Give the tight return one continuous standing cap. Separate convex
      // cells overlap at this bend and leave triangular slab lips at the door.
      for (const cell of cells) {
        if (cell.start >= total - 4) cell.smoothAscent = true;
      }
      const first = cells.findIndex(cell => cell.start >= total - 1.124);
      if (first >= 0) cells.splice(first, cells.length - first, {
        start: cells[first].start, end: total, landing: true, levelLanding: true, smoothAscent: true,
        parts: cells.slice(first),
      });
    }
    // Mark short turn landings; merging long rising arcs into a single slab
    // removes usable risers and forces the whole preceding flight upwards.
    for (let i = 1; i < route.points.length - 1; i++) {
      const a = route.points[i - 1], b = route.points[i], c = route.points[i + 1];
      const u = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize(), v = new THREE.Vector2(c.x - b.x, c.z - b.z).normalize();
      if (u.dot(v) > .66 || distance[i] < .7 || distance[i] > total - .7) continue;
      const turn = cells.find(cell => cell.end >= distance[i]);
      if (turn) turn.landing = true;
    }
    const rows = cells.map((cell, index) => {
      const width = route.width, sections = [];
      const samples = Math.max(1, Math.ceil((cell.end - cell.start) / .20));
      for (let i = 0; i <= samples; i++) sections.push(section(cell.start + (cell.end - cell.start) * i / samples));
      const side = (p, sign) => ({ x: p.x - p.dz * width * .5 * sign, z: p.z + p.dx * width * .5 * sign });
      // Side-wall bottoms follow each real grid and diagonal seam as well;
      // spanning a concave terrain fold would leave an open gap underneath.
      let outline = [...sections.map(p => side(p, -1)), ...sections.map(p => side(p, 1)).reverse()], nativeLandingTop;
      if (cell.levelLanding) {
        const pieces = [];
        // The averaged tangent cuts the outside corner of a tight return.
        // Include every real segment's full-width strip in this same landing,
        // with a tiny seam overlap, so an outer foot never meets bare soil.
        for (let i = 1; i < distance.length; i++) {
          const start = Math.max(cell.start, distance[i - 1]), end = Math.min(cell.end, distance[i]);
          if (end < start + .000001) continue;
          const a = at(start), b = at(end), span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span;
          for (const p of [a, b]) for (const sign of [-1, 1]) outline.push({
            x: p.x - dz * (width * .5 + .003) * sign,
            z: p.z + dx * (width * .5 + .003) * sign,
          });
        }
        if (route.id === 'ridge-east') {
          for (const part of cell.parts ?? [cell]) {
            const points = [], count = Math.max(1, Math.ceil((part.end - part.start) / .20));
            for (let i = 0; i <= count; i++) {
              const p = section(part.start + (part.end - part.start) * i / count);
              for (const sign of [-1, 1]) points.push(side(p, sign));
            }
            for (let i = 1; i < distance.length; i++) {
              const start = Math.max(part.start, distance[i - 1]), end = Math.min(part.end, distance[i]);
              if (end < start + .000001) continue;
              const a = at(start), b = at(end), span = Math.hypot(b.x - a.x, b.z - a.z) || 1;
              for (const p of [a, b]) for (const sign of [-1, 1]) points.push({
                x: p.x - (b.z - a.z) / span * (width * .5 + .003) * sign,
                z: p.z + (b.x - a.x) / span * (width * .5 + .003) * sign,
              });
            }
            pieces.push(convexPerimeter(points));
          }
          nativeLandingTop = rowGroundMax(pieces.flatMap(rowTriangles), { heightAtRendered: groundAt }) + .04;
          const site = REST_PAVILION_SITES.find(site => site.id === 'east');
          if (site) {
            const end = site.approach, dx = end.x - site.position.x, dz = end.z - site.position.z;
            const span = Math.hypot(dx, dz), nx = -dz / span, nz = dx / span;
            const run = Math.max(0, span - site.floorSize / 2), tread = run / Math.max(1, Math.round(run / .36));
            // Absorb the lowest door tread into the same stone landing, with
            // its full parallel edge meeting the two remaining rectangular steps.
            const join = [];
            for (const forward of [-tread - .008, .016]) for (const side of [-.548, .548]) join.push({
              x: end.x + dx / span * forward + nx * side,
              z: end.z + dz / span * forward + nz * side,
            });
            pieces.push(convexPerimeter(join));
          }
        }
        outline = pieces.length ? landingPerimeter(pieces, REST_PAVILION_SITES.find(site => site.id === 'east')) : convexPerimeter(outline);
      }
      const footprint = terrainPerimeter(outline);
      const centre = section((cell.start + cell.end) * .5);
      const triangles = rowTriangles(footprint);
      const floor = rowGroundMax(triangles, { heightAtRendered: groundAt }, route.kind === 'cave' ? caveGround?.triangles : undefined);
      const groundMin = Math.min(...footprint.map(p => groundAt(p.x, p.z)));
      const walkLines = [[], [], []], walkingSamples = Math.ceil((cell.end - cell.start) / .02);
      for (let i = 0; i <= walkingSamples; i++) {
        const p = section(cell.start + (cell.end - cell.start) * i / walkingSamples);
        [-.36, 0, .36].forEach((offset, line) => walkLines[line].push({ x: p.x - p.dz * offset, z: p.z + p.dx * offset }));
      }
      const crossRange = Math.max(...sections.map(p => {
        const left = side(p, -1), right = side(p, 1);
        return Math.abs(groundAt(left.x, left.z) - groundAt(right.x, right.z));
      }));
      return { routeId: route.id, start: cell.start, end: cell.end, x: centre.x, z: centre.z, dx: centre.dx, dz: centre.dz,
        width, run: cell.end - cell.start, top: nativeLandingTop === undefined ? floor + .04 : Math.max(nativeLandingTop, floor + .008), groundMin, crossRange,
        landing: cell.landing, smoothAscent: Boolean(cell.smoothAscent), levelLanding: Boolean(cell.levelLanding),
        footprint, triangles, walkLines, index, groundAt, neighbors: [], kind: route.kind,
        colorDraws: cell.parts?.length ?? 1, naturalSkirt: Boolean(cell.smoothAscent),
        startSection: sections[0], endSection: sections.at(-1) };
    });
    if (!rows.length) continue;
    for (let i = 1; i < rows.length; i++) {
      rows[i].neighbors.push({ row: rows[i - 1], limit: rows[i].levelLanding && rows[i - 1].levelLanding ? 0 : MAX_RISER });
      rows[i - 1].neighbors.push({ row: rows[i], limit: rows[i].smoothAscent ? 0 : MAX_RISER });
    }
    paths.push({ route, rows, distance });
  }
  // Branches share a level landing at the same real road-network node.
  for (const path of paths) for (const index of [0, path.route.points.length - 1]) {
    const point = path.route.points[index], own = index ? path.rows.at(-1) : path.rows[0];
    for (const other of paths) {
      if (other === path) continue;
      const match = other.route.points.findIndex(p => Math.hypot(p.x - point.x, p.z - point.z) < .0001);
      if (match < 0) continue;
      const connected = other.rows.find(row => row.end >= other.distance[match]) ?? other.rows.at(-1);
      own.neighbors.push({ row: connected, limit: 0 }); connected.neighbors.push({ row: own, limit: 0 });
      own.landing = connected.landing = true;
    }
  }
  // The least raised envelope above real ground limits every riser, including
  // uneven cross slopes and branch landings, without floating slab undersides.
  const allRows = paths.flatMap(path => path.rows), heap = [];
  coupleOverlappingRows(allRows);
  const push = row => {
    const item = { row, top: row.top }; let i = heap.length; heap.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].top >= item.top) break; heap[i] = heap[p]; i = p; } heap[i] = item;
  };
  for (const row of allRows) push(row);
  while (heap.length) {
    const item = heap[0], tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].top > heap[child].top) child++;
        if (heap[child].top <= tail.top) break; heap[i] = heap[child]; i = child;
      }
      heap[i] = tail;
    }
    if (item.top < item.row.top - .000001) continue;
    for (const edge of item.row.neighbors) if (edge.row.top < item.top - edge.limit - .000001) {
      edge.row.top = item.top - edge.limit; push(edge.row);
    }
  }
  for (const path of paths) for (let i = 0; i < path.rows.length; i++) {
    const row = path.rows[i]; row.rise = i ? Math.abs(row.top - path.rows[i - 1].top) : 0;
    row.role = row.landing ? 'landing' : row.rise >= .119 ? 'stair' : 'platform';
  }
  return allRows;
}

/** Dry-laid stone stairs and foundations, with feet embedded in actual land. */
function mountainStonework(layout, caveFloor) {
  const builders = [{ positions: [], colors: [], uvs: [], count: 0, stairs: 0, rows: [] }, { positions: [], colors: [], uvs: [], count: 0, stairs: 0, rows: [] }];
  const random = seededRandom(715211), color = new THREE.Color(), earthy = new THREE.Color('#918574'), rock = new THREE.Color('#85887b'), sandstone = new THREE.Color('#a59a7f');
  const polygon = [[-.5, -.36], [-.43, .40], [.05, .52], [.50, .29], [.44, -.42], [-.07, -.51]];
  const addStone = (builder, x, z, dx, dz, width, length, beach = false) => {
    const nx = -dz, nz = dx;
    const footprint = polygon.map(([side, forward]) => ({ x: x + nx * side * width + dx * forward * length,
      z: z + nz * side * width + dz * forward * length }));
    const floors = footprint.map(p => layout.heightAtRendered(p.x, p.z));
    if (Math.max(...floors) - Math.min(...floors) > .52 || insideCaveFloor(x, z)) return;
    const top = Math.max(...floors) + .05;
    const bottom = footprint.map((p, i) => ({ ...p, y: floors[i] - .06 }));
    const bevel = footprint.map(p => ({ ...p, y: top - .035 }));
    const rim = footprint.map(p => ({ x: x + (p.x - x) * .83, z: z + (p.z - z) * .83,
      y: top + (random() - .5) * .016 }));
    color.copy(rock).lerp(earthy, random() * .65).multiplyScalar(.90 + random() * .19);
    if (beach) color.lerp(sandstone, (1 - THREE.MathUtils.smoothstep(top, .7, 5)) * .55);
    const face = (a, b, c, shade = 1) => {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-8) return;
      for (const p of [a, c, b]) {
        builder.positions.push(p.x, p.y, p.z); builder.uvs.push(p.x / 2.8, p.z / 2.8);
        builder.colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
    };
    const center = { x, z, y: top + .003 };
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      // The side/forward basis reverses winding; face() keeps the tread upward.
      face(center, rim[i], rim[j]);
      face(rim[i], bevel[i], bevel[j], .94); face(rim[i], bevel[j], rim[j], .94);
      face(bevel[i], bottom[i], bottom[j], .86); face(bevel[i], bottom[j], bevel[j], .86);
    }
    builder.count++;
    if (builder === builders[0]) builder.stairs++;
  };
  const walkingRows = walkableMountainRows(layout.routes, layout, caveWalkingGround(caveFloor, layout.heightAtRendered));
  for (const row of walkingRows) {
    const builder = builders[0];
    color.copy(rock).lerp(earthy, random() * .55).multiplyScalar(.92 + random() * .16);
    // Merging terminal caps must not reroll stones and colors elsewhere.
    for (let i = 1; i < row.colorDraws; i++) { random(); random(); }
    if (row.kind === 'beach') color.lerp(sandstone, (1 - THREE.MathUtils.smoothstep(row.top, .7, 5)) * .55);
    const bottom = row.footprint.map(p => ({ ...p, y: row.groundAt(p.x, p.z) - .06 }));
    const top = row.footprint.map(p => ({ ...p, y: row.top }));
    const face = (a, b, c, shade = 1) => {
      const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const order = shade === 1 && crossY > 0 ? [a, b, c] : [a, c, b];
      for (const p of order) {
        builder.positions.push(p.x, p.y, p.z); builder.uvs.push(p.x / 2.8, p.z / 2.8);
        builder.colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
    };
    for (const triangle of row.triangles) face(...triangle.map(p => ({ ...p, y: row.top })));
    if (row.naturalSkirt) {
      const onEnd = (a, b, p) => Math.abs((a.x - p.x) * p.dx + (a.z - p.z) * p.dz) < .00001
        && Math.abs((b.x - p.x) * p.dx + (b.z - p.z) * p.dz) < .00001;
      const edgeFloor = p => {
        let floor = -Infinity;
        for (const { row: other } of row.neighbors) {
          if (p.x < other.bounds.left - .00001 || p.x > other.bounds.right + .00001
            || p.z < other.bounds.bottom - .00001 || p.z > other.bounds.top + .00001) continue;
          if (other.triangles.some(t => {
            const direction = Math.sign(area(...t));
            return t.every((a, i) => area(a, t[(i + 1) % 3], p) * direction >= -.00001);
          })) floor = Math.max(floor, other.top);
        }
        return floor > -Infinity ? floor : undefined;
      };
      appendTerracedStoneSkirt(row.footprint, row.top, row.groundAt, face, { edgeFloor,
        edgeOutset: (a, b) => !onEnd(a, b, row.startSection) && !onEnd(a, b, row.endSection),
        maxOutset: row.routeId === 'ridge-east' && row.role === 'landing' ? .8 : .16 });
    } else for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      face(top[i], bottom[i], bottom[j], .87); face(top[i], bottom[j], top[j], .87);
    }
    builder.count++; if (row.role === 'stair') builder.stairs++;
    builder.rows.push({ routeId: row.routeId, x: row.x, z: row.z, dx: row.dx, dz: row.dz,
      start: row.start, end: row.end, run: row.run, width: row.width, top: row.top, rise: row.rise, role: row.role,
      baseHeight: row.top - row.groundMin, centerLift: row.top - row.groundAt(row.x, row.z), crossRange: row.crossRange });
  }
  for (const route of layout.routes) {
    if (route.kind === 'coastal') continue;
    let stepGap = 0, supportGap = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span < .0001) continue;
      const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span, x = (a.x + b.x) * .5, z = (a.z + b.z) * .5;
      const grade = Math.abs(b.y - a.y) / span;
      supportGap += span;
      const stairway = Boolean(route.forceSteps);
      const stepRow = (sx, sz, tread) => {
        if (insideCaveFloor(sx, sz)) return;
        const pieces = 3, width = route.width * (.79 + random() * .08) / pieces;
        for (let j = 0; j < pieces; j++) {
          const offset = (j - 1) * width * 1.04;
          addStone(builders[0], sx - dz * offset, sz + dx * offset, dx, dz, width, tread, route.kind === 'beach');
        }
      };
      if (route.kind === 'mountain' || stairway) {
        // Its complete flight and turn landings were generated above.
      } else {
        stepGap += span;
        if (grade > .35 && stepGap > (grade > .85 ? .72 : 1.6)) {
          stepGap = 0;
          stepRow(x, z, .27 + random() * .08);
        }
      }
      if (supportGap > 2.6) {
        const offset = route.width * .5 + .19;
        const left = layout.heightAtRendered(x - dz * offset, z + dx * offset);
        const right = layout.heightAtRendered(x + dz * offset, z - dx * offset);
        if (Math.abs(left - right) > .35) {
          supportGap = 0;
          const side = left < right ? 1 : -1;
          for (const forward of [-.33, .32]) addStone(builders[1], x - dz * offset * side + dx * forward,
            z + dx * offset * side + dz * forward, dx, dz, .37 + random() * .07, .57 + random() * .08);
        }
      }
    }
  }
  return builders.map(builder => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(builder.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
    geometry.userData.rows = builder.rows;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return { geometry, count: builder.count, stairs: builder.stairs, platforms: builder.rows.filter(row => row.role !== 'stair').length };
  });
}

function gravelTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const value = Math.round(216 + hash(x, z) * 38), at = (z * size + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = value; pixels[at + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
}

function colored(geometry, value) {
  const color = new THREE.Color(value), colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return geometry;
}

function grassGeometry() {
  const random = seededRandom(13091), positions = [], colors = [], indices = [], flex = [];
  for (let blade = 0; blade < 9; blade++) {
    const angle = random() * Math.PI * 2, height = .19 + random() * .23;
    const x = (random() - .5) * .27, z = (random() - .5) * .27, base = positions.length / 3;
    for (let segment = 0; segment <= 3; segment++) for (const side of [-1, 1]) {
      const t = segment / 3, width = .018 * (1 - t), bend = t * t * .17;
      positions.push(x + Math.cos(angle) * bend + Math.sin(angle) * width * side, height * t,
        z + Math.sin(angle) * bend - Math.cos(angle) * width * side);
      colors.push(.25 + t * .12, .37 + t * .12, .14 + t * .07);
      flex.push(getVegetationFlex('ground', t));
    }
    for (let i = 0; i < 3; i++) { const at = base + i * 2; indices.push(at, at + 1, at + 3, at, at + 3, at + 2); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); return geometry;
}

function flowerGeometry() {
  const parts = [], random = seededRandom(27031);
  for (let stem = 0; stem < 3; stem++) {
    const x = (random() - .5) * .24, z = (random() - .5) * .24, y = .24 + random() * .14;
    const stalk = colored(new THREE.CylinderGeometry(.008, .013, y, 4, 4), '#718447');
    stalk.translate(x, y * .5, z); parts.push(stalk);
    const center = colored(new THREE.SphereGeometry(.025, 5, 3), '#d4ac42'); center.translate(x, y, z); parts.push(center);
    for (let petal = 0; petal < 5; petal++) {
      const angle = petal / 5 * Math.PI * 2;
      const shape = colored(new THREE.CircleGeometry(.045, 6), stem === 1 ? '#e9c0cc' : '#eee5c1');
      shape.rotateX(-Math.PI / 2); shape.scale(.72, 1, 1.15); shape.rotateY(angle);
      shape.translate(x + Math.sin(angle) * .034, y, z + Math.cos(angle) * .034); parts.push(shape);
    }
  }
  const geometry = mergeGeometries(parts); for (const part of parts) part.dispose();
  const p = geometry.attributes.position, flex = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) flex[i] = getVegetationFlex('ground', p.getY(i) / .24);
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  return geometry;
}

function insideCaveFloor(x, z) {
  const local = caveToLocal({ x, y: CAVE_LAYOUT.entrance.y, z });
  return Math.abs(local.side) <= 5.2 && local.forward >= -CAVE_LAYOUT.depth - .8 && local.forward <= 3.2;
}

function decorations(layout, heightAt) {
  const random = seededRandom(105771), grass = [], flowers = [], pebbles = [];
  for (const route of layout.routes) {
    let gap = 0;
    for (let index = 1; index < route.points.length; index++) {
      const a = route.points[index - 1], b = route.points[index], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      gap += length; if (gap < 1.8) continue; gap -= 1.8;
      for (const side of [-1, 1]) {
        const offset = route.width * .5 + .40 + random() * 1.25;
        const x = b.x - dz / length * offset * side, z = b.z + dx / length * offset * side;
        if (insideCaveFloor(x, z) || layout.distanceAt(x, z) < .10 || heightAt(x, z) < .8) continue;
        const point = { x, z, y: layout.heightAtRendered(x, z), scale: .70 + random() * .6, angle: random() * Math.PI * 2 };
        if (random() < .8) grass.push(point);
        if (random() < .34) {
          const flowerX = x + .06, flowerZ = z - .06;
          if (!insideCaveFloor(flowerX, flowerZ) && layout.distanceAt(flowerX, flowerZ) >= .10) {
            flowers.push({ ...point, x: flowerX, z: flowerZ, y: layout.heightAtRendered(flowerX, flowerZ) });
          }
        }
        if (random() < .88) pebbles.push({ ...point, scale: .065 + random() * .115, tone: random() });
      }
    }
  }
  return { grass, flowers, pebbles };
}

/** One merged road plus reusable instanced border plants and loose gravel. */
export function createIslandPaths(parent, { heightAt = terrainHeight, layout = getIslandPathLayout({ heightAt }), windUniforms } = {}) {
  const group = new THREE.Group(); group.name = '环岛小路与山间步道'; parent.add(group);
  const geometries = new Set(), materials = new Set(), textures = new Set(), instances = [];
  const snow = { value: 0 };
  const localWind = windUniforms ? null : createVegetationWindState();
  const plantUniforms = windUniforms ?? { uTime: { value: 0 }, uWindDirection: { value: new THREE.Vector2() },
    uPlantAmplitudes: { value: new THREE.Vector3() }, uLeafFlutter: { value: 0 } };
  const plantMaterial = roughness => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness });
    material.onBeforeCompile = shader => configureVegetationWindShader(shader, plantUniforms, 'road');
    material.customProgramCacheKey = () => 'island-path-plant-wind-v1-road';
    return material;
  };
  const plantDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  plantDepth.onBeforeCompile = shader => configureVegetationWindShader(shader, plantUniforms, 'road');
  plantDepth.customProgramCacheKey = () => 'island-path-plant-depth-v1-road'; materials.add(plantDepth);
  const grain = gravelTexture(); textures.add(grain);
  const roadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain,
    bumpScale: .026, roughness: .97, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  configurePathMaterial(roadMaterial, snow, true);
  materials.add(roadMaterial);
  const road = new THREE.Mesh(roadGeometry(layout), roadMaterial); road.name = '环岛沙土与登山小径';
  road.renderOrder = 2;
  geometries.add(road.geometry); road.receiveShadow = true; group.add(road);
  const stonework = mountainStonework(layout, parent.getObjectByName('洞穴坡口与地面'));
  const stoneMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain,
    bumpScale: .045, roughness: .98 });
  configurePathMaterial(stoneMaterial, snow, false); materials.add(stoneMaterial);
  stonework.forEach((item, index) => {
    geometries.add(item.geometry);
    if (!item.count) return;
    const mesh = new THREE.Mesh(item.geometry, stoneMaterial);
    mesh.name = index === 0 ? '山径天然石阶' : '山径下坡侧低矮护基';
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  });
  const planting = decorations(layout, heightAt), dummy = new THREE.Object3D(), color = new THREE.Color();
  const instanced = (geometry, material, points, name, pebble = false) => {
    geometries.add(geometry); materials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, points.length); mesh.name = name; mesh.receiveShadow = true;
    mesh.userData.pathFullCount = points.length;
    for (let index = 0; index < points.length; index++) {
      const point = points[index]; dummy.position.set(point.x, point.y + (pebble ? point.scale * .27 : -.015), point.z);
      dummy.rotation.set(pebble ? .18 : 0, point.angle, pebble ? -.12 : 0);
      dummy.scale.set(point.scale * (pebble ? 1.4 : 1), point.scale * (pebble ? .58 : 1), point.scale);
      dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
      if (pebble) { color.setHex(0xa99f85).lerp(new THREE.Color(0xc7bca6), point.tone); mesh.setColorAt(index, color); }
    }
    group.add(mesh); instances.push(mesh); return mesh;
  };
  const grass = instanced(grassGeometry(), plantMaterial(.94), planting.grass, '路旁低矮草簇');
  const flowers = instanced(flowerGeometry(), plantMaterial(.91), planting.flowers, '路旁细小野花');
  grass.customDepthMaterial = flowers.customDepthMaterial = plantDepth;
  const pebbles = instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96 }), planting.pebbles, '路旁零散碎石', true);
  let disposed = false;
  function update(time, env = {}) {
    if (disposed) return;
    if (localWind) {
      advanceVegetationWind(localWind, time, env);
      plantUniforms.uTime.value = localWind.time;
      plantUniforms.uWindDirection.value.fromArray(localWind.direction);
      plantUniforms.uPlantAmplitudes.value.fromArray(localWind.amplitudes);
      plantUniforms.uLeafFlutter.value = localWind.flutter;
    }
    const season = ['spring', 'summer', 'autumn', 'winter'].indexOf(env.season ?? 'summer');
    const index = Number.isFinite(env.seasonIndex) ? THREE.MathUtils.clamp(Math.round(env.seasonIndex), 0, 3) : Math.max(0, season);
    const quality = env.quality === 'low' ? .5 : env.quality === 'medium' ? .75 : 1;
    snow.value = THREE.MathUtils.clamp(Math.max(Number.isFinite(env.snow) ? env.snow : 0, index === 3 ? .65 : 0), 0, 1);
    flowers.count = Math.floor(planting.flowers.length * [1, .80, .26, 0][index] * quality);
    flowers.visible = flowers.count > 0;
    grass.count = Math.floor(planting.grass.length * quality); pebbles.count = Math.floor(planting.pebbles.length * quality);
    grass.material.color.setHex(index === 2 ? 0xc5bc8f : index === 3 ? 0xc4cac1 : 0xffffff);
  }
  function dispose() {
    if (disposed) return; disposed = true; parent.remove(group);
    for (const mesh of instances) mesh.dispose();
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose(); group.clear();
  }
  const counts = { routes: layout.routes.length, roadVertices: road.geometry.attributes.position.count,
    roadTriangles: road.geometry.attributes.position.count / 3, steps: stonework[0].stairs,
    platforms: stonework[0].platforms, supports: stonework[1].count,
    grass: planting.grass.length, flowers: planting.flowers.length, pebbles: planting.pebbles.length };
  update(0); return { group, update, dispose, counts };
}
