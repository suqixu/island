import {createSnowRoofShell} from './snow-layers.js';
import {WEATHER_CONFIG} from '../runtime-config.js';
import {attachSnowSurface,getSnowCover} from '../snow-surface.js';
import * as THREE from 'three';
import { getAnimationDelta } from '../animation-time.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { appendTerracedStoneSkirt, smoothStoneSurfaceNormals } from './island-paths.js';
import { createStructureSurfaceState, attachStructureSurface } from '../structure-surfaces.js';

const FLOOR_HALF = 1.60;
const ROOF_HALF = 1.96;
const EMBED = .095;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const safeCover = value => Number.isFinite(value) ? clamp(value, 0, 1) : 0;

export function getRestPavilionLampStrength(daylight) {
  if (!Number.isFinite(daylight)) return 0;
  const t = clamp((.36 - daylight) / .305, 0, 1);
  return t * t * (3 - 2 * t);
}


function surfaceBuilder() {
  const positions = [], indices = [];
  return {
    quad(a, b, c, d) {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c, ...d); indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    },
    triangle(a, b, c) {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c); indices.push(i, i + 1, i + 2);
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
    },
  };
}

function mergeParts(parts) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

function beamBetween(start, end, radius = .055) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const geometry = new THREE.CylinderGeometry(radius * .90, radius, direction.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
}

function agedMaterial(color, stone = false) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: stone ? .97 : .93, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vPavilionSurface;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPavilionSurface = position;');
    shader.fragmentShader = `varying vec3 vPavilionSurface;
      float pavilionGrain(vec3 p) { return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719)))*43758.5453); }
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p=vPavilionSurface;
      float grain=pavilionGrain(p*vec3(${stone ? '43.0,43.0,43.0' : '54.0,3.0,54.0'}));
      float broad=pavilionGrain(p*vec3(5.0,1.4,5.0));
      diffuseColor.rgb *= 0.88+grain*0.10+broad*0.06;
      ${stone ? `vec2 joints=abs(fract(p.xz/0.47)-0.5);
        float seam=smoothstep(0.478,0.497,max(joints.x,joints.y));
        diffuseColor.rgb*=1.0-seam*0.15;` : `float grainLine=pow(0.5+0.5*sin((p.x+p.z)*235.0+broad*8.0),8.0);
        diffuseColor.rgb*=1.0-grainLine*0.13;`}
      `);
  };
  material.customProgramCacheKey = () => stone ? 'pavilion-stone-1' : 'pavilion-timber-1';
  return material;
}

const roofHeight = radius => 3.49 - 1.01 * Math.pow(radius, .66) + .31 * Math.pow(radius, 9);
const roofEdges = [[[-ROOF_HALF, ROOF_HALF], [ROOF_HALF, ROOF_HALF]],
  [[ROOF_HALF, ROOF_HALF], [ROOF_HALF, -ROOF_HALF]],
  [[ROOF_HALF, -ROOF_HALF], [-ROOF_HALF, -ROOF_HALF]],
  [[-ROOF_HALF, -ROOF_HALF], [-ROOF_HALF, ROOF_HALF]]];
const roofPoint = (edge, t, r, lift = 0) => [
  (edge[0][0] + (edge[1][0] - edge[0][0]) * t) * r,
  roofHeight(r) + .36 * Math.pow(r, 9) * Math.pow(Math.abs(t * 2 - 1), 5) + lift,
  (edge[0][1] + (edge[1][1] - edge[0][1]) * t) * r,
];

function roofGeometry() {
  const surface = surfaceBuilder();
  for (const edge of roofEdges) for (let ring = 0; ring < 16; ring++) {
    const low = ring / 16, high = (ring + 1) / 16;
    for (let i = 0; i < 20; i++) {
      const a = i / 20, b = (i + 1) / 20;
      if (!ring) surface.triangle(roofPoint(edge, a, 0), roofPoint(edge, a, high), roofPoint(edge, b, high));
      else surface.quad(roofPoint(edge, a, low), roofPoint(edge, a, high), roofPoint(edge, b, high), roofPoint(edge, b, low));
    }
  }
  return surface.finish();
}

function roofTiles() {
  const parts = [];
  for (const edge of roofEdges) {
    for (let i = 1; i < 19; i++) {
      const points = [];
      for (let j = 2; j <= 16; j++) points.push(new THREE.Vector3(...roofPoint(edge, i / 19, j / 16, .012)));
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 18, .014, 4, false));
    }
    const hip = [];
    for (let i = 0; i <= 16; i++) hip.push(new THREE.Vector3(...roofPoint(edge, 0, i / 16, .025)));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hip), 20, .04, 6, false));
  }
  return mergeParts(parts);
}

