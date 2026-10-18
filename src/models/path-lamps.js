import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isCaveReserved } from '../cave-layout.js';
import { isLighthouseReserved } from '../lighthouse-layout.js';
import { getLighthouseLampStrength } from './lighthouse.js';

const FOOT_RADIUS = .20;
const LANTERN_RADIUS = .26;
const GROUND_EMBED = .085;
const SPACING = 10;
const POINT_BUDGET = { high: 4, medium: 3, low: 2 };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function routeProfile(route) {
  const distances = [0];
  for (let i = 1; i < route.points.length; i++) distances.push(distances[i - 1] + gap(route.points[i], route.points[i - 1]));
  const total = distances.at(-1);
  function sample(distance) {
    const d = clamp(distance, 0, total);
    let i = 1;
    while (i < distances.length - 1 && distances[i] < d) i++;
    const a = route.points[i - 1], b = route.points[i], length = distances[i] - distances[i - 1];
    const t = length > 0 ? (d - distances[i - 1]) / length : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  return { total, sample };
}

function roadDistanceSampler(routes) {
  const segments = [];
  for (const route of routes) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    if (squared < 1e-10) continue;
    // Road surfacing varies slightly across its width; use its widest outline.
    segments.push({ a, dx, dz, squared, half: route.width * .5 * 1.075 });
  }
  return (x, z) => {
    let nearest = Infinity;
    for (const segment of segments) {
      const { a, dx, dz, squared, half } = segment;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / squared, 0, 1);
      nearest = Math.min(nearest, Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - half);
    }
    return nearest;
  };
}

function footAt(x, z, heightAt) {
  const y = heightAt(x, z);
  if (!Number.isFinite(y) || y <= .6) return null;
  let low = y, high = y;
  // Dense disk samples allow the shared small stone cylinder to be embedded
  // below every terrain triangle under its footprint, without editing terrain.
  for (let ring = 1; ring <= 5; ring++) for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI * 2 / 24, radius = FOOT_RADIUS * ring / 5;
    const h = heightAt(x + Math.sin(angle) * radius, z + Math.cos(angle) * radius);
    if (!Number.isFinite(h) || h <= .6) return null;
    low = Math.min(low, h); high = Math.max(high, h);
  }
  if (high - low > .35) return null;
  // Reject cliff shoulders rather than putting a long stone pedestal beside a
  // narrow benched path. The visible pole always remains vertical.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const h = heightAt(x + Math.sin(angle) * .65, z + Math.cos(angle) * .65);
    if (!Number.isFinite(h) || Math.abs(h - y) > .75) return null;
  }
  return { y, footBottom: low - GROUND_EMBED, footTop: high + .055 };
}

function planLamps(layout, heightAt) {
  const routes = layout.routes ?? [];
  const edgeDistance = roadDistanceSampler(routes);
  const anchors = [];
  for (const route of routes.filter(route => route.kind === 'mountain' || route.kind === 'cave')) {
    if (route.points.length < 2) continue;
    const profile = routeProfile(route);
    let slot = 0;
    for (let target = 1.8; target <= profile.total - 1.2; target += SPACING, slot++) {
      let anchor;
      for (const shift of [0, -1.2, 1.2, -2.2, 2.2, -3.5, 3.5, -4.5, 4.5]) {
        const d = clamp(target + shift, 1, profile.total - 1);
        if (anchors.some(previous => previous.routeId === route.id && Math.abs(previous.distanceAlong - d) < 7.5)) continue;
        const p = profile.sample(d), before = profile.sample(d - .7), after = profile.sample(d + .7);
        const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz);
        if (length < .05) continue;
        const a = { x: p.x - before.x, z: p.z - before.z };
        const b = { x: after.x - p.x, z: after.z - p.z };
        const bend = a.x * b.z - a.z * b.x;
        // Prefer the safe outside of a bend; alternate the straight stretches.
        const preferred = Math.abs(bend) > .025 ? -Math.sign(bend) : slot % 2 ? -1 : 1;
        for (const side of [preferred, -preferred]) {
          for (const margin of [.70, .84, 1.0]) {
            const offset = route.width * .5 + margin;
            const x = p.x - dz / length * side * offset, z = p.z + dx / length * side * offset;
            if (edgeDistance(x, z) < LANTERN_RADIUS + .34
              || isLighthouseReserved(x, z, 1.5) || isCaveReserved(x, z)
              || anchors.some(previous => gap(previous, { x, z }) < 4)) continue;
            const foot = footAt(x, z, heightAt);
            if (!foot) continue;
            const poleHeight = 1.54 + (anchors.length * .61803398875 % 1) * .12;
            anchor = { x, z, ...foot, routeId: route.id, kind: route.kind, side,
              distanceAlong: d, footRadius: FOOT_RADIUS, poleHeight,
              lightPosition: { x, y: foot.footTop + poleHeight + .18, z } };
            break;
          }
          if (anchor) break;
        }
        if (anchor) break;
      }
      if (anchor) anchors.push(anchor);
    }
  }
  return anchors;
}

