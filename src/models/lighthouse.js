import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStructureSurfaceState, attachStructureSurface } from '../structure-surfaces.js';
import { createCoastalSurfaceUniforms } from '../coastal-surfaces.js';
import { configurePathMaterial } from './island-paths.js';

const TAU = Math.PI * 2;
const BASE_RADIUS = 2.15;
// Bottom chords cross terrain triangle seams; bury enough to keep outer walls sealed.
const GROUND_EMBED = .085;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function getLighthouseLampStrength(daylight) {
  if (!Number.isFinite(daylight)) return 0;
  const t = clamp((.36 - daylight) / .305, 0, 1);
  return t * t * (3 - 2 * t);
}

const sweepAngle = time => (Number.isFinite(time) ? time : 0) * TAU / 26;

function meshGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function surfaceBuilder() {
  const positions = [], indices = [];
  return {
    quad(a, b, c, d) {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c, ...d);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    },
    triangle(a, b, c) {
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c); indices.push(i, i + 1, i + 2);
    },
    finish() { return meshGeometry(positions, indices); },
  };
}

// Position-based detail works in Node and WebGL without a DOM canvas or assets.
function weatheredMaterial(color, stone = false) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .94, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vLighthouseLocal;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLighthouseLocal = position;');
    shader.fragmentShader = `varying vec3 vLighthouseLocal;
      float lighthouseGrain(vec3 p) { return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719))) * 43758.5453); }
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p = vLighthouseLocal;
      float fineGrain = lighthouseGrain(p * 72.0);
      float patches = lighthouseGrain(p * 3.2);
      float damp = (1.0 - smoothstep(0.4, 2.8, p.y)) * (0.035 + patches * 0.10);
      diffuseColor.rgb *= ${stone ? '0.83 + patches * 0.14 + fineGrain * 0.10' : '0.91 + fineGrain * 0.08 - damp'};
      ${stone ? `float course = fract(p.y / 0.34);
      float seam = 1.0 - smoothstep(0.018, 0.047, min(course, 1.0 - course));
      float block = fract((atan(p.x,p.z) + 3.14159) * 7.2 + floor(p.y / 0.34) * 0.5);
      seam = max(seam, 1.0 - smoothstep(0.018, 0.04, min(block, 1.0 - block)));
      diffuseColor.rgb *= 1.0 - seam * 0.11;` : ''}
      `);
  };
  material.customProgramCacheKey = () => stone ? 'lighthouse-masonry-1' : 'lighthouse-limewash-1';
  return material;
}

function foundation(heightAt, position, top) {
  const surface = surfaceBuilder();
  for (let i = 0; i < 96; i++) {
    const a = i * TAU / 96, b = (i + 1) * TAU / 96;
    const ax = Math.sin(a) * BASE_RADIUS, az = Math.cos(a) * BASE_RADIUS;
    const bx = Math.sin(b) * BASE_RADIUS, bz = Math.cos(b) * BASE_RADIUS;
    const ay = heightAt(position.x + ax, position.z + az) - top - GROUND_EMBED;
    const by = heightAt(position.x + bx, position.z + bz) - top - GROUND_EMBED;
    surface.quad([ax, ay, az], [bx, by, bz], [bx, 0, bz], [ax, 0, az]);
    surface.triangle([0, 0, 0], [ax, 0, az], [bx, 0, bz]);
  }
  return surface.finish();
}

const openings = [
  { angle: 0, half: .33, low: .16, high: 2.68 },
  { angle: 0, half: .16, low: 4.08, high: 5.10 },
  { angle: Math.PI, half: .17, low: 6.30, high: 7.32 },
  { angle: Math.PI / 2, half: .16, low: 8.18, high: 9.03 },
];
const towerRadius = y => 1.76 - (y - .44) / 9.28 * .57;
const circlePoint = (angle, y, inset = 0) => [Math.sin(angle) * (towerRadius(y) - inset), y, Math.cos(angle) * (towerRadius(y) - inset)];

