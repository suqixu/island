import { LAGOON_LAYOUT } from './lagoon.js';

const TAU = Math.PI * 2, c = Math.cos(LAGOON_LAYOUT.rotation), s = Math.sin(LAGOON_LAYOUT.rotation);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const random = seed => { const n = Math.sin(seed * 127.1 + 39.7) * 43758.5453; return n - Math.floor(n); };
const sample = (heightAt, x, z) => {
  const height = typeof heightAt === 'function' ? heightAt(x, z) : NaN;
  return Number.isFinite(height) ? height : Infinity;
};
const world = (u, v) => [LAGOON_LAYOUT.center[0] + c * u - s * v, LAGOON_LAYOUT.center[1] + s * u + c * v];
function routeAt(home, angle) {
  const u = home.u + Math.cos(angle) * home.a, v = home.v + Math.sin(angle) * home.b;
  const [x, z] = world(u, v), du = -Math.sin(angle) * home.a, dv = Math.cos(angle) * home.b;
  return { x, z, heading: Math.atan2(c * du - s * dv, s * du + c * dv), rho: Math.hypot(u / 25, v / 18) };
}
function footprint(heightAt, x, z, radius) {
  let highest = sample(heightAt, x, z);
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * TAU;
    highest = Math.max(highest, sample(heightAt, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius));
  }
  return highest;
}
function safeRoute(home, heightAt) {
  const swim = home.kind === 'fish' || home.kind === 'turtle';
  for (let step = 0; step < 128; step++) {
    const point = routeAt(home, step / 128 * TAU), floor = footprint(heightAt, point.x, point.z, home.radius);
    if (point.rho > (swim ? .79 : 1.045) || !Number.isFinite(floor)) return false;
    if (swim && floor >= -home.heightRadius * 2 - .28) return false;
    if (!swim && floor > (home.kind === 'crab' ? .32 : -.75)) return false;
  }
  return true;
}

/** Validate a complete loop once, retaining fixed habitat and seed throughout animation. */
export function createLagoonHabitats(heightAt, seed = 7319) {
  seed = finite(seed, 7319);
  const rand = salt => random(seed * .371 + salt * 1.618);
  const residents = { fish: [], turtle: [], crab: [], lobster: [] };
  for (const [kind, count] of [['fish', 42], ['turtle', 3], ['crab', 8], ['lobster', 5]]) {
    for (let index = 0; index < count; index++) {
      const school = kind === 'fish' ? Math.floor(index / 14) : index;
      const member = index % 14, salt = index + { fish: 100, turtle: 700, crab: 1100, lobster: 1700 }[kind];
      const length = kind === 'fish' ? .64 + rand(salt + 31) * .34
        : kind === 'turtle' ? 1.28 + rand(salt + 31) * .4 : .44 + rand(salt + 31) * .14;
      let u, v, a, b;
      if (kind === 'fish') {
        [u, v] = [[-3, -4], [8, 1], [-5, 6]][school];
        u += (rand(school + 43) - .5) * 2 + (rand(salt + 2) - .5) * 2.4;
        v += (rand(school + 61) - .5) * 1.5 + (rand(salt + 3) - .5) * 1.6;
        a = 5.1; b = 3.2;
      } else if (kind === 'turtle') {
        [u, v] = [[0, 3], [4, -3], [-6, 1]][index]; a = 7.4; b = 4.9;
      } else if (kind === 'crab') {
        // First four occupy the inner wet shore; others forage on the shallow sand floor.
        u = index < 4 ? -3.6 + index * .67 : 5 + (index - 4) * 1.5;
        v = index < 4 ? 16.2 + (index % 2) * .25 : 12.5;
        a = index < 4 ? .4 : .8; b = index < 4 ? .22 : .45;
      } else { u = -1 + index * 1.8; v = 11.2 + (index % 2) * 1.2; a = .9; b = .55; }
      if (kind !== 'fish') { u += (rand(salt + 5) - .5) * .7; v += (rand(salt + 6) - .5) * .5; }
      const home = { kind, index, school, length, u, v, a, b, seed,
        radius: length * (kind === 'turtle' ? .61 : kind === 'fish' ? .58 : .6),
        heightRadius: length * (kind === 'turtle' ? .235 : .23),
        phase: kind === 'fish' ? rand(school + 79) * TAU + (rand(salt + 7) - .5) * .26 : rand(salt + 7) * TAU,
        rate: kind === 'fish' ? .135 + rand(school + 83) * .035 : kind === 'turtle' ? .061 + rand(salt + 9) * .012 : .055,
        limbPhase: rand(salt + 11) * TAU, restOffset: rand(salt + 13) * 14,
        depth: kind === 'turtle' ? 1.15 : .82 + school * .25 + rand(salt + 15) * .18 };
      for (let attempt = 0; attempt < 18; attempt++) {
        if (safeRoute(home, heightAt)) { residents[kind].push(home); break; }
        // Select a smaller basin loop before animation starts, never teleport a moving animal.
        home.u *= .94; home.v *= .94; home.a *= .96; home.b *= .96;
      }
    }
  }
  return residents;
}