function createPavilionChimes(group, add, site, roof) {
  const scale = .63;
  const copper = Array.from({ length: 4 }, (_, index) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xb39152).offsetHSL((index - 1.5) * .006, 0, (index - 1.5) * .007),
    metalness: .72, roughness: .38, side: THREE.DoubleSide,
  }));
  const cord = new THREE.MeshStandardMaterial({ color: 0x6e5f40, roughness: .95 });
  const tongueMaterial = new THREE.MeshStandardMaterial({ color: 0x695133, roughness: .75 });
  const sailMaterial = agedMaterial(0xb88f58);
  const profile = [[.124, -.085], [.124, -.075], [.112, -.03], [.083, .075], [.043, .115], [.014, .13]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  // Four bells reuse each shape, including merged copper lips and hanging cords.
  const shapes = {
    hook: new THREE.TorusGeometry(.026, .006, 6, 12),
    suspension: new THREE.CylinderGeometry(.005, .005, .145, 5),
    bell: mergeParts([new THREE.LatheGeometry(profile, 16),
      new THREE.TorusGeometry(.123, .006, 6, 16).rotateX(Math.PI / 2).translate(0, -.080, 0)]),
    cords: mergeParts([new THREE.CylinderGeometry(.0035, .0035, .112, 5).translate(0, -.056, 0),
      new THREE.CylinderGeometry(.003, .003, .19, 5).translate(0, -.215, 0)]),
    tongue: new THREE.SphereGeometry(.027, 8, 6),
    sail: new THREE.BoxGeometry(.11, .24, .007),
  };
  const attach = (name, geometry, material, parent, y = 0) => {
    const mesh = add(name, geometry, material); mesh.position.y = y; parent.add(mesh); return mesh;
  };
  const mountingRay = new THREE.Raycaster(), mountDirection = new THREE.Vector3(0, -1, 0);
  group.updateWorldMatrix(true, true);
  mountDirection.transformDirection(group.matrixWorld);
  const bells = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz], index) => {
    const x = sx * 1.70, z = sz * 1.70;
    mountingRay.set(group.localToWorld(new THREE.Vector3(x, 6, z)), mountDirection);
    const hit = mountingRay.intersectObject(roof, false)[0];
    const tileHeight = hit ? group.worldToLocal(hit.point).y
      : roofHeight(1.70 / ROOF_HALF) + .36 * Math.pow(1.70 / ROOF_HALF, 9);
    const anchor = new THREE.Group(); anchor.name = '山亭风铃根吊点';
    // Embed the highest hook point by 3 mm into the actual triangle surface.
    anchor.position.set(x, tileHeight - .048 * scale + .003, z); anchor.scale.setScalar(scale);
    anchor.userData.bellIndex = index; group.add(anchor);
    const swing = new THREE.Group(); swing.name = '山亭风铃摆轴'; anchor.add(swing);
    const tonguePivot = new THREE.Group(); tonguePivot.position.y = -.22; swing.add(tonguePivot);
    attach('山亭风铃檐下铜扣', shapes.hook, copper[index], anchor, .016);
    attach('山亭风铃细吊绳', shapes.suspension, cord, swing, -.0725);
    const bell = attach('山亭小铜风铃', shapes.bell, copper[index], swing, -.25);
    bell.userData.bellIndex = index;
    const mouth = new THREE.Object3D(); mouth.name = '山亭风铃铃口'; mouth.position.y = -.335;
    mouth.userData.bellIndex = index; swing.add(mouth);
    attach('山亭风铃舌绳', shapes.cords, cord, tonguePivot);
    attach('山亭风铃悬舌', shapes.tongue, tongueMaterial, tonguePivot, -.112);
    const sail = attach('山亭风铃风帆', shapes.sail, sailMaterial, tonguePivot, -.415);
    const noise = Math.sin(site.x * 12.9898 + site.z * 78.233 + index * 173.119) * 43758.5453;
    const fraction = noise - Math.floor(noise), seed = Math.floor(fraction * 0x7fffffff);
    return { swing, tonguePivot, sail, mouth, fraction, seed, phase: fraction * Math.PI * 2 + index * .63,
      previousSwing: 0, lastStrike: -Infinity, count: 0, crossing: false };
  });
  const orientation = new THREE.Quaternion(), localWind = new THREE.Vector3(), worldMouth = new THREE.Vector3();
  let strength = 0, gust = 0, windAngle = 0, lastChime = -Infinity, lastBell = -1;
  return {
    update(delta, time, environment, onChime) {
      const dt = getAnimationDelta(delta, .25, environment), blend = 1 - Math.exp(-dt * 1.5);
      const speed = Number.isFinite(environment.windSpeed) ? clamp(environment.windSpeed, 0, 22)
        : Number.isFinite(environment.wind) ? 1.5 + safeCover(environment.wind) * 19.5 : 0;
      const targetGust = safeCover(environment.gust);
      const targetStrength = Math.pow(clamp(speed / 20, 0, 1), .8) * (.78 + .22 * targetGust);
      strength += (targetStrength - strength) * blend; gust += (targetGust - gust) * blend;
      const direction = environment.windDirection;
      const dx = Array.isArray(direction) ? direction[0] : direction?.x;
      const dz = Array.isArray(direction) ? direction[1] : direction?.z;
      if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 1e-5) {
        const target = Math.atan2(dz, dx), turn = Math.atan2(Math.sin(target - windAngle), Math.cos(target - windAngle));
        windAngle += turn * (1 - Math.exp(-dt * 2.2));
      }
      group.getWorldQuaternion(orientation).invert();
      localWind.set(Math.cos(windAngle), 0, Math.sin(windAngle)).applyQuaternion(orientation);
      for (let index = 0; index < bells.length; index++) {
        const bell = bells[index], { fraction } = bell;
        bell.phase += dt * (2.08 + strength * .50 + gust * .18) * (.95 + index * .035 + fraction * .02);
        const phase = bell.phase;
        const wave = .83 * Math.sin(phase) + .14 * Math.sin(phase * 1.71 + fraction * 11)
          + .08 * Math.sin(phase * .49 + fraction * 7);
        const angle = wave * strength * (.29 + gust * .028) * (.90 + fraction * .10);
        bell.swing.rotation.set(-localWind.z * angle, Math.sin(phase * .61) * strength * gust * .055, localWind.x * angle);
        const lag = Math.sin(phase + .85) * strength * .22;
        bell.tonguePivot.rotation.set(localWind.z * lag, 0, -localWind.x * lag);
        bell.sail.rotation.z = Math.sin(phase * 2.13 + fraction * 9) * strength * (.075 + gust * .08);
        bell.crossing = bell.previousSwing * angle < 0 && strength > .13 && time - bell.lastStrike >= 1.55 + fraction * .25;
        if (bell.crossing) bell.lastStrike = time;
        bell.previousSwing = angle;
      }
      // Real swing crossings are independently spaced; a pavilion-wide budget prevents stacked notes.
      if (time - lastChime < .65) return;
      for (let step = 1; step <= bells.length; step++) {
        const index = (lastBell + step) % bells.length, bell = bells[index];
        if (!bell.crossing) continue;
        lastChime = time; lastBell = index;
        if (typeof onChime === 'function') {
          bell.mouth.getWorldPosition(worldMouth);
          onChime({ position: worldMouth.clone(), strength: clamp(strength * (.65 + .35 * Math.abs(Math.cos(bell.phase))), .04, 1),
            variant: (bell.seed + bell.count * 2) % 5, time, seed: bell.seed, bellIndex: index });
        }
        bell.count++; break;
      }
    },
  };
}

