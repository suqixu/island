import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSailboatMotion } from './sailboat-motion.js';

function merged(parts) {
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

function beam(a, b, radius) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 5);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

function hullGeometry(widthScale = 1, endRise = 0) {
  const positions = [], indices = [], stations = [[-5, .28], [-4.3, .8], [-2.5, 1.2], [0, 1.3], [3.1, 1.08], [4.5, .49], [5, .025]];
  for (const [z, halfWidth] of stations) {
    const width = halfWidth * widthScale, deck = .85 + endRise * Math.pow(Math.abs(z) / 5, 3);
    positions.push(-width, deck, z, width, deck, z, width * .28, -.55, z, -width * .28, -.55, z);
  }
  for (let station = 0; station < stations.length - 1; station++) for (let side = 0; side < 4; side++) {
    const a = station * 4 + side, b = station * 4 + (side + 1) % 4;
    indices.push(a, b, b + 4, a, b + 4, a + 4);
  }
  indices.push(0, 1, 2, 0, 2, 3, 24, 26, 25, 24, 27, 26);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

function sailGeometry(polygons) {
  const positions = [];
  for (const points of polygons) {
    const centre = [points[0][0] + .30, points.reduce((sum, point) => sum + point[1], 0) / points.length,
      points.reduce((sum, point) => sum + point[2], 0) / points.length];
    for (let i = 0; i < points.length; i++) positions.push(...points[i], ...points[(i + 1) % points.length], ...centre);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

function silhouetteModels() {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const sloopMast = v(0, 13, -.4), foreMast = v(0, 13, .7), aftMast = v(0, 10.8, -2.4), fishingMast = v(0, 6.2, 1.65);
  const ribs = [];
  for (const y of [4.5, 7, 9.6]) ribs.push(beam(v(.28, y, .8), v(.28, y, 4.5), .024));
  for (const y of [4.2, 6.6, 8.8]) ribs.push(beam(v(.28, y, -2.4), v(.28, y, -4.5), .024));
  const models = [
    { style: 'sloop', name: '单桅小帆艇', parts: [
      { name: '窄壳尖艏小艇', geometry: hullGeometry() },
      { name: '单高桅与帆桁', geometry: merged([
        beam(v(0, .7, -.4), sloopMast, .07), beam(v(0, 2.05, -.4), v(0, 2.5, -4.65), .042),
        beam(v(0, .9, 3.8), v(0, 1.05, 5.35), .04),
      ]) },
      { name: '单桅三角帆', cloth: true, geometry: sailGeometry([
        [[.04, 2.05, -.4], [.04, 12.8, -.4], [.04, 2.5, -4.65]],
        [[-.04, 2.05, .15], [-.04, 11.65, .15], [-.04, 1.55, 4.65]],
      ]) },
      { name: '小艇细索', rope: true, geometry: merged([
        beam(sloopMast, v(0, .95, -4.7), .016), beam(sloopMast, v(0, 1.05, 5.35), .016),
        beam(sloopMast, v(-1.15, .85, 0), .013), beam(sloopMast, v(1.15, .85, 0), .013),
      ]) },
    ] },
    { style: 'traditional', name: '传统双桅帆船', parts: [
      { name: '上扬艏艉传统船壳', geometry: hullGeometry(1.12, .42) },
      { name: '双桅横桁与帆骨', geometry: merged([
        beam(v(0, .7, .7), foreMast, .075), beam(v(0, .7, -2.4), aftMast, .065),
        beam(v(-1.65, 10.6, .7), v(1.65, 10.6, .7), .045),
        beam(v(-1.4, 8.7, -2.4), v(1.4, 8.7, -2.4), .04),
        beam(v(0, 2.15, .7), v(0, 2.15, 4.8), .045), beam(v(0, 2.15, -2.4), v(0, 2.15, -4.75), .04), ...ribs,
      ]) },
      { name: '传统双四边帆', cloth: true, geometry: sailGeometry([
        [[.05, 2.2, .7], [.05, 12.5, .7], [.05, 10.8, 3.8], [.05, 2.2, 4.75]],
        [[.05, 2.15, -2.4], [.05, 10.35, -2.4], [.05, 9.5, -4.0], [.05, 2.15, -4.7]],
      ]) },
      { name: '传统船细索', rope: true, geometry: merged([
        beam(foreMast, v(0, 1.2, 5), .016), beam(aftMast, v(0, 1.2, -5), .016),
        beam(foreMast, aftMast, .016),
      ]) },
    ] },
    { style: 'fishing', name: '短桅渔船', parts: [
      { name: '宽短渔船壳', geometry: hullGeometry(1.18, .08) },
      { name: '低矮渔船舱', geometry: merged([
        new THREE.BoxGeometry(1.85, 1.7, 2.5).translate(0, 1.65, -.9),
        new THREE.BoxGeometry(2.12, .22, 2.8).translate(0, 2.6, -.9),
      ]) },
      { name: '渔船短桅与小帆桁', geometry: merged([
        beam(v(0, .8, 1.65), fishingMast, .07), beam(v(0, 1.9, 1.65), v(0, 1.9, 4.3), .04),
        beam(v(-.75, 3.9, 1.65), v(.75, 3.9, 1.65), .035),
      ]) },
      { name: '渔船短桅小帆', cloth: true, geometry: sailGeometry([
        [[.04, 1.95, 1.65], [.04, 5.95, 1.65], [.04, 1.95, 4.25]],
      ]) },
      { name: '渔船细索', rope: true, geometry: merged([
        beam(fishingMast, v(0, .95, 4.8), .015), beam(fishingMast, v(0, 2.6, -1), .015),
      ]) },
    ] },
  ];
  for (const model of models) {
    model.bounds = new THREE.Box3();
    for (const part of model.parts) { part.geometry.computeBoundingBox(); model.bounds.union(part.geometry.boundingBox); }
    model.size = model.bounds.getSize(new THREE.Vector3());
    model.centre = model.bounds.getCenter(new THREE.Vector3());
  }
  return models;
}

/** Four slots with three shared silhouettes, allocated once and chosen per voyage. */
export function createSailboats(scene, { heightAt, seed } = {}) {
  const group = new THREE.Group(); group.name = '远海帆船剪影'; scene.add(group);
  const motion = createSailboatMotion({ heightAt, seed });
  const models = silhouetteModels();
  const geometries = new Set(models.flatMap(model => model.parts.map(part => part.geometry))), materials = new Set();
  const dayHull = new THREE.Color('#26353b'), nightHull = new THREE.Color('#182635');
  const daySail = new THREE.Color('#efe3bf'), nightSail = new THREE.Color('#9babaf');
  const records = motion.boats.map(boat => {
    const ship = new THREE.Group(); ship.name = `远海帆船 ${boat.index + 1}`; ship.visible = false;
    ship.userData.opacity = 0; ship.userData.route = null; ship.userData.style = null; group.add(ship);
    // Motion already fades every silhouette with rain, storm and sea fog.
    // Avoid a second distance fog pass that erases even clear-weather sails.
    const timber = new THREE.MeshBasicMaterial({ color: dayHull, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const cloth = new THREE.MeshBasicMaterial({ color: daySail, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    materials.add(timber); materials.add(cloth);
    const variants = models.map(model => {
      const variant = new THREE.Group(); variant.name = model.name; variant.userData.style = model.style; variant.visible = false;
      for (const part of model.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.cloth ? cloth : timber); mesh.name = part.name; mesh.renderOrder = 2;
        mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.rope = Boolean(part.rope); variant.add(mesh);
      }
      ship.add(variant); return { model, variant };
    });
    return { boat, ship, timber, cloth, variants, lastRoute: null };
  });
  let disposed = false;
  return {
    group,
    update(elapsed, env = {}, camera) {
      if (disposed) return;
      motion.advance(elapsed, env, camera);
      const daylight = Number.isFinite(env?.daylight) ? Math.max(0, Math.min(1, env.daylight)) : 1;
      for (const record of records) {
        const { boat, ship, timber, cloth, variants } = record;
        const { pose, route } = boat;
        ship.visible = pose.visible;
        ship.userData.opacity = pose.opacity; ship.userData.route = route;
        if (route !== record.lastRoute) {
          // Motion assigns a new voyage only while this slot has zero opacity.
          // Normalize the complete selected model, including yards and cabin,
          // into exactly the dimensions checked by its world-space route.
          for (const { model, variant } of variants) {
            variant.visible = route?.style === model.style;
            if (!variant.visible) continue;
            variant.scale.set(route.beam / model.size.x, route.height / model.bounds.max.y, route.length / model.size.z);
            variant.position.set(-model.centre.x * variant.scale.x, 0, -model.centre.z * variant.scale.z);
          }
          ship.userData.style = route?.style ?? null; record.lastRoute = route;
        }
        if (!route) continue;
        ship.position.set(pose.x, pose.y, pose.z);
        ship.rotation.set(pose.pitch, pose.heading, pose.roll, 'YXZ');
        timber.opacity = pose.opacity * .96; cloth.opacity = pose.opacity * .96;
        timber.color.copy(nightHull).lerp(dayHull, daylight);
        cloth.color.copy(nightSail).lerp(daySail, daylight);
      }
    },
    setQuality(quality) {
      if (disposed) return;
      for (const { variants } of records) for (const { variant } of variants)
        for (const mesh of variant.children) if (mesh.userData.rope) mesh.visible = quality !== 'low';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.removeFromParent(); group.clear();
    },
  };
}