function tintGeometry(geometry, hex) {
  const color = new THREE.Color(hex), p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const shade = .89 + Math.sin(p.getX(i) * 35.3 + p.getY(i) * 17.8 + p.getZ(i) * 29.4) * .055;
    colors[i * 3] = color.r * shade; colors[i * 3 + 1] = color.g * shade; colors[i * 3 + 2] = color.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function frameGeometry() {
  const parts = [new THREE.CylinderGeometry(.195, .12, .06, 8).translate(0, -.19, 0),
    new THREE.CylinderGeometry(.19, .19, .035, 8).translate(0, .17, 0),
    new THREE.ConeGeometry(.255, .13, 8).translate(0, .24, 0),
    new THREE.CylinderGeometry(.04, .055, .065, 8).translate(0, .33, 0)];
  for (const x of [-.12, .12]) for (const z of [-.12, .12]) {
    parts.push(new THREE.BoxGeometry(.018, .35, .018).translate(x, -.005, z));
  }
  for (const part of parts) tintGeometry(part, 0x554737);
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

/** Small trail lanterns share geometry; only four fixed lamp sites can light ground. */
export function createPathLamps(scene, { layout, heightAt } = {}) {
  if (typeof heightAt !== 'function' || !Array.isArray(layout?.routes)) {
    throw new TypeError('山径路灯需要道路布局与真实地形采样函数');
  }
  const group = new THREE.Group(); group.name = '上山路暖金路灯';
  const anchors = planLamps(layout, heightAt);
  group.userData.lampAnchors = anchors;
  const geometries = new Set(), materials = new Set();
  const dummy = new THREE.Object3D();
  function batch(name, role, geometry, material, transform) {
    geometries.add(geometry); materials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, anchors.length);
    mesh.name = name; mesh.userData.role = role;
    mesh.castShadow = false; mesh.receiveShadow = role !== 'glass' && role !== 'glow';
    anchors.forEach((anchor, i) => {
      dummy.position.set(anchor.x, anchor.y, anchor.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      transform(anchor, dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (material.vertexColors) mesh.setColorAt(i, new THREE.Color().setScalar(.93 + i * .38196601125 % 1 * .12));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (anchors.length) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
    group.add(mesh);
    return mesh;
  }
  const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .96 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .85 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .64, metalness: .48 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xca934c, roughness: .21, metalness: .03,
    transparent: true, opacity: .30, side: THREE.DoubleSide, depthWrite: false,
    emissive: 0xe4a044, emissiveIntensity: 0 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffd695, roughness: .32,
    emissive: 0xffb24b, emissiveIntensity: 0 });
  batch('路灯局部嵌坡石脚', 'foundation', tintGeometry(new THREE.CylinderGeometry(.18, FOOT_RADIUS, 1, 10).translate(0, .5, 0), 0x7b7a68), stone,
    (anchor, object) => { object.position.y = anchor.footBottom; object.scale.y = anchor.footTop - anchor.footBottom; });
  batch('路灯细木杆', 'pole', tintGeometry(new THREE.CylinderGeometry(.048, .065, 1, 8).translate(0, .5, 0), 0x66503b), wood,
    (anchor, object) => { object.position.y = anchor.footTop; object.scale.y = anchor.poleHeight; });
  batch('路灯暗铜灯帽与骨架', 'frame', frameGeometry(), copper,
    (anchor, object) => { object.position.y = anchor.lightPosition.y; });
  batch('路灯琥珀玻璃罩', 'glass', new THREE.CylinderGeometry(.154, .171, .33, 4, 1, true).rotateY(Math.PI / 4), glass,
    (anchor, object) => { object.position.y = anchor.lightPosition.y; });
  batch('路灯暖金发光芯', 'glow', new THREE.CylinderGeometry(.075, .09, .245, 8), glow,
    (anchor, object) => { object.position.y = anchor.lightPosition.y - .01; });
  const lights = Array.from({ length: 4 }, (_, index) => {
    const light = new THREE.PointLight(0xffbd68, 0, 11, 2);
    light.name = `山路照明灯池 ${index + 1}`; light.castShadow = false; light.visible = false;
    group.add(light); return light;
  });
  scene.add(group);
  let quality = 'high', disposed = false;
  const cameraPosition = new THREE.Vector3(), selectedCameraPosition = new THREE.Vector3();
  const nearest = new Int32Array(lights.length).fill(-1), distances = new Float64Array(lights.length);
  let selectionDirty = true, selectedWithCamera = false;
  function setQuality(next) {
    if (disposed) return;
    const value = Object.hasOwn(POINT_BUDGET, next) ? next : 'high';
    if (value !== quality) selectionDirty = true;
    quality = value;
    for (let i = POINT_BUDGET[quality]; i < lights.length; i++) {
      lights[i].visible = false; lights[i].intensity = 0;
    }
  }
  function update(time, environment = {}, camera) {
    if (disposed) return;
    if (environment.quality && environment.quality !== quality) setQuality(environment.quality);
    const strength = environment.artificialLightsOff ? 0 : getLighthouseLampStrength(environment.daylight);
    glow.emissiveIntensity = strength * 4.8; glass.emissiveIntensity = strength * .45;
    const budget = Math.min(POINT_BUDGET[quality], anchors.length);
    if (strength <= .0001 || budget === 0) {
      for (const light of lights) { light.visible = false; light.intensity = 0; }
      return;
    }
    const withCamera = typeof camera?.getWorldPosition === 'function';
    if (withCamera) {
      camera.getWorldPosition(cameraPosition);
      if (!selectedCameraPosition.equals(cameraPosition)) selectionDirty = true;
    }
    if (withCamera !== selectedWithCamera) selectionDirty = true;
    if (selectionDirty) {
      nearest.fill(-1); distances.fill(Infinity);
      if (withCamera) {
        // Keep just the fixed light budget, with stable ties in anchor order.
        // No per-anchor objects or whole-network sort in the animation loop.
        for (let index = 0; index < anchors.length; index++) {
          const p = anchors[index].lightPosition;
          const distance = (p.x-cameraPosition.x)**2 + (p.y-cameraPosition.y)**2 + (p.z-cameraPosition.z)**2;
          for (let slot = 0; slot < budget; slot++) if (distance < distances[slot]) {
            for (let move = budget-1; move > slot; move--) { distances[move]=distances[move-1]; nearest[move]=nearest[move-1]; }
            distances[slot]=distance; nearest[slot]=index; break;
          }
        }
        selectedCameraPosition.copy(cameraPosition);
      } else for (let index = 0; index < budget; index++) nearest[index]=Math.floor((index+.5)*anchors.length/budget);
      selectedWithCamera=withCamera; selectionDirty=false;
      for (let index = 0; index < lights.length; index++) {
        const light=lights[index], anchorIndex=nearest[index] < 0 ? undefined : nearest[index], anchor=anchors[anchorIndex];
        if (anchor && light.userData.lampIndex !== anchorIndex) light.position.set(anchor.lightPosition.x,anchor.lightPosition.y,anchor.lightPosition.z);
        light.userData.lampIndex=anchorIndex;
      }
    }
    for (let index = 0; index < lights.length; index++) {
      const light=lights[index], anchor=index < budget && nearest[index] >= 0;
      light.visible = Boolean(anchor);
      light.intensity = anchor ? strength * 9 : 0;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const light of lights) { light.visible = false; light.intensity = 0; }
    group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.removeFromParent(); group.clear();
  }
  return { group, update, setQuality, dispose };
}