function stairGeometry(corners, groundAt, top, floorTop, naturalSkirt) {
  const surface = surfaceBuilder();
  const upper = corners.map(point => [point.x, top - floorTop, point.z]);
  surface.quad(...upper);
  if (naturalSkirt) {
    const { previous, next, axis } = naturalSkirt;
    const along = p => p.x * axis.x + p.z * axis.z;
    const first = Math.min(...corners.map(along)), last = Math.max(...corners.map(along));
    const emit = (a, b, c, shade) => {
      const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      const points = shade === 1 && crossY > 0 ? [a, b, c] : [a, c, b];
      surface.triangle(...points.map(p => [p.x, p.y - floorTop, p.z]));
    };
    appendTerracedStoneSkirt(corners, top, groundAt, emit, {
      edgeFloor: p => Math.abs(along(p) - first) < .00001 ? previous : Math.abs(along(p) - last) < .00001 ? next : undefined,
      edgeOutset: (a, b) => Math.abs(along(a) - along(b)) > .00001,
    });
    return smoothStoneSurfaceNormals(surface.finish());
  }
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4];
    // Dense outer edges follow the real terrain, including triangle seams.
    for (let i = 0; i < 8; i++) {
      const t = i / 8, u = (i + 1) / 8;
      const point = s => ({ x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s });
      const pa = point(t), pb = point(u);
      surface.quad([pa.x, Math.min(groundAt(pa.x, pa.z) - EMBED, top - .09) - floorTop, pa.z],
        [pb.x, Math.min(groundAt(pb.x, pb.z) - EMBED, top - .09) - floorTop, pb.z],
        [pb.x, top - floorTop, pb.z], [pa.x, top - floorTop, pa.z]);
    }
  }
  return smoothStoneSurfaceNormals(surface.finish());
}