function towerShell() {
  const surface = surfaceBuilder();
  const angles = [-Math.PI, Math.PI];
  for (let i = 0; i <= 96; i++) angles.push(-Math.PI + i * TAU / 96);
  for (const opening of openings) {
    for (const edge of [opening.angle - opening.half, opening.angle + opening.half]) {
      let angle = edge; if (angle > Math.PI) angle -= TAU;
      angles.push(angle);
    }
  }
  angles.sort((a, b) => a - b);
  const cuts = angles.filter((angle, i) => !i || angle - angles[i - 1] > 1e-7);
  const heights = [...new Set([.16, 9.72, ...openings.flatMap(opening => [opening.low, opening.high])])].sort((a, b) => a - b);
  const isOpening = (angle, y) => openings.some(opening => {
    const distance = Math.abs(Math.atan2(Math.sin(angle - opening.angle), Math.cos(angle - opening.angle)));
    return distance < opening.half && y > opening.low && y < opening.high;
  });
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    for (let j = 0; j + 1 < heights.length; j++) {
      const low = heights[j], high = heights[j + 1];
      if (isOpening((a + b) / 2, (low + high) / 2)) continue;
      surface.quad(circlePoint(a, low), circlePoint(a, high), circlePoint(b, high), circlePoint(b, low));
      surface.quad(circlePoint(b, low, .15), circlePoint(b, high, .15), circlePoint(a, high, .15), circlePoint(a, low, .15));
    }
  }
  for (const opening of openings) {
    const a = opening.angle - opening.half, b = opening.angle + opening.half;
    for (const angle of [a, b]) surface.quad(circlePoint(angle, opening.low), circlePoint(angle, opening.low, .15),
      circlePoint(angle, opening.high, .15), circlePoint(angle, opening.high));
    for (const y of [opening.low, opening.high]) surface.quad(circlePoint(a, y), circlePoint(b, y),
      circlePoint(b, y, .15), circlePoint(a, y, .15));
  }
  return surface.finish();
}

function mergeParts(parts) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

