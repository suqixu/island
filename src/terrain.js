import { applyLagoonHeight } from './lagoon.js';

// A deterministic continuous height field, shared by terrain, vegetation and water.
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (n) => n - Math.floor(n);

export function hash(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7 + 19.17) * 43758.5453123);
}

export function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x, z) {
  return noise(x, z) * 0.55 + noise(x * 2.06 + 8.4, z * 2.06 - 3.1) * 0.27
    + noise(x * 4.13 - 12, z * 4.13 + 7) * 0.12 + noise(x * 8.29, z * 8.29) * 0.06;
}

export function coastRadius(angle) {
  return 77 + 5.6 * Math.sin(angle * 3 + 0.6) + 3.8 * Math.sin(angle * 5 - 1.1)
    + 2.4 * Math.cos(angle * 9 + 0.8) + 1.3 * Math.sin(angle * 13 - 0.3);
}

export function shoreDistance(x, z) {
  return coastRadius(Math.atan2(z, x)) - Math.hypot(x * 1.025, z * 0.975);
}

function naturalHeightAt(x, z, distance) {
  if (distance < 0) {
    const shelf = -0.09 + distance * 0.105 - smooth(-5, -48, distance) * 7.8;
    return shelf + fbm(x * 0.065, z * 0.065) * smooth(0, 18, -distance) * 0.45;
  }
  // Broad, gently rising pale beaches surround steeper volcanic slopes.
  const beach = 0.1 + distance * 0.175 + noise(x * 0.6, z * 0.6) * 0.035;
  const nx = x + fbm(x * 0.035 + 4, z * 0.035) * 4;
  const nz = z + fbm(x * 0.04 - 6, z * 0.04 + 2) * 4;
  const peak = (cx, cz, sx, sz, h) => h * Math.exp(-Math.pow((nx - cx) ** 2 / sx ** 2 + (nz - cz) ** 2 / sz ** 2, 0.82));
  const mountain = Math.max(peak(-17, -9, 23, 27, 42), peak(16, -22, 21, 22, 38), peak(11, 19, 22, 20, 31));
  const mountainMask = smooth(6, 23, mountain);
  // A broken diagonal spine links the two principal summits. Domain-warped
  // channels and narrower outcrops carve the shoulders without noisy spikes.
  const axis = nz + nx * 0.38 + 15 + fbm(nx * 0.07, nz * 0.07) * 2.6;
  const spine = Math.exp(-axis * axis / 25 - (nx + 1) ** 2 / 1050) * 4.4;
  const ridge = Math.pow(1 - Math.abs(fbm(nx * 0.063, nz * 0.063)), 3) * 3.8;
  const erosion = -Math.pow(Math.abs(fbm(nx * 0.049 + 73, nz * 0.055 - 15)), 1.1) * 7.2;
  const warpX = nx + noise(nx * 0.065, nz * 0.065 + 31) * 3.2;
  const warpZ = nz + noise(nx * 0.073 - 11, nz * 0.073) * 2.8;
  const outcrops = (Math.pow(1 - Math.abs(noise(warpX * 0.13, warpZ * 0.13)), 4) - 0.45) * 4.8;
  const detail = fbm(nx * 0.19, nz * 0.19) * 1.55 + noise(nx * 0.62, nz * 0.62) * 0.46;
  const inland = 3.1 + mountain + ridge + detail * (0.4 + mountainMask * 0.6)
    + (spine + erosion + outcrops) * mountainMask;
  const exposed = smooth(-5, 37, x) * smooth(-27, 20, -z) * 0.55;
  const blend = smooth(7 - exposed * 4, 25 - exposed * 9, distance);
  return beach * (1 - blend) + inland * blend;
}

export function heightAt(x, z) {
  const distance = shoreDistance(x, z);
  return applyLagoonHeight(x, z, naturalHeightAt(x, z, distance), distance);
}

export function slopeAt(x, z) {
  const dx = (heightAt(x + 0.65, z) - heightAt(x - 0.65, z)) / 1.3;
  const dz = (heightAt(x, z + 0.65) - heightAt(x, z - 0.65)) / 1.3;
  return Math.hypot(dx, dz);
}

export function seededRandom(seed = 12345) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export { clamp, smooth, TAU };