function colorPathStone(geometry, source, position, sin, cos, approach) {
  const p = source.geometry.attributes.position, c = source.geometry.attributes.color, n = source.geometry.attributes.normal;
  const point = new THREE.Vector3(), reference = new THREE.Color('#85887b');
  source.updateWorldMatrix(true, false);
  let nearest = Infinity;
  if (c) for (let i = 0; i < p.count; i++) {
    if (n && n.getY(i) < .9) continue;
    point.fromBufferAttribute(p, i).applyMatrix4(source.matrixWorld);
    const distance = (point.x - approach.x) ** 2 + (point.z - approach.z) ** 2;
    if (distance >= nearest) continue;
    nearest = distance; reference.setRGB(c.getX(i), c.getY(i), c.getZ(i));
  }
  const vertices = geometry.attributes.position, normals = geometry.attributes.normal;
  const colors = new Float32Array(vertices.count * 3), uvs = new Float32Array(vertices.count * 2);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i), shade = normals.getY(i) > .9 ? 1 : .87;
    colors.set([reference.r * shade, reference.g * shade, reference.b * shade], i * 3);
    uvs[i * 2] = (position.x + x * cos + z * sin) / 2.8;
    uvs[i * 2 + 1] = (position.z - x * sin + z * cos) / 2.8;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

function approachSteps(groundAt, floorTop, approach, floorHalf, entryLanding = false) {
  if (!approach) return [];
  const dx = approach.x, dz = approach.z - floorHalf;
  const distance = Math.hypot(dx, dz);
  const end = Number.isFinite(approach.y) ? approach.y : groundAt(approach.x, approach.z) + .038;
  if (distance < .025) return Math.abs(end - floorTop) <= .19 ? [] : null;
  const minimum = Math.max(1, Math.ceil(Math.abs(end - floorTop) / .19));
  // Pick among feasible riser/tread counts; a short low landing can be a single step.
  const maximum = Math.max(1, Math.floor(distance / .28));
  if (minimum > maximum) return null;
  const count = clamp(Math.round(distance / .36), minimum, maximum);
  const halfWidth = entryLanding ? .548 : .54;
  const sx = -dz / distance * halfWidth, sz = dx / distance * halfWidth;
  const steps = []; let landingGround = -Infinity;
  for (let i = 0; i < count; i++) {
    const point = t => ({ x: dx * t, z: floorHalf + dz * t });
    const a = point(i / count), b = point((i + 1) / count);
    // A tiny closing overlap keeps Float32 end caps sealed at the real path joint.
    if (i === count - 1) { b.x += dx / distance * .008; b.z += dz / distance * .008; }
    const corners = [{ x: a.x + sx, z: a.z + sz }, { x: b.x + sx, z: b.z + sz },
      { x: b.x - sx, z: b.z - sz }, { x: a.x - sx, z: a.z - sz }];
    let highest = -Infinity, lowest = Infinity;
    for (let row = 0; row <= 6; row++) for (let col = 0; col <= 6; col++) {
      const t = row / 6, s = col / 6 * 2 - 1;
      const ground = groundAt(a.x + (b.x - a.x) * t + sx * s, a.z + (b.z - a.z) * t + sz * s);
      highest = Math.max(highest, ground); lowest = Math.min(lowest, ground);
    }
    // A pre-existing full-width standing landing already supplies this tread.
    // Adding a lifted copy would leave a thin, diagonal lip on its top face.
    if (i === count - 1 && Math.abs(highest - end) < .002 && Math.abs(lowest - end) < .002
      && (steps.length ? Math.abs(steps.at(-1).top - end) <= .12 : Math.abs(floorTop - end) <= .19)) continue;
    landingGround = Math.max(landingGround, highest + .038);
    steps.push({ corners, top: Math.max(floorTop + (end - floorTop) * (i + 1) / count, highest + .038) });
  }
  if (entryLanding && minimum === 1 && steps.length > 1) {
    const first = steps[0], last = steps.at(-1);
    // The existing path supplies the lower section; merge only the missing
    // entrance footprint, so its landing is not covered with another thin slab.
    steps.splice(0, steps.length, { corners: [first.corners[0], last.corners[1], last.corners[2], first.corners[3]],
      top: Math.max(end, landingGround) });
  }
  const actualCount = steps.length;
  if (!actualCount) return [];
  if (end >= floorTop) {
    for (let i = 1; i < actualCount; i++) steps[i].top = Math.max(steps[i].top, steps[i - 1].top);
    for (let i = actualCount - 2; i >= 0; i--) steps[i].top = Math.max(steps[i].top, steps[i + 1].top - .19);
  } else {
    for (let i = actualCount - 2; i >= 0; i--) steps[i].top = Math.max(steps[i].top, steps[i + 1].top);
    for (let i = 1; i < actualCount; i++) steps[i].top = Math.max(steps[i].top, steps[i - 1].top - .19);
  }
  if (Math.abs(steps[0].top - floorTop) > .20 || Math.abs(steps.at(-1).top - end) > .12) return null;
  return steps;
}