/** Absolute elapsed seconds drive motion even when the day/night clock is paused. */
export function getLagoonResidentPose(time, home, heightAt) {
  if (!home) return { position: [50, -2, 75], visible: false };
  const t = Math.max(0, finite(time)), swim = home.kind === 'fish' || home.kind === 'turtle';
  let travel = t, walking = true, gaitAmount = 1;
  if (!swim) {
    const clock = t + home.restOffset, cycle = Math.floor(clock / 14), age = clock % 14;
    const p = clamp(age / 8, 0, 1), eased = p * p * p * (p * (p * 6 - 15) + 10);
    travel = cycle * 14 + eased * 14; walking = age < 8;
    gaitAmount = 16 * p * p * (1 - p) * (1 - p);
  }
  const angle = home.phase + travel * home.rate, { x, z, heading } = routeAt(home, angle);
  const limb = home.limbPhase + (swim ? t : travel) * (swim ? 3.7 : 2.1);
  if (swim) {
    const highest = footprint(heightAt, x, z, home.radius);
    const desired = -home.depth + Math.sin(t * .33 + home.phase) * .12;
    const y = clamp(desired, highest + home.heightRadius + .11, -home.heightRadius - .12);
    return { position: [x, y, z], heading, pitch: 0, roll: 0,
      tail: Math.sin(limb) * .28, flipper: Math.sin(t * 2.7 + home.limbPhase) * .43,
      visible: Number.isFinite(highest) && highest < -home.heightRadius * 2 - .23 };
  }
  const floor = sample(heightAt, x, z);
  const dx = (sample(heightAt, x + .15, z) - sample(heightAt, x - .15, z)) / .3;
  const dz = (sample(heightAt, x, z + .15) - sample(heightAt, x, z - .15)) / .3;
  let bump = 0;
  for (let i = 0; i < 8; i++) {
    const ox = Math.cos(i / 8 * TAU) * home.length * .32, oz = Math.sin(i / 8 * TAU) * home.length * .32;
    bump = Math.max(bump, sample(heightAt, x + ox, z + oz) - floor - dx * ox - dz * oz);
  }
  const bodyHeading = heading - (home.kind === 'crab' ? Math.PI * .5 : 0);
  const forwardSlope = dx * Math.sin(bodyHeading) + dz * Math.cos(bodyHeading);
  const sideSlope = dx * Math.cos(bodyHeading) - dz * Math.sin(bodyHeading);
  return { position: [x, floor + .018 + bump, z], heading: bodyHeading,
    pitch: Math.atan(forwardSlope), roll: Math.atan(sideSlope), walking,
    legs: Array.from({ length: home.kind === 'crab' ? 8 : 10 }, (_, i) => Math.sin(limb + Math.floor(i / 2) * Math.PI) * (i % 2 ? -1 : 1) * gaitAmount),
    claw: Math.sin(t * 1.15 + home.limbPhase) * .13,
    antenna: Math.sin(t * 1.7 + home.limbPhase) * .1,
    tail: Math.sin(t * .9 + home.limbPhase) * .08,
    visible: Number.isFinite(floor) };
}
