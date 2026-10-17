import * as THREE from 'three';
import { heightAt as terrainHeight, seededRandom } from './terrain.js';

const TAU = Math.PI * 2;
// Enlarge the distant silhouettes before checking the complete voyage envelope.
const SILHOUETTE_SCALE = 2.4;
const PROFILES = Object.freeze([
  Object.freeze({ style: 'sloop', length: [7, 11.5], height: [10, 14], beamRatio: .26 }),
  Object.freeze({ style: 'traditional', length: [10, 13], height: [12, 16], beamRatio: .33 }),
  Object.freeze({ style: 'fishing', length: [7.5, 11.5], height: [5.5, 8.5], beamRatio: .31 }),
]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value, fallback = 0) => Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
const smooth = (value, low, high) => {
  const t = unit((value - low) / (high - low)); return t * t * (3 - 2 * t);
};

/** Check the swept hull, including its edges, before accepting a whole voyage. */
export function isSailboatRouteSafe(heightAt, route) {
  if (typeof heightAt !== 'function' || !route || !['x', 'z', 'heading', 'speed', 'duration', 'length', 'beam']
    .every(key => Number.isFinite(route[key]))) return false;
  if (route.duration <= 0 || route.speed < 0 || route.length <= 0 || route.beam <= 0) return false;
  const sin = Math.sin(route.heading), cos = Math.cos(route.heading);
  const halfLength = route.length / 2 + .8, halfBeam = route.beam / 2 + .25;
  const travel = route.speed * route.duration;
  // Overlapping longitudinal samples sweep every part of the moving hull;
  // a safe centre or two safe endpoints alone cannot establish a safe voyage.
  const alongCount = Math.max(1, Math.ceil((travel + halfLength * 2) / 1.7));
  const acrossCount = Math.max(2, Math.ceil(halfBeam * 2 / .4));
  for (let along = 0; along <= alongCount; along++) for (let across = 0; across <= acrossCount; across++) {
    const forward = -halfLength + (travel + halfLength * 2) * along / alongCount;
    const side = -halfBeam + halfBeam * 2 * across / acrossCount;
    const x = route.x + sin * forward + cos * side;
    const z = route.z + cos * forward - sin * side;
    const radius = Math.hypot(x, z), bed = heightAt(x, z);
    if (radius < 600 || radius > 1300 || !Number.isFinite(bed) || bed >= -5) return false;
  }
  return true;
}