function beamGeometry() {
  const positions = [], uvs = [], indices = [];
  const axial = 12, radial = 24, length = 105;
  for (let i = 0; i <= axial; i++) {
    const t = i / axial, radius = .10 + t * 6.1;
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * TAU;
      positions.push(t * length, Math.sin(angle) * radius, Math.cos(angle) * radius);
      uvs.push(t, j / radial);
      if (i < axial && j < radial) {
        const a = i * (radial + 1) + j, b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = meshGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec2 vBeamUv; varying vec3 vBeamNormal; varying vec3 vBeamView;
      void main() { vBeamUv=uv; vBeamNormal=normalize(normalMatrix * normal);
        vec4 view=modelViewMatrix * vec4(position,1.0); vBeamView=-view.xyz; gl_Position=projectionMatrix*view; }`,
    fragmentShader: `uniform float strength; varying vec2 vBeamUv; varying vec3 vBeamNormal; varying vec3 vBeamView;
      void main() { float t=vBeamUv.x;
        float silhouette=pow(abs(dot(normalize(vBeamNormal),normalize(vBeamView))),1.35);
        float fade=exp(-t*2.9) * (1.0-smoothstep(0.58,1.0,t));
        float source=smoothstep(0.0,0.018,t);
        float alpha=strength*0.075*silhouette*fade*source;
        gl_FragColor=vec4(vec3(1.0,0.78,0.43),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
}

function prismGeometry(corners, heightAt, position, top, platformTop) {
  const surface = surfaceBuilder();
  const upper = corners.map(point => [point.x - position.x, top - platformTop, point.z - position.z]);
  const lower = corners.map(point => [point.x - position.x, Math.min(top - .09, heightAt(point.x, point.z) - GROUND_EMBED) - platformTop,
    point.z - position.z]);
  surface.quad(upper[0], upper[1], upper[2], upper[3]);
  for (let i = 0; i < 4; i++) surface.quad(lower[i], lower[(i + 1) % 4], upper[(i + 1) % 4], upper[i]);
  return surface.finish();
}

// A bowed approach gives enough tread depth for a short steep summit shoulder.
// Each step is a terrain-filled stone prism, rather than a hanging ramp.
function stairPlan(heightAt, position, direction, platformTop, approach) {
  if (!approach || !Number.isFinite(approach.x) || !Number.isFinite(approach.z)) return [];
  const start = { x: position.x + direction.x * 2.02, z: position.z + direction.z * 2.02 };
  const dx = approach.x - start.x, dz = approach.z - start.z, distance = Math.hypot(dx, dz);
  if (distance < .2) return [];
  const endTop = Number.isFinite(approach.y) ? approach.y : heightAt(approach.x, approach.z) + .038;
  const tangent = { x: dx / distance, z: dz / distance }, side = { x: -tangent.z, z: tangent.x };
  const minSteps = Math.max(1, Math.ceil(Math.abs(endTop - platformTop) / .18));
  const width = .84;
  let best = null;
  for (const bow of [0, .65, 1.2, 1.7, 2.2]) {
    for (const sign of bow === 0 ? [1] : [-1, 1]) {
      const raw = [], lengths = [0];
      for (let i = 0; i <= 80; i++) {
        const t = i / 80, offset = Math.sin(Math.PI * t) * bow * sign;
        raw.push({ x: start.x + dx * t + side.x * offset, z: start.z + dz * t + side.z * offset });
        if (i) lengths.push(lengths[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
      }
      const total = lengths.at(-1), count = Math.max(minSteps, Math.ceil(total / .36));
      if (total / count < .28) continue;
      const boundaries = [];
      for (let i = 0; i <= count; i++) {
        const target = total * i / count;
        let j = 1; while (j < lengths.length - 1 && lengths[j] < target) j++;
        const f = (target - lengths[j - 1]) / (lengths[j] - lengths[j - 1]);
        boundaries.push({ x: raw[j - 1].x + (raw[j].x - raw[j - 1].x) * f,
          z: raw[j - 1].z + (raw[j].z - raw[j - 1].z) * f });
      }
      const edges = boundaries.map((point, i) => {
        const before = boundaries[Math.max(0, i - 1)], after = boundaries[Math.min(count, i + 1)];
        const run = Math.hypot(after.x - before.x, after.z - before.z);
        const sx = -(after.z - before.z) / run * width / 2, sz = (after.x - before.x) / run * width / 2;
        return [{ x: point.x + sx, z: point.z + sz }, { x: point.x - sx, z: point.z - sz }];
      });
      const steps = [];
      for (let i = 0; i < count; i++) {
        const a = boundaries[i], b = boundaries[i + 1], run = Math.hypot(b.x - a.x, b.z - a.z);
        const corners = [edges[i][0], edges[i + 1][0], edges[i + 1][1], edges[i][1]];
        let ground = -Infinity;
        for (let j = 0; j <= 4; j++) for (let k = 0; k <= 4; k++) {
          const t = j / 4, s = k / 4;
          const left = { x: corners[0].x + (corners[1].x - corners[0].x) * t,
            z: corners[0].z + (corners[1].z - corners[0].z) * t };
          const right = { x: corners[3].x + (corners[2].x - corners[3].x) * t,
            z: corners[3].z + (corners[2].z - corners[3].z) * t };
          ground = Math.max(ground, heightAt(left.x + (right.x - left.x) * s, left.z + (right.z - left.z) * s));
        }
        const target = platformTop + (endTop - platformTop) * (i + 1) / count;
        steps.push({ corners, top: Math.max(target, ground + .038), run });
      }
      if (endTop >= platformTop) {
        for (let i = 1; i < count; i++) steps[i].top = Math.max(steps[i].top, steps[i - 1].top);
        for (let i = count - 2; i >= 0; i--) steps[i].top = Math.max(steps[i].top, steps[i + 1].top - .19);
      } else {
        for (let i = count - 2; i >= 0; i--) steps[i].top = Math.max(steps[i].top, steps[i + 1].top);
        for (let i = 1; i < count; i++) steps[i].top = Math.max(steps[i].top, steps[i - 1].top - .19);
      }
      const firstRise = Math.abs(steps[0].top - platformTop), lastGap = Math.abs(steps.at(-1).top - endTop);
      const maxRise = Math.max(firstRise, ...steps.slice(1).map((step, i) => Math.abs(step.top - steps[i].top)));
      if (maxRise > .200001 || lastGap > .12 || steps.some(step => step.run < .279)) continue;
      const score = total + steps.reduce((sum, step, i) => sum + Math.max(0, step.top - (platformTop + (endTop - platformTop) * (i + 1) / count)), 0) * .08;
      if (!best || score < best.score) best = { score, steps };
    }
  }
  return best?.steps || [];
}

export function createLighthouse(scene, { heightAt, position, doorDirection = { x: 0, z: 1 }, approach } = {}) {
  if (typeof heightAt !== 'function' || !Number.isFinite(position?.x) || !Number.isFinite(position?.z)) {
    throw new TypeError('灯塔需要真实地形采样函数与有限的 x/z 坐标');
  }
  const length = Math.hypot(doorDirection.x, doorDirection.z) || 1;
  const direction = { x: doorDirection.x / length, z: doorDirection.z / length };
  const angle = Math.atan2(direction.x, direction.z);
  let highest = heightAt(position.x, position.z);
  for (let ring = 1; ring <= 4; ring++) for (let i = 0; i < 96; i++) {
    const a = i * TAU / 96, r = BASE_RADIUS * ring / 4;
    highest = Math.max(highest, heightAt(position.x + Math.sin(a) * r, position.z + Math.cos(a) * r));
  }
  const platformTop = highest + .18;
  const group = new THREE.Group(); group.name = '山顶灯塔'; group.position.set(position.x, platformTop, position.z);
  const architecture = new THREE.Group(); architecture.name = '灯塔建筑'; architecture.rotation.y = angle; group.add(architecture);
  const surface = createStructureSurfaceState();
  const stepSurfaces = { ...createCoastalSurfaceUniforms(), uLandWetness: { value: 0 } }, stepSnow = { value: 0 };
  const masonry = new THREE.MeshStandardMaterial({ color: 0xaaa594, roughness: .98, side: THREE.DoubleSide });
  configurePathMaterial(masonry, stepSnow, false, stepSurfaces);
  const limewash = attachStructureSurface(weatheredMaterial(0xe8e4d8), surface, { plaster: true });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x47514a, roughness: .57, metalness: .72 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x65342d, roughness: .69, metalness: .35 });
  const wood = weatheredMaterial(0x49392b), recess = new THREE.MeshStandardMaterial({ color: 0x211f1c, roughness: .95 });
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x527174, roughness: .25, metalness: .12, transparent: true, opacity: .68 });
  const lanternGlass = new THREE.MeshStandardMaterial({ color: 0xacc7c6, roughness: .16, metalness: .07,
    transparent: true, opacity: .20, depthWrite: false, side: THREE.DoubleSide });
  const lensMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c486, roughness: .18, metalness: .1,
    emissive: 0xffb24c, emissiveIntensity: 0, transparent: true, opacity: .67 });
  const glowMaterial = new THREE.MeshStandardMaterial({ color: 0xf7d795, roughness: .32, emissive: 0xffad40, emissiveIntensity: 0 });
  const geometries = new Set(), materials = new Set([masonry, limewash, bronze, roofMaterial, wood, recess,
    windowMaterial, lanternGlass, lensMaterial, glowMaterial]);
  const add = (parent, name, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); geometries.add(geometry); materials.add(material); return mesh;
  };
  const base = add(group, '灯塔贴坡石基', foundation(heightAt, position, platformTop), masonry);
  base.castShadow = false;
  add(architecture, '灯塔石砌塔脚', new THREE.CylinderGeometry(1.79, 1.87, .16, 64), masonry, 0, .08);
  add(architecture, '灯塔旧石灰塔身', towerShell(), limewash);
  const doorZ = towerRadius(1.39) - .045;
  add(architecture, '灯塔木门', new THREE.BoxGeometry(1.04, 2.46, .12), wood, 0, 1.395, doorZ);
  const plankParts = [];
  for (let i = 1; i < 7; i++) plankParts.push(new THREE.BoxGeometry(.011, 2.40, .005).translate(-.52 + i * 1.04 / 7, 1.395, doorZ + .063));
  for (const y of [.91, 2.11]) plankParts.push(new THREE.BoxGeometry(.78, .055, .03).translate(0, y, doorZ + .073));
  add(architecture, '灯塔门木板与旧铁箍', mergeParts(plankParts), recess);
  const jambs = [new THREE.BoxGeometry(.13, 2.58, .20).translate(-.60, 1.45, doorZ),
    new THREE.BoxGeometry(.13, 2.58, .20).translate(.60, 1.45, doorZ),
    new THREE.BoxGeometry(1.32, .18, .21).translate(0, 2.74, doorZ)];
  add(architecture, '灯塔石门框', mergeParts(jambs), masonry);
  add(architecture, '灯塔门把手', new THREE.TorusGeometry(.075, .012, 6, 12), bronze, .35, 1.53, doorZ + .078);
  for (const opening of openings.slice(1)) {
    const y = (opening.low + opening.high) / 2, r = towerRadius(y) - .075;
    const pane = add(architecture, '灯塔窗玻璃', new THREE.BoxGeometry(.42, opening.high - opening.low - .08, .034), windowMaterial,
      Math.sin(opening.angle) * r, y, Math.cos(opening.angle) * r); pane.rotation.y = opening.angle;
    const width = .52, height = opening.high - opening.low + .09, parts = [];
    for (const x of [-width / 2, width / 2]) parts.push(new THREE.BoxGeometry(.055, height, .105).translate(x, 0, 0));
    for (const yy of [-height / 2, height / 2, 0]) parts.push(new THREE.BoxGeometry(width, .045, .105).translate(0, yy, 0));
    const frame = add(architecture, '灯塔窄窗石框', mergeParts(parts), masonry,
      Math.sin(opening.angle) * (r + .047), y, Math.cos(opening.angle) * (r + .047)); frame.rotation.y = opening.angle;
  }
  add(architecture, '灯塔檐下线脚', new THREE.CylinderGeometry(1.40, 1.21, .31, 64), limewash, 0, 9.67);
  add(architecture, '灯塔环形石露台', new THREE.CylinderGeometry(1.99, 1.92, .19, 64), masonry, 0, 9.87);
  const railParts = [];
  for (const y of [10.14, 10.69]) railParts.push(new THREE.TorusGeometry(1.84, .035, 6, 64).rotateX(Math.PI / 2).translate(0, y, 0));
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24;
    railParts.push(new THREE.CylinderGeometry(.022, .028, .80, 5).translate(Math.sin(a) * 1.84, 10.30, Math.cos(a) * 1.84));
  }
  add(architecture, '灯塔圆形栏杆', mergeParts(railParts), bronze);
  add(architecture, '灯塔灯室下缘', new THREE.CylinderGeometry(1.16, 1.23, .39, 32), bronze, 0, 10.12);
  add(architecture, '灯塔灯室玻璃', new THREE.CylinderGeometry(1.10, 1.10, 1.77, 8, 1, true), lanternGlass, 0, 11.19);
  const frameParts = [];
  for (const y of [10.30, 12.09]) frameParts.push(new THREE.TorusGeometry(1.12, .048, 6, 32).rotateX(Math.PI / 2).translate(0, y, 0));
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    frameParts.push(new THREE.CylinderGeometry(.031, .031, 1.82, 6).translate(Math.sin(a) * 1.1, 11.19, Math.cos(a) * 1.1));
  }
  add(architecture, '灯塔灯室青铜骨架', mergeParts(frameParts), bronze);
  add(architecture, '灯塔暗红金属屋顶', new THREE.ConeGeometry(1.38, 1.11, 16), roofMaterial, 0, 12.65);
  add(architecture, '灯塔屋檐青铜圈', new THREE.TorusGeometry(1.35, .045, 6, 48).rotateX(Math.PI / 2), bronze, 0, 12.09);
  add(architecture, '灯塔顶通风帽', new THREE.CylinderGeometry(.13, .21, .30, 12), bronze, 0, 13.28);
  add(architecture, '灯塔顶尖', new THREE.ConeGeometry(.10, .53, 12), bronze, 0, 13.67);
  add(architecture, '灯塔光学支架', new THREE.CylinderGeometry(.065, .12, .44, 12), bronze, 0, 10.53);
  add(architecture, '灯塔暖金灯芯', new THREE.SphereGeometry(.19, 16, 10), glowMaterial, 0, 11.18);
  const fresnelParts = [];
  for (let i = 0; i < 26; i++) {
    const yy = -.59 + i * 1.18 / 25, r = .39 + Math.sqrt(Math.max(0, 1 - (yy / .71) ** 2)) * .115;
    fresnelParts.push(new THREE.TorusGeometry(r, .017, 5, 32).rotateX(Math.PI / 2).translate(0, 11.18 + yy, 0));
  }
  add(architecture, '灯塔菲涅尔镜', mergeParts(fresnelParts), lensMaterial);
  add(architecture, '灯塔菲涅尔镜罩', new THREE.CylinderGeometry(.46, .46, 1.21, 32, 1, true), lensMaterial, 0, 11.18);
  const light = new THREE.PointLight(0xffc378, 0, 20, 2); light.name = '灯塔灯室暖灯'; light.position.set(0, 11.18, 0);
  light.castShadow = false; light.visible = false; group.add(light);
  const rotor = new THREE.Group(); rotor.name = '灯塔旋转扫光'; rotor.position.y = 11.18; group.add(rotor);
  const cone = beamGeometry(), beam = beamMaterial(); materials.add(beam);
  const beams = [add(rotor, '灯塔柔和扫光 1', cone, beam), add(rotor, '灯塔柔和扫光 2', cone, beam)];
  beams[1].rotation.y = Math.PI;
  for (const mesh of beams) { mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false; mesh.renderOrder = 4; }
  const steps = stairPlan(heightAt, position, direction, platformTop, approach);
  steps.forEach((step, i) => {
    const mesh = add(group, `灯塔入口石阶 ${i + 1}`, prismGeometry(step.corners, heightAt, position, step.top, platformTop), masonry);
    mesh.userData.treadDepth = step.run; mesh.userData.top = step.top;
  });
  group.userData.approachConnected = !approach || steps.length > 0;
  scene.add(group);
  let disposed = false, quality = 'high';
  function setQuality(next) {
    if (disposed) return;
    quality = ['low', 'medium', 'high'].includes(next) ? next : 'high';
    // The inexpensive tower and beams remain on all settings; shadows are optional.
    architecture.traverse(object => { if (object.isMesh) object.castShadow = quality !== 'low' && object.material !== lanternGlass; });
  }
  function update(time, environment = {}) {
    if (disposed) return;
    stepSurfaces.uLandWetness.value = clamp(environment.rain ?? 0, 0, 1);
    stepSnow.value = Math.max(environment.snow ?? 0, environment.season === 'winter' ? .85 : 0);
    if (environment.quality && environment.quality !== quality) setQuality(environment.quality);
    const strength = environment.artificialLightsOff || environment.lighthouseLightsOff ? 0 : getLighthouseLampStrength(environment.daylight);
    light.intensity = strength * 23; light.visible = strength > .0001;
    glowMaterial.emissiveIntensity = strength * 6.5;
    lensMaterial.emissiveIntensity = strength * 2.7;
    beam.uniforms.strength.value = strength;
    for (const mesh of beams) mesh.visible = strength > .0001;
    rotor.rotation.y = sweepAngle(time);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; light.intensity = 0; light.visible = false;
    surface.dispose();
    // The island owns the shared coastal maps; never dispose them here.
    masonry.bumpMap = null; stepSurfaces.uStepMap.value = null; stepSurfaces.uStepMapEnabled.value = 0;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.removeFromParent(); group.clear();
  }
  function setStepMap(map) {
    if (disposed) return;
    const next = map ?? null;
    if (Boolean(masonry.bumpMap) !== Boolean(next)) masonry.needsUpdate = true;
    masonry.bumpMap = next;
    stepSurfaces.uStepMap.value = next; stepSurfaces.uStepMapEnabled.value = next ? 1 : 0;
  }
  return { group, update, setQuality, setSurfaceMaps: surface.setMaps, setStepMap, dispose };
}