/**
 * position/approach use world coordinates. A supplied approach that cannot be
 * reached with ordinary risers throws before the model owns GPU resources.
 * group.userData exposes floorTop, floorSize, entranceWorld, entryClearWidth,
 * and approachTop so the caller can compare the actual path/landing surfaces.
 * stoneSurface may reference the actual mountain-stair Mesh. Its material and
 * textures remain owned by the path; all entrance treads then share one Mesh.
 * Assign api.onChime to receive { position: Vector3 world snapshot at the bell
 * mouth, strength: 0..1, variant: 0..4, time: real seconds, seed: stable integer, bellIndex: 0..3 }.
 * Bell motion follows update's real time, independently of the simulated sky clock.
 */
export function createRestPavilion(scene, { heightAt, position, entranceDirection = { x: 0, z: 1 }, approach, floorSize = 3.2,
  stoneSurface = scene?.getObjectByName('山径天然石阶'), entryLanding = false, snowSurface } = {}) {
  if (typeof heightAt !== 'function' || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) {
    throw new TypeError('木亭需要真实地形采样函数与有限的 x/z 坐标');
  }
  const angle = Number.isFinite(entranceDirection.x) && Number.isFinite(entranceDirection.z)
    ? Math.atan2(entranceDirection.x, entranceDirection.z) : 0;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const floorHalf = Number.isFinite(floorSize) ? clamp(floorSize / 2, 1, FLOOR_HALF) : FLOOR_HALF;
  const groundAt = (x, z) => heightAt(position.x + x * cos + z * sin, position.z - x * sin + z * cos);
  let highest = -Infinity;
  for (let x = 0; x <= 24; x++) for (let z = 0; z <= 24; z++) {
    highest = Math.max(highest, groundAt(-floorHalf + x / 24 * floorHalf * 2, -floorHalf + z / 24 * floorHalf * 2));
  }
  if (!Number.isFinite(highest)) throw new TypeError('木亭地形采样必须返回有限高度');
  const floorTop = highest + .11;
  let localApproach;
  if (approach != null) {
    if (!Number.isFinite(approach.x) || !Number.isFinite(approach.z)) throw new TypeError('木亭入口进路坐标必须有限');
    const dx = approach.x - position.x, dz = approach.z - position.z;
    localApproach = { x: dx * cos - dz * sin, z: dx * sin + dz * cos, y: approach.y };
  }
  // Plan before owning GPU resources or attaching anything to the caller's scene.
  const steps = approachSteps(groundAt, floorTop, localApproach, floorHalf, entryLanding);
  if (steps === null) throw new RangeError('木亭入口无法以正常步高和踏深衔接指定山路');
  const group = new THREE.Group(); group.name = '山路休息木亭';
  group.position.set(position.x, floorTop, position.z); group.rotation.y = angle;
  const sharedStone = stoneSurface?.isMesh && !Array.isArray(stoneSurface.material) ? stoneSurface.material : null;
  // Both pavilions borrow the same scene-owned wood and ceramic maps.
  const woodSurface = createStructureSurfaceState({ownsMaps:false}), roofSurface = createStructureSurfaceState({ownsMaps:false});
  const paintedWood = color => attachStructureSurface(agedMaterial(color), woodSurface, {painted:true,local:true});
  const stone = steps.length ? sharedStone ?? agedMaterial(0x85887b, true) : null, timber = paintedWood(0x9b4438);
  const darkTimber = paintedWood(0x71342c), deckTimber = attachStructureSurface(agedMaterial(0x76513a),woodSurface,{local:true});
  const roofMaterial = attachStructureSurface(new THREE.MeshStandardMaterial({color:0x424b49,roughness:.97,side:THREE.DoubleSide}),roofSurface,{ceramic:true,local:true});
  const tileRim = attachStructureSurface(new THREE.MeshStandardMaterial({ color: 0x515a57, roughness: .93 }),roofSurface,{ceramic:true,local:true});
  const iron = new THREE.MeshStandardMaterial({ color: 0x393b33, roughness: .68, metalness: .55 });
  const glowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd29a, roughness: .35, emissive: 0xffb756, emissiveIntensity: 0 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xd9b57c, roughness: .84, emissive: 0xffb24b, emissiveIntensity: 0,
    transparent: true, opacity: .62, depthWrite: false });
  const snowMaterial = new THREE.MeshStandardMaterial({ color: 0xeaf0ed, roughness: .99,
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const surfaceSnow={value:0};
  if(stone && !sharedStone)attachSnowSurface(stone,surfaceSnow,{surface:snowSurface,smoothNormals:true});
  for(const material of [roofMaterial,tileRim,timber,darkTimber])attachSnowSurface(material,surfaceSnow,{surface:snowSurface});
  attachSnowSurface(snowMaterial,surfaceSnow,{layer:true,surface:snowSurface,volume:true,growth:true});
  const geometries = new Set(), materials = new Set([stone !== sharedStone ? stone : null, timber, darkTimber, roofMaterial, tileRim, iron, glowMaterial, paper, snowMaterial].filter(Boolean));
  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); geometries.add(geometry); if (material !== sharedStone) materials.add(material); return mesh;
  };
  const deck = [];
  const plankCount = Math.ceil(floorHalf * 2 / .20), plankWidth = floorHalf * 2 / plankCount;
  for (let i = 0; i < plankCount; i++) deck.push(new THREE.BoxGeometry(plankWidth, .16, floorHalf * 2)
    .translate(-floorHalf + (i + .5) * plankWidth, -.08, 0));
  const base = add('山亭架空木台地板', mergeParts(deck), deckTimber);
  const posts = [], feet = [], beams = [], supports = [], braces = [], postInset = floorHalf - .21;
  for (const x of [-postInset, postInset]) for (const z of [-postInset, postInset]) {
    posts.push(new THREE.CylinderGeometry(.092, .108, 2.36, 10).translate(x, 1.33, z));
    feet.push(new THREE.BoxGeometry(.24, .16, .24).translate(x, .08, z));
    let ground = Infinity;
    // Place the entire bottom cap inside the actual terrain, including cross-slope edges.
    for (let ring = 0; ring <= 2; ring++) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, r = ring / 2 * .12;
      ground = Math.min(ground, groundAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    const bottom = ground - floorTop - .105, top = -.055;
    supports.push(new THREE.CylinderGeometry(.115, .12, top - bottom, 10).translate(x, (top + bottom) / 2, z));
    if (bottom < -.65) for (const alongX of [false, true]) {
      const target = new THREE.Vector3(alongX ? x * .30 : x, -.12, alongX ? z : z * .30);
      const start = new THREE.Vector3(x, Math.max(bottom + .20, -1.38), z);
      braces.push(beamBetween(start, target, .054));
    }
    const roofSupport = roofHeight(postInset / ROOF_HALF) - .10;
    if (roofSupport > 2.50) beams.push(beamBetween(new THREE.Vector3(x, 2.47, z), new THREE.Vector3(x, roofSupport, z), .065));
    for (const direction of [-1, 1]) {
      const alongX = direction < 0;
      const target = new THREE.Vector3(alongX ? x * .66 : x, 2.47, alongX ? z : z * .66);
      beams.push(beamBetween(new THREE.Vector3(x, 2.03, z), target, .052));
    }
  }
  add('山亭旧木柱', mergeParts(posts), timber);
  add('山亭柱脚木垫座', mergeParts(feet), darkTimber);
  add('山亭贴坡支承木柱', mergeParts(supports), timber);
  if (braces.length) add('山亭台下木斜撑', mergeParts(braces), darkTimber);
  for (const z of [-postInset, postInset]) beams.push(new THREE.BoxGeometry(postInset * 2 + .21, .18, .17).translate(0, 2.46, z));
  for (const x of [-postInset, postInset]) beams.push(new THREE.BoxGeometry(.17, .18, postInset * 2 + .21).translate(x, 2.46, 0));
  for (const edge of roofEdges) for (const t of [.25, .5, .75]) {
    // Follow the tile curvature; one long chord would protrude through its middle.
    for (let segment = 0; segment < 16; segment++) {
      const a = new THREE.Vector3(...roofPoint(edge, t, .22 + .78 * segment / 16, -.145));
      const b = new THREE.Vector3(...roofPoint(edge, t, .22 + .78 * (segment + 1) / 16, -.145));
      beams.push(beamBetween(a, b, .045));
    }
  }
  add('山亭木梁与斜撑', mergeParts(beams), darkTimber);
  const lattice = [], brackets = [], panelHalf = Math.max(.55, postInset - .085);
  const panelWidth = panelHalf * 2, cells = Math.max(4, Math.round(panelWidth / .25));
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    const bar = (length, height, along, y) => {
      const geometry = new THREE.BoxGeometry(axis === 'x' ? .032 : length, height, axis === 'x' ? length : .032);
      return geometry.translate(axis === 'x' ? sign * postInset : along, y, axis === 'x' ? along : sign * postInset);
    };
    lattice.push(bar(panelWidth, .025, 0, 2.095), bar(panelWidth, .025, 0, 2.325));
    for (let i = 0; i < cells; i++) {
      const center = -panelHalf + (i + .5) / cells * panelWidth, width = panelWidth / cells * .73;
      for (const y of [2.145, 2.285]) lattice.push(bar(width, .023, center, y));
      for (const side of [-1, 1]) lattice.push(bar(.023, .16, center + side * width / 2, 2.215));
      lattice.push(bar(panelWidth / cells - width + .025, .023, center + panelWidth / cells / 2, 2.215));
    }
  }
  add('山亭檐下回纹花格', mergeParts(lattice), darkTimber);
  for (const x of [-postInset, postInset]) for (const z of [-postInset, postInset]) {
    brackets.push(new THREE.BoxGeometry(.38, .085, .18).translate(x, 2.57, z));
    brackets.push(new THREE.BoxGeometry(.18, .085, .38).translate(x, 2.655, z));
    brackets.push(new THREE.BoxGeometry(.29, .09, .29).translate(x, 2.73, z));
  }
  add('山亭檐下小斗拱', mergeParts(brackets), timber);
  const benches = [], benchInset = floorHalf - .25, benchLength = floorHalf * 2 - 1.02;
  for (const x of [-benchInset, benchInset]) {
    benches.push(new THREE.BoxGeometry(.37, .075, benchLength).translate(x, .455, -.05));
    for (const z of [-benchLength * .37, benchLength * .37]) {
      benches.push(new THREE.BoxGeometry(.09, .40, .22).translate(x, .20, z));
      benches.push(new THREE.BoxGeometry(.045, .76, .07).translate(x + Math.sign(x) * .17, .52, z));
    }
    for (const y of [.68, .87]) benches.push(new THREE.BoxGeometry(.055, .115, benchLength).translate(x + Math.sign(x) * .18, y, -.05));
  }
  const backLength = benchInset * 2 - .37;
  benches.push(new THREE.BoxGeometry(backLength, .075, .37).translate(0, .455, -benchInset));
  for (const x of [-backLength * .37, backLength * .37]) {
    benches.push(new THREE.BoxGeometry(.22, .40, .09).translate(x, .20, -benchInset));
    benches.push(new THREE.BoxGeometry(.07, .76, .045).translate(x, .52, -benchInset - .17));
  }
  for (const y of [.68, .87]) benches.push(new THREE.BoxGeometry(backLength, .115, .055).translate(0, y, -benchInset - .18));
  add('山亭靠边长凳', mergeParts(benches), timber);
  const rails = [], railEdge = floorHalf - .045, railLength = floorHalf * 2;
  for (const [axis, sign] of [['x', -1], ['x', 1], ['z', -1]]) {
    const bar = (length, height, along, y, depth = .055) => {
      const geometry = new THREE.BoxGeometry(axis === 'x' ? depth : length, height, axis === 'x' ? length : depth);
      return geometry.translate(axis === 'x' ? sign * railEdge : along, y, axis === 'x' ? along : sign * railEdge);
    };
    // A restrained frame-and-return pattern echoes the grille beneath the eaves.
    for (const y of [.28, 1.06]) rails.push(bar(railLength, .09, 0, y, .09));
    rails.push(bar(railLength - .08, .036, 0, .72));
    for (const end of [-1, 1]) rails.push(bar(.08, .78, end * (floorHalf - .04), .67, .09));
    const width = railLength - .18, cells = Math.max(4, Math.round(width / .34));
    for (let i = 0; i < cells; i++) {
      const center = -width / 2 + (i + .5) * width / cells, windowWidth = width / cells * .74;
      for (const y of [.47, 1.0]) rails.push(bar(windowWidth, .036, center, y));
      for (const edge of [-1, 1]) rails.push(bar(.036, .53, center + edge * windowWidth / 2, .735));
    }
  }
  add('山亭三面木栏', mergeParts(rails), darkTimber);
  const roof = add('山亭弧瓦屋顶', roofGeometry(), roofMaterial);
  add('山亭瓦垄与屋脊', roofTiles(), tileRim);
  const crownProfile = [[.015, 0], [.13, .055], [.085, .15], [.055, .22], [.055, .30],
    [.105, .36], [.085, .47], [.018, .54]].map(([x, y]) => new THREE.Vector2(x, y));
  add('山亭攒尖宝顶', new THREE.LatheGeometry(crownProfile, 10).translate(0, 3.46, 0), roofMaterial);
  const snow = add('山亭屋顶积雪', createSnowRoofShell(roof.geometry,{thickness:WEATHER_CONFIG.snowpack.pavilionDepth}), snowMaterial);
  snow.visible = false; snow.castShadow = false; snow.renderOrder = 2;
  add('山亭悬灯细铁链', new THREE.CylinderGeometry(.009, .009, .64, 5).translate(0, 2.81, 0), iron);
  const lampFrame = [];
  for (const x of [-.13, .13]) for (const z of [-.13, .13]) lampFrame.push(new THREE.BoxGeometry(.015, .33, .015).translate(x, 2.32, z));
  for (const y of [2.15, 2.49]) lampFrame.push(new THREE.BoxGeometry(.28, .025, .28).translate(0, y, 0));
  add('山亭旧铁吊灯框', mergeParts(lampFrame), iron);
  const lampPaper = add('山亭吊灯暖纸罩', new THREE.BoxGeometry(.23, .29, .23).translate(0, 2.32, 0), paper);
  lampPaper.castShadow = false;
  const glow = add('山亭暖灯芯', new THREE.SphereGeometry(.069, 12, 8).translate(0, 2.32, 0), glowMaterial);
  glow.castShadow = false;
  const light = new THREE.PointLight(0xffc27d, 0, 8, 2); light.name = '山亭局部暖灯'; light.position.y = 2.32;
  light.castShadow = false; light.visible = false; group.add(light);
  const chime = createPavilionChimes(group, add, position, roof);
  if (sharedStone && steps.length) {
    const dx = localApproach.x, dz = localApproach.z - floorHalf, distance = Math.hypot(dx, dz);
    const axis = { x: dx / distance, z: dz / distance };
    const parts = steps.map((step, i) => colorPathStone(stairGeometry(step.corners, groundAt, step.top, floorTop, {
      previous: i ? steps[i - 1].top : floorTop, next: i + 1 < steps.length ? steps[i + 1].top : approach.y, axis,
    }),
      stoneSurface, position, sin, cos, approach));
    add('山亭入口石阶', mergeParts(parts), stone);
  } else steps.forEach((step, i) => add(`山亭入口石阶 ${i + 1}`, stairGeometry(step.corners, groundAt, step.top, floorTop), stone));
  // Caller guard data: world floor/entry heights and actual adopted landing dimensions.
  group.userData.floorTop = floorTop;
  group.userData.floorSize = floorHalf * 2;
  group.userData.entryClearWidth = (benchInset - .37 / 2) * 2;
  group.userData.entranceWorld = { x: position.x + floorHalf * sin, y: floorTop, z: position.z + floorHalf * cos };
  group.userData.approachTop = steps.length ? steps.at(-1).top : Number.isFinite(approach?.y) ? approach.y : floorTop;
  group.userData.approachConnected = true;
  scene.add(group);
  let disposed = false, quality = 'high', lastTime = 0, snowCover = 0;
  function setQuality(next) {
    if (disposed) return;
    quality = ['low', 'medium', 'high'].includes(next) ? next : 'high';
    group.traverse(object => {
      if (object.isMesh) object.castShadow = quality !== 'low' && ![base, snow, glow, lampPaper].includes(object);
    });
  }
  function update(time, environment = {}) {
    if (disposed) return;
    if (environment.quality && environment.quality !== quality) setQuality(environment.quality);
    const strength = environment.artificialLightsOff ? 0 : getRestPavilionLampStrength(environment.daylight);
    light.intensity = strength * 12; light.visible = strength > .0001;
    glowMaterial.emissiveIntensity = strength * 4.2; paper.emissiveIntensity = strength * .48;
    const now = Number.isFinite(time) ? Math.max(lastTime, time) : lastTime;
    const delta = getAnimationDelta(now - lastTime, 1, environment); lastTime = now;
    chime.update(delta, now, environment, api.onChime);
    snowCover += (getSnowCover(environment) - snowCover) * (1 - Math.exp(-delta * 1.8));
    surfaceSnow.value=snowCover;
    snowMaterial.opacity = snowCover * .96; snow.visible = snowCover > .005;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; light.intensity = 0; light.visible = false;
    api.onChime = null;
    woodSurface.dispose(); roofSurface.dispose();
    for (const geometry of geometries) geometry.dispose();
    const textures = new Set();
    for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    group.removeFromParent(); group.clear();
  }
  function setSurfaceMaps(maps={}) {
    if(disposed)return;
    if('wood' in maps)woodSurface.setMaps(maps.wood??{albedo:null,relief:null});
    if('roof' in maps)roofSurface.setMaps(maps.roof??{albedo:null,relief:null});
  }
  const api = { group, update, setQuality, setSurfaceMaps, dispose, onChime: null };
  return api;
}