/** Four fixed slots; world routes change only after the previous fade is zero. */
export function createSailboatMotion({ heightAt = terrainHeight, seed } = {}) {
  const random = seededRandom(Number.isFinite(seed) ? seed : Math.floor(Math.random() * 4294967296));
  const boats = Array.from({ length: 4 }, (_, index) => ({ index, route: null,
    pose: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, opacity: 0, visible: false } }));
  const cameraPosition = new THREE.Vector3(), view = new THREE.Vector3(), corner = new THREE.Vector3();
  const sight = new THREE.Vector3();
  let lastTime = null, round = -1, phase = 'new', endTime = 0, nextTime = 0, weatherOpacity = 1;

  function clearSight(x, y, z) {
    const distance = Math.hypot(x - cameraPosition.x, z - cameraPosition.z);
    const count = Math.max(1, Math.ceil(distance / 3));
    for (let i = 1; i < count; i++) {
      sight.set(x, y, z).lerp(cameraPosition, 1 - i / count);
      const ground = heightAt(sight.x, sight.z);
      if (!Number.isFinite(ground) || ground > sight.y - .35) return false;
    }
    return true;
  }

  function routeInView(route, camera) {
    const sin = Math.sin(route.heading), cos = Math.cos(route.heading);
    for (const age of [0, route.duration / 2, route.duration]) {
      const x = route.x + sin * route.speed * age, z = route.z + cos * route.speed * age;
      corner.set(x, 2, z).project(camera);
      // Reserve the centre for the island and moon; distant side-water remains
      // in world space even when the user subsequently turns the camera.
      if (Math.abs(corner.x) < .27 || Math.abs(corner.x) > .81) return false;
      for (const along of [-route.length / 2 - .8, route.length / 2 + .8])
        for (const side of [-route.beam / 2 - .25, route.beam / 2 + .25])
          for (const y of [-.85, route.height + .65]) {
            corner.set(x + sin * along + cos * side, y,
              z + cos * along - sin * side).project(camera);
            if (Math.abs(corner.x) >= .9 || corner.y <= -.74 || corner.y >= .76 || corner.z <= -1 || corner.z >= 1) return false;
          }
      if (!clearSight(x, .7, z) || !clearSight(x, route.height, z)) return false;
    }
    return true;
  }

  function chooseRoute(camera, duration, start, others) {
    if (!camera?.isCamera) return null;
    camera.updateWorldMatrix(true, false); camera.getWorldPosition(cameraPosition); camera.getWorldDirection(view);
    const yaw = Math.atan2(view.x, view.z);
    // Prefer distinct silhouettes within a small cohort; a fourth boat may
    // repeat a style while retaining independently sampled dimensions.
    const unused = PROFILES.filter(profile => !others.some(other => other.style === profile.style));
    const available = unused.length ? unused : PROFILES;
    const profile = available[Math.floor(random() * available.length)];
    for (let attempt = 0; attempt < 100; attempt++) {
      const azimuth = random() * TAU, radius = 730 + random() * 365;
      const heading = yaw + Math.PI / 2 + (random() < .5 ? Math.PI : 0) + (random() - .5) * .64;
      const length = (profile.length[0] + random() * (profile.length[1] - profile.length[0])) * SILHOUETTE_SCALE;
      const route = { x: Math.sin(azimuth) * radius, z: Math.cos(azimuth) * radius, heading,
        speed: .22 + random() * .43,
        duration, start, style: profile.style, length, beam: length * profile.beamRatio * (.92 + random() * .16),
        height: (profile.height[0] + random() * (profile.height[1] - profile.height[0])) * SILHOUETTE_SCALE,
        phase: random() * TAU, cycle: round };
      if (others.some(other => {
        // Separate the complete pair of trajectories, including opposing courses.
        for (const age of [0, .5, 1]) {
          const x = route.x + Math.sin(route.heading) * route.speed * duration * age;
          const z = route.z + Math.cos(route.heading) * route.speed * duration * age;
          const ox = other.x + Math.sin(other.heading) * other.speed * other.duration * age;
          const oz = other.z + Math.cos(other.heading) * other.speed * other.duration * age;
          if (Math.hypot(x - ox, z - oz) < 90) return true;
        }
        return false;
      })) continue;
      if (routeInView(route, camera) && isSailboatRouteSafe(heightAt, route)) return Object.freeze(route);
    }
    return null;
  }

  function beginRound(now, camera) {
    round++;
    const chance = random(), count = round === 0 ? 2 + Math.floor(chance * 2) : chance < .09 ? 0 : 1 + Math.floor(random() * 4);
    const duration = count ? 175 + random() * 100 : 35 + random() * 30;
    const start = now + (round === 0 ? 1.5 : 3 + random() * 4);
    const accepted = [];
    for (const boat of boats) {
      boat.route = boat.index < count ? chooseRoute(camera, duration * (.84 + random() * .16),
        start + boat.index * 1.2 + random() * .8, accepted) : null;
      if (boat.route) accepted.push(boat.route);
      boat.pose.opacity = 0; boat.pose.visible = false;
    }
    endTime = start + duration + 5;
    nextTime = endTime + 16 + random() * 24;
    phase = 'active';
  }

  return {
    boats,
    advance(elapsed, env = {}, camera) {
      const supplied = Number.isFinite(elapsed) ? Math.max(0, elapsed) : lastTime ?? 0;
      const now = Math.max(supplied, lastTime ?? supplied), delta = lastTime === null ? 0 : now - lastTime;
      const weather = (1 - smooth(unit(env?.fog), .3, .9)) * (1 - unit(env?.storm) * .78) * (1 - unit(env?.rain) * .35);
      weatherOpacity = lastTime === null ? weather : weather + (weatherOpacity - weather) * Math.exp(-delta / 1.2);
      lastTime = now;
      if (phase === 'new' || phase === 'gap' && now >= nextTime) beginRound(now, camera);
      else if (phase === 'active' && now >= endTime) phase = 'gap';
      for (const boat of boats) {
        const route = boat.route, pose = boat.pose;
        if (!route) { pose.opacity = 0; pose.visible = false; continue; }
        const age = now - route.start, travelAge = clamp(age, 0, route.duration);
        pose.x = route.x + Math.sin(route.heading) * route.speed * travelAge;
        pose.z = route.z + Math.cos(route.heading) * route.speed * travelAge;
        pose.y = .3 + Math.sin(now * .55 + route.phase) * .12;
        pose.heading = route.heading;
        pose.pitch = Math.sin(now * .39 + route.phase) * .006;
        pose.roll = Math.sin(now * .47 + route.phase + .7) * .009;
        pose.opacity = phase === 'active' ? smooth(age, 0, 8) * (1 - smooth(age, route.duration - 14, route.duration)) * weatherOpacity : 0;
        if (pose.opacity < .0001) pose.opacity = 0;
        pose.visible = pose.opacity > 0;
      }
      return boats;
    },
  };
}
