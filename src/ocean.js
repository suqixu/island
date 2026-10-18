import * as THREE from 'three';
import { runStartupGenerator } from './startup-tasks.js';
import { createCleanupScope } from './cleanup-scope.js';
import { getAnimationDelta } from './animation-time.js';
import { createOceanFoamTexture } from './ocean-foam.js';
import { TYPHOON_WAVES_GLSL } from './typhoon-waves.js';
import { createOceanSpray } from './ocean-spray.js';
import { createCameraWaterSampler } from './ocean-height.js';
import { BEACH_SWASH_GLSL } from './beach-swash.js';
import { getSunVisibility } from './sun-framing.js';
import { getSunsetState } from './sunset.js';
import { getSeaHorizonState, SEA_HORIZON_GLSL } from './sea-horizon.js';
import { SEABED_TRANSMISSION_GLSL, OFFSHORE_BLEND_GLSL } from './ocean-optics.js';

const COAST_EXTENT = 240;
const COAST_RESOLUTION = 768;
const MAX_DEPTH = 48;

// Baking bathymetry once keeps the shoreline fixed while the water moves.
function* buildBathymetry(heightAt, shelterAt, signal) {
  const size = COAST_RESOLUTION;
  const bytes = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const distance = new Float32Array(size * size);
  const exposure = new Float32Array(size * size);
  const step = COAST_EXTENT * 2 / (size - 1);
  let hasSeabed = false;

  yield { stage: 'ocean-sampling' };
  for (let z = 0; z < size; z++) {
    throwIfAborted(signal);
    for (let x = 0; x < size; x++) {
      const index = z * size + x;
      const wx = (x / (size - 1) - 0.5) * COAST_EXTENT * 2;
      const wz = (z / (size - 1) - 0.5) * COAST_EXTENT * 2;
      const sampled = heightAt?.(wx, wz);
      const height = Number.isFinite(sampled) ? sampled : -Math.max(0, Math.hypot(wx, wz) - 70) * 0.28;
      heights[index] = height;
      const shelter = shelterAt?.(wx, wz);
      exposure[index] = 1 - THREE.MathUtils.clamp(Number.isFinite(shelter) ? shelter : 0, 0, 1) * .72;
      distance[index] = height > -0.05 ? 0 : 10000;
      if (height < -1) hasSeabed = true;
    }
    yield;
  }

  // A chamfer field measures shore distance independently of sea-floor slope.
  const diagonal = step * Math.SQRT2;
  yield { stage: 'ocean-distance-forward' };
  for (let z = 0; z < size; z++) {
    throwIfAborted(signal);
    for (let x = 0; x < size; x++) {
      const i = z * size + x;
      if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + step);
      if (z > 0) distance[i] = Math.min(distance[i], distance[i - size] + step);
      if (x > 0 && z > 0) distance[i] = Math.min(distance[i], distance[i - size - 1] + diagonal);
      if (x < size - 1 && z > 0) distance[i] = Math.min(distance[i], distance[i - size + 1] + diagonal);
    }
    yield;
  }
  yield { stage: 'ocean-distance-backward' };
  for (let z = size - 1; z >= 0; z--) {
    throwIfAborted(signal);
    for (let x = size - 1; x >= 0; x--) {
      const i = z * size + x;
      if (x < size - 1) distance[i] = Math.min(distance[i], distance[i + 1] + step);
      if (z < size - 1) distance[i] = Math.min(distance[i], distance[i + size] + step);
      if (x < size - 1 && z < size - 1) distance[i] = Math.min(distance[i], distance[i + size + 1] + diagonal);
      if (x > 0 && z < size - 1) distance[i] = Math.min(distance[i], distance[i + size - 1] + diagonal);
    }
    yield;
  }

  const halfHeights = new Uint16Array(heights.length);
  yield { stage: 'ocean-packing' };
  for (let row = 0; row < size; row++) {
    throwIfAborted(signal);
    for (let i = row * size; i < (row + 1) * size; i++) {
      const depth = hasSeabed ? Math.max(0, -heights[i]) : distance[i] * 0.44;
      bytes[i * 4] = Math.round(THREE.MathUtils.clamp(depth / MAX_DEPTH, 0, 1) * 255);
      bytes[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(distance[i] / 32, 0, 1) * 255);
      bytes[i * 4 + 2] = Math.round(THREE.MathUtils.clamp((heights[i] + 80) / 160, 0, 1) * 255);
      // The existing alpha channel carries exposure without another texture.
      bytes[i * 4 + 3] = Math.round(exposure[i] * 255);
      halfHeights[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    }
    yield;
  }
  throwIfAborted(signal);
  return { bytes, halfHeights };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Ocean startup cancelled', 'AbortError');
}

function createBathymetry({ bytes, halfHeights }) {
  const size = COAST_RESOLUTION;
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  // R16F preserves millimetre-scale depth near sea level; the old 8-bit
  // height channel has 63cm steps and cannot place a thin swash film.
  const heightMap=new THREE.DataTexture(halfHeights,size,size,THREE.RedFormat,THREE.HalfFloatType);
  heightMap.name='浅滩连续高度';heightMap.minFilter=heightMap.magFilter=THREE.LinearFilter;
  heightMap.generateMipmaps=false;heightMap.needsUpdate=true;
  return {texture,heightMap};
}

// Exponentially spaced rings spend geometry at the island, not at the horizon.
function createOceanGeometry() {
  const rings = 192;
  const slices = 256;
  const radius = 7200;
  const positions = [0, 0, 0];
  const indices = [];
  const expansion = Math.log(1 + radius / 5);
  for (let ring = 1; ring <= rings; ring++) {
    // Only the outer ring reaches the visual horizon; near-shore resolution
    // remains intact and the rising/setting disc meets the sea without a gap.
    const r = ring === rings ? 60000 : (Math.exp(expansion * ring / rings) - 1) * 5;
    for (let slice = 0; slice <= slices; slice++) {
      const angle = slice / slices * Math.PI * 2;
      positions.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    }
  }
  for (let s = 0; s < slices; s++) indices.push(0, s + 2, s + 1);
  for (let ring = 1; ring < rings; ring++) {
    const row = 1 + (ring - 1) * (slices + 1);
    for (let slice = 0; slice < slices; slice++) {
      const a = row + slice;
      const b = a + slices + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const vertexShader = /* glsl */ `
  ${BEACH_SWASH_GLSL}
  ${OFFSHORE_BLEND_GLSL}
  uniform float uTime;
  uniform float uWaveTime;
  uniform float uTyphoon;
  uniform float uWind;
  uniform float uStorm;
  uniform float uSwell;
  uniform float uGust;
  uniform vec2 uWindDirection;
  uniform sampler2D uBathymetry;
  uniform sampler2D uTerrainHeight;
  uniform vec2 uCoastUvTransform;
  uniform float uCoastExtent;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vCrest;
  varying float vBreaking;
  varying vec2 vSurfacePosition;

  float waveHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float waveNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(waveHash(i), waveHash(i + vec2(1.0, 0.0)), u.x),
               mix(waveHash(i + vec2(0.0, 1.0)), waveHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  vec2 waterDepthExposure(vec2 point) {
    vec2 uv = point / (uCoastExtent * 2.0) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(48.0, 1.0);
    uv=uv*uCoastUvTransform.x+uCoastUvTransform.y;
    vec4 bathymetry = texture2D(uBathymetry, uv);
    float edgeBlend = offshoreBlend(point, uCoastExtent);
    float floorHeight=texture2D(uTerrainHeight,uv).r;
    return mix(vec2(max(-floorHeight,0.0),bathymetry.a),vec2(48.0,1.0),edgeBlend);
  }

  vec2 turn(vec2 direction, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec2(c * direction.x - s * direction.y, s * direction.x + c * direction.y);
  }

  void wave(inout vec3 p, inout vec3 tangent, inout vec3 binormal,
            vec2 direction, float wavelength, float amplitude, float speed,
            float seed, vec2 base, float coast, float depth, float exposure,
            inout float crest, inout float breaking) {
    vec2 d = normalize(direction);
    float k = 6.28318530718 / wavelength;
    float phase = waveNoise(base * 0.024 + d * seed + vec2(uTime * 0.005, -uTime * 0.003));
    float group = waveNoise(base * 0.008 - d * uWaveTime * 0.014 + vec2(seed, seed * 0.37));
    float envelope = 0.62 + group * 0.63;
    float f = k * (dot(d, base) - speed * uWaveTime) + (phase - 0.5) * 2.6 + seed;
    // Ring spacing grows offshore. Wavelengths below that spacing must live
    // in the fragment normal field, otherwise they alias into a mesh pattern.
    float meshSpacing = max(length(base) * 0.04, 0.2);
    float resolved = 1.0 - smoothstep(wavelength * 0.22, wavelength * 0.55, meshSpacing);
    float energy = 0.72 + uWind * 1.08 + uStorm * 0.65 + uSwell * 0.48 + uGust * 0.2;
    float a = amplitude * coast * resolved * energy * envelope;
    // Eight components together stay below a third of the local depth.
    // At the beach the geometry settles; swash is carried by the foam field.
    a = min(a, max(0.0, depth - 0.1) * 0.04 * exposure);
    float s = sin(f), c = cos(f);
    // Bound the summed horizontal steepness to avoid folding the surface.
    float horizontal = min(a * 0.52, 0.085 / k);
    p.xz += d * horizontal * c;
    p.y += a * s;
    tangent += vec3(-d.x * d.x * horizontal * k * s, d.x * a * k * c, -d.x * d.y * horizontal * k * s);
    binormal += vec3(-d.x * d.y * horizontal * k * s, d.y * a * k * c, -d.y * d.y * horizontal * k * s);
    crest += s * a;
    breaking += pow(max(s, 0.0), 7.0) * a * k;
  }

  ${TYPHOON_WAVES_GLSL}
  void main() {
    vec3 p = position;
    vec2 base = position.xz;
    vec2 seabed = waterDepthExposure(base);
    float depth = seabed.x, exposure = seabed.y;
    float distanceToCamera = length(position.xz - cameraPosition.xz);
    float coast = smoothstep(0.1, 6.0, depth);
    coast *= 1.0 + (1.0 - smoothstep(3.0, 12.0, depth)) * 0.3;
    coast *= mix(1.0, 0.28, smoothstep(180.0, 1000.0, distanceToCamera));
    coast *= exposure;
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    float crest = 0.0;
    float breaking = 0.0;
    wave(p, tangent, binormal, turn(uWindDirection, 0.12), 76.0, 0.90, 8.3, 2.3, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, -0.37), 44.0, 0.58, 7.0, 5.9, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, 0.58), 28.0, 0.40, 5.2, 9.2, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, -0.72), 18.0, 0.25, 4.2, 13.7, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, 0.34), 9.6, 0.125, 3.1, 17.4, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, -1.12), 5.0, 0.065, 2.3, 21.6, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, 1.48), 3.0, 0.035, 1.9, 27.1, base, coast, depth, exposure, crest, breaking);
    wave(p, tangent, binormal, turn(uWindDirection, 1.18), 62.0, 0.35, 7.6, 31.8, base, coast, depth, exposure, crest, breaking);
    vec2 floorUv=clamp(base/(uCoastExtent*2.0)+0.5,0.0,1.0);
    floorUv=floorUv*uCoastUvTransform.x+uCoastUvTransform.y;
    float landHeight=texture2D(uTerrainHeight,floorUv).r;
    p.y+=beachSwashHeight(base,uTime,depth,exposure,uTyphoon)*(1.0-smoothstep(0.5,1.2,landHeight));
    if (uTyphoon > 0.001) {
      vec3 surge = surgeSurface(base, depth, exposure);
      vec2 uv = base / (uCoastExtent * 2.0) + 0.5;
      float landMask = 1.0 - smoothstep(0.2, 2.8, landHeight);
      p.y += surge.x * landMask;
      tangent.y += surge.y * landMask;
      binormal.y += surge.z * landMask;
    }
    vNormal = normalize(cross(binormal, tangent));
    vCrest = crest;
    vBreaking = breaking;
    vSurfacePosition = base;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  ${BEACH_SWASH_GLSL}
  ${SEABED_TRANSMISSION_GLSL}
  ${OFFSHORE_BLEND_GLSL}
  uniform float uTime;
  uniform float uWaveTime;
  uniform float uTyphoon;
  uniform float uWind;
  uniform float uSwell;
  uniform float uGust;
  uniform vec2 uWindDirection;
  uniform vec2 uFlowOffset;
  uniform float uDaylight;
  uniform float uCloudiness;
  uniform float uSkyCloudCover;
  uniform float uStorm;
  uniform float uFog;
  uniform float uWaterClarity;
  uniform float uSunHeight;
  uniform float uSunVisibility;
  uniform vec3 uSunDirection;
  uniform vec3 uMoonDirection;
  uniform float uMoonLight;
  uniform vec3 uMoonTint;
  uniform float uLunarWorldTint;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uSunColor;
  uniform float uSunsetGlow;
  uniform float uSunsetHorizonMix;
  uniform float uSunsetZenithMix;
  uniform vec3 uSunsetHorizonColor;
  uniform vec3 uSunsetZenithColor;
  uniform vec3 uSunsetCloudGold;
  uniform vec3 uSunsetCloudRose;
  uniform vec3 uSunsetCloudShadow;
  uniform sampler2D uBathymetry;
  uniform sampler2D uTerrainHeight;
  uniform vec2 uCoastUvTransform;
  uniform sampler2D uFoamMap;
  uniform float uFoamReady;
  uniform float uCoastExtent;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vCrest;
  varying float vBreaking;
  varying vec2 vSurfacePosition;

  ${SEA_HORIZON_GLSL}

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    return noise(p) * 0.57 + noise(p * 2.03 + 13.2) * 0.28 + noise(p * 4.17 + 7.1) * 0.15;
  }
  // The same value noise as the vertex waves, including its analytic gradient.
  // Interpolating vertex normals/crest masks loses short waves on the radial
  // mesh. Reconstructing this spectrum per pixel keeps reflections and foam
  // attached to a narrow moving crest instead of a blurred triangle patch.
  vec3 waveNoiseGradient(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return vec3(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
                mix(b - a, d - c, u.y) * du.x,
                mix(c - a, d - b, u.x) * du.y);
  }
  vec3 fbmGradient(vec2 p) {
    vec3 a = waveNoiseGradient(p);
    vec3 b = waveNoiseGradient(p * 2.03 + 13.2);
    vec3 c = waveNoiseGradient(p * 4.17 + 7.1);
    return vec3(a.x * 0.57 + b.x * 0.28 + c.x * 0.15,
                a.yz * 0.57 + b.yz * (0.28 * 2.03) + c.yz * (0.15 * 4.17));
  }
  vec3 filteredFbmGradient(vec2 p, vec2 pixelX, vec2 pixelY) {
    float footprint = max(length(pixelX), length(pixelY));
    vec3 field = vec3(0.5, 0.0, 0.0);
    // Remove each octave only when its noise cells become subpixel. Blending
    // toward the mean value prevents an AA fade from tilting the water.
    float a = 1.0 - smoothstep(0.35, 1.2, footprint);
    float b = 1.0 - smoothstep(0.35, 1.2, footprint * 2.03);
    float c = 1.0 - smoothstep(0.35, 1.2, footprint * 4.17);
    if (a > 0.001) {
      vec3 n = waveNoiseGradient(p);
      field += vec3(n.x - 0.5, n.yz) * (0.57 * a);
    }
    if (b > 0.001) {
      vec3 n = waveNoiseGradient(p * 2.03 + 13.2);
      field += vec3(n.x - 0.5, n.yz * 2.03) * (0.28 * b);
    }
    if (c > 0.001) {
      vec3 n = waveNoiseGradient(p * 4.17 + 7.1);
      field += vec3(n.x - 0.5, n.yz * 4.17) * (0.15 * c);
    }
    return field;
  }
  vec2 turn(vec2 direction, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec2(c * direction.x - s * direction.y, s * direction.x + c * direction.y);
  }
  void surfaceWave(inout vec3 tangent, inout vec3 binormal,
                   vec2 direction, float wavelength, float amplitude, float speed,
                   float seed, vec2 base, float coast, float depth, float exposure,
                   vec2 pixelX, vec2 pixelY, inout float crest, inout float breaking,
                   inout float fineVariance) {
    vec2 d = normalize(direction);
    float k = 6.28318530718 / wavelength;
    vec3 group = waveNoiseGradient(base * 0.008 - d * uWaveTime * 0.014 + vec2(seed, seed * 0.37));
    float envelope = 0.62 + group.x * 0.63;
    float energy = 0.72 + uWind * 1.08 + uStorm * 0.65 + uSwell * 0.48 + uGust * 0.2;
    float depthLimit = max(0.0, depth - 0.1) * 0.04 * exposure;
    float unresolved = amplitude * coast * energy * envelope;
    float resolved = 1.0;
    // These short waves keep their exact geometric component. Their missing
    // slope energy goes into a nonperiodic field, not more coherent sine
    // normals: intersecting short sine trains make a diamond highlight grid.
    if (wavelength <= 18.0) {
      float meshSpacing = max(length(base) * 0.04, 0.2);
      resolved = 1.0 - smoothstep(wavelength * 0.22, wavelength * 0.55, meshSpacing);
      float fullAmplitude = min(unresolved, depthLimit);
      float meshAmplitude = min(unresolved * resolved, depthLimit);
      fineVariance += 0.5 * k * k * max(0.0, fullAmplitude * fullAmplitude - meshAmplitude * meshAmplitude);
      if (meshAmplitude < 0.00001) return;
    }
    // Beyond a pixel's Nyquist limit this band has no visible slope. The
    // screen footprint handles both distant water and a bird's-eye camera.
    float baseFootprint = k * (abs(dot(d, pixelX)) + abs(dot(d, pixelY)));
    if (baseFootprint > 3.4) return;
    vec3 phase = waveNoiseGradient(base * 0.024 + d * seed + vec2(uTime * 0.005, -uTime * 0.003));
    float f = k * (dot(d, base) - speed * uWaveTime) + (phase.x - 0.5) * 2.6 + seed;
    vec2 phaseGradient = d * k + phase.yz * (0.024 * 2.6);
    float footprint = abs(dot(phaseGradient, pixelX)) + abs(dot(phaseGradient, pixelY));
    float filtered = 1.0 - smoothstep(0.6, 2.5, footprint);
    float unlimited = unresolved * resolved;
    float a = min(unlimited, depthLimit) * filtered;
    vec2 amplitudeGradient = unlimited < depthLimit
      ? group.yz * (amplitude * coast * energy * resolved * 0.63 * 0.008 * filtered)
      : vec2(0.0);
    float s = sin(f), c = cos(f);
    float horizontal = min(a * 0.52, 0.085 / k);
    vec2 horizontalGradient = a * 0.52 < 0.085 / k ? amplitudeGradient * 0.52 : vec2(0.0);
    vec2 horizontalDerivative = horizontalGradient * c - horizontal * s * phaseGradient;
    vec2 heightDerivative = amplitudeGradient * s + a * c * phaseGradient;
    tangent += vec3(d.x * horizontalDerivative.x, heightDerivative.x, d.y * horizontalDerivative.x);
    binormal += vec3(d.x * horizontalDerivative.y, heightDerivative.y, d.y * horizontalDerivative.y);
    crest += s * a;
    // High powers form a much narrower ridge than the sine's normal field,
    // so its foam mask fades before that ridge becomes smaller than a pixel.
    float foamFiltered = 1.0 - smoothstep(0.35, 1.5, footprint);
    breaking += pow(max(s, 0.0), 7.0) * a * k * foamFiltered;
  }
  ${TYPHOON_WAVES_GLSL}
  vec4 coastSample(vec2 p) {
    vec2 uv = p / (uCoastExtent * 2.0) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(1.0, 1.0, 0.0, 1.0);
    uv=uv*uCoastUvTransform.x+uCoastUvTransform.y;
    vec4 bathymetry = texture2D(uBathymetry, uv);
    float edgeBlend = offshoreBlend(p, uCoastExtent);
    bathymetry.r = mix(bathymetry.r, 1.0, edgeBlend);
    bathymetry.a = mix(bathymetry.a, 1.0, edgeBlend);
    return bathymetry;
  }
  float terrainHeight(vec2 p) {
    vec2 uv = p / (uCoastExtent * 2.0) + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -80.0;
    uv=uv*uCoastUvTransform.x+uCoastUvTransform.y;
    return mix(texture2D(uTerrainHeight, uv).r, -80.0, offshoreBlend(p, uCoastExtent));
  }
  float sunsetAlignment(vec3 ray) {
    vec2 horizontalRay = ray.xz / max(length(ray.xz), 0.0001);
    vec2 horizontalSun = uSunDirection.xz / max(length(uSunDirection.xz), 0.0001);
    return pow(max(dot(horizontalRay, horizontalSun), 0.0), 3.0);
  }
  vec3 skyPalette(vec3 ray) {
    float elevation = clamp(ray.y, 0.0, 1.0);
    vec3 sky = mix(uHorizonColor, uZenithColor, pow(elevation, 0.42));
    if (uSunsetGlow > 0.00001) {
      // Match the sky's solar azimuth and coloured altitude bands. Only the
      // reflected sky warms: the submerged blue/green water remains separate.
      float alignment = sunsetAlignment(ray);
      float lowDirection = 0.18 + 0.82 * alignment;
      float highDirection = 0.35 + 0.65 * sqrt(alignment);
      vec3 horizon = mix(uHorizonColor, uSunsetHorizonColor,
                         uSunsetHorizonMix * lowDirection);
      vec3 zenith = mix(uZenithColor, uSunsetZenithColor,
                        uSunsetZenithMix * highDirection);
      sky = mix(horizon, zenith, pow(elevation, mix(0.42, 0.44, uSunsetGlow)));
      // Match the sky's signed Gaussian offsets without undefined pow bases.
      float goldOffset = (elevation - 0.065) / 0.11;
      float roseOffset = (elevation - 0.20) / 0.13;
      float goldBand = exp(-goldOffset * goldOffset);
      float roseBand = exp(-roseOffset * roseOffset);
      sky = mix(sky, uSunsetCloudGold, goldBand * uSunsetGlow * lowDirection * 0.22);
      sky = mix(sky, uSunsetCloudRose,
                roseBand * uSunsetGlow * (0.3 + 0.7 * sqrt(alignment)) * 0.26);
    }
    return sky;
  }
  vec3 skyReflection(vec3 ray) {
    float elevation = clamp(ray.y, 0.0, 1.0);
    vec3 sky = skyPalette(ray);
    float cloud = fbm(ray.xz * 3.5 / max(0.15, ray.y + 0.2) + vec2(uTime * 0.001, 0.0));
    float cover = smoothstep(0.65 - uSkyCloudCover * 0.45, 0.83 - uSkyCloudCover * 0.4, cloud);
    vec3 cloudColor = uHorizonColor * (0.92 - uStorm * 0.24);
    if (uSunsetGlow > 0.00001) {
      vec3 warmCloud = mix(uSunsetCloudGold, uSunsetCloudRose, smoothstep(0.04, 0.25, elevation));
      warmCloud = mix(warmCloud, uSunsetCloudShadow, smoothstep(0.28, 0.65, elevation));
      cloudColor = mix(cloudColor, warmCloud, uSunsetGlow * (0.18 + 0.82 * sunsetAlignment(ray)));
    }
    sky = mix(sky, cloudColor, cover * uSkyCloudCover * 0.62);
    return sky;
  }
  void main() {
    // Bathymetry stays anchored to the real beach when wave crests move sideways.
    vec4 sampleCoast = coastSample(vSurfacePosition);
    float depth = sampleCoast.r * 48.0;
    float shore = sampleCoast.g * 32.0;
    float floorHeight=terrainHeight(vWorldPosition.xz);
    float opticalDepth=max(0.0,vWorldPosition.y-floorHeight);
    float exposure = sampleCoast.a;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float distanceToCamera = length(cameraPosition - vWorldPosition);

    // Vertex displacement resolves the silhouette; this pixel spectrum also
    // resolves the shorter gravity waves that no longer fit in that mesh.
    vec2 p = vWorldPosition.xz;
    vec2 base = vSurfacePosition;
    vec2 pixelX = dFdx(base), pixelY = dFdy(base);
    float horizontalDistance = length(base - cameraPosition.xz);
    float coast = smoothstep(0.1, 6.0, depth);
    coast *= 1.0 + (1.0 - smoothstep(3.0, 12.0, depth)) * 0.3;
    coast *= mix(1.0, 0.28, smoothstep(180.0, 1000.0, horizontalDistance));
    coast *= exposure;
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    float waveCrest = 0.0, waveBreaking = 0.0, fineVariance = 0.0;
    surfaceWave(tangent, binormal, turn(uWindDirection, 0.12), 76.0, 0.90, 8.3, 2.3, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, -0.37), 44.0, 0.58, 7.0, 5.9, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, 0.58), 28.0, 0.40, 5.2, 9.2, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, -0.72), 18.0, 0.25, 4.2, 13.7, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, 0.34), 9.6, 0.125, 3.1, 17.4, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, -1.12), 5.0, 0.065, 2.3, 21.6, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, 1.48), 3.0, 0.035, 1.9, 27.1, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    surfaceWave(tangent, binormal, turn(uWindDirection, 1.18), 62.0, 0.35, 7.6, 31.8, base, coast, depth, exposure, pixelX, pixelY, waveCrest, waveBreaking, fineVariance);
    vec3 surge = vec3(0.0);
    if (uTyphoon > 0.001) {
      surge = surgeSurface(base, depth, exposure);
      tangent.y += surge.y;
      binormal.y += surge.z;
    }
    vec3 normal = normalize(cross(binormal, tangent));
    vec2 fineSlope = vec2(0.0);
    if (fineVariance > 0.000001) {
      vec2 along = uWindDirection;
      vec2 across = vec2(-along.y, along.x);
      vec2 flow = vec2(-dot(uFlowOffset, along) * 0.045 - uWaveTime * 0.07,
                      -dot(uFlowOffset, across) * 0.018 + uWaveTime * 0.013);
      vec3 warpX = fbmGradient(base * 0.024 + flow * 0.09);
      vec3 warpY = fbmGradient(base * 0.021 + 19.4 - flow * 0.07);
      vec2 q = vec2(dot(base, along) * 0.32, dot(base, across) * 0.115) +
               flow + vec2(warpX.x, warpY.x) * 2.7;
      // Chain the warp Jacobian into both the surface slope and each octave's
      // screen footprint. Ignoring it makes warped highlights slide or alias.
      vec2 qxGradient = along * 0.32 + warpX.yz * (0.024 * 2.7);
      vec2 qyGradient = across * 0.115 + warpY.yz * (0.021 * 2.7);
      vec2 qPixelX = vec2(dot(qxGradient, pixelX), dot(qyGradient, pixelX));
      vec2 qPixelY = vec2(dot(qxGradient, pixelY), dot(qyGradient, pixelY));
      vec3 field = filteredFbmGradient(q, qPixelX, qPixelY);
      // Across 10,000 world samples this anisotropic, warped unit-height
      // field has slope RMS 0.136. Replace exactly the missing short-wave
      // variance, respecting the same depth-limited wave amplitude above.
      float fineHeight = sqrt(fineVariance) / 0.136;
      fineSlope = (field.y * qxGradient + field.z * qyGradient) * fineHeight;
    }
    normal = normalize(vec3(normal.x / max(normal.y, 0.2) - fineSlope.x,
                            1.0, normal.z / max(normal.y, 0.2) - fineSlope.y));
    if(opticalDepth<7.0){
      vec3 ripples=filteredFbmGradient(base*2.1+vec2(uTime*0.08,-uTime*0.045),pixelX*2.1,pixelY*2.1);
      float rippleStrength=(1.0-smoothstep(1.0,7.0,opticalDepth))*(1.0-uTyphoon)*0.035;
      normal=normalize(normal+vec3(ripples.y,0.0,ripples.z)*rippleStrength);
    }
    // Physical moon height is already represented by uMoonLight; the backdrop
    // direction follows the viewing composition and must not darken the sea.
    float moonAmbient = uMoonLight * (1.0 - uDaylight) *
                        (1.0 - uCloudiness * 0.92) * (1.0 - uFog * 0.65);
    float moonVisibility = moonAmbient * smoothstep(0.0, 0.15, uMoonDirection.y);
    float moonDiffuse = max(dot(normal, uMoonDirection), 0.0);
    float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - facing, 5.0);
    vec3 reflectedDirection = reflect(-viewDirection, normal);
    vec3 reflected = skyReflection(reflectedDirection);

    float depthMix = 1.0 - exp(-opticalDepth * 0.085);
    vec3 water = mix(uShallowColor, uDeepColor, depthMix);
    float sunDiffuse = max(dot(normal, uSunDirection), 0.0);
    water *= (0.62 + 0.32 * sunDiffuse) * (0.13 + 0.87 * uDaylight) * (1.0 - uStorm * 0.3);
    // Broad lunar illumination reveals water away from the narrow gold path.
    vec3 moonWater = mix(uDeepColor, uShallowColor, exp(-depth * 0.06) * 0.35);
    water += (moonWater * (0.2 + moonDiffuse * 0.28) +
              vec3(0.024, 0.045, 0.071) * (0.35 + moonDiffuse * 0.65)) * moonAmbient;
    // The requested blood-moon illumination reaches the whole sea body,
    // including water outside the specular path, while retaining wave shading.
    water += moonWater * uLunarWorldTint * (0.24 + moonDiffuse * 0.32);
    float crestLight = smoothstep(0.12, 1.1, waveCrest) * (1.0 - normal.y);
    water += uShallowColor * crestLight * uDaylight * (1.0 - uStorm * 0.4) * 0.26;
    water += mix(vec3(0.065, 0.13, 0.18),uShallowColor*.9,uLunarWorldTint)
      * crestLight * max(moonAmbient,uLunarWorldTint*.45) * 0.55;
    // Light refracted onto the sandy shelf, visible only through clear shallow water.
    if (depth < 16.0) {
      float caustic = pow(1.0 - abs(sin(p.x * 0.56 + sin(p.y * 0.39 + uTime * 0.7)) *
                                      cos(p.y * 0.49 + sin(p.x * 0.34 - uTime * 0.5))), 8.0);
      water += uShallowColor * caustic * exp(-depth * 0.32) * uDaylight * (1.0 - uCloudiness) * 0.22;
    }
    // A downward reflection meets water rather than the bright sky horizon.
    // Approximate that wave occlusion with the body color and a soft horizon
    // transition; clamping every downward ray to the sky paints wide white bands.
    reflected = mix(water, reflected, smoothstep(-0.04, 0.08, reflectedDirection.y));
    vec3 color = mix(water, reflected, fresnel * 0.88);

    vec3 halfDirection = normalize(viewDirection + uSunDirection);
    float specular = pow(max(dot(normal, halfDirection), 0.0), mix(140.0, 65.0, uWind));
    float wideSpecular = pow(max(dot(normal, halfDirection), 0.0), 25.0) * 0.015;
    color += uSunColor * (specular * 1.25 + wideSpecular) * uSunVisibility;
    vec3 moonHalfDirection = normalize(viewDirection + uMoonDirection);
    float moonFacing = max(dot(normal, moonHalfDirection), 0.0);
    float moonGlint = pow(moonFacing, mix(120.0, 70.0, uWind));
    float moonWideGlint = pow(moonFacing, 28.0) * 0.04;
    color += vec3(1.2, 0.71, 0.25) * uMoonTint * (moonGlint + moonWideGlint) * moonVisibility * 0.6;

    // Interrupted fronts travel inwards along the actual shore distance field.
    // Their retreat leaves slower, thinning lace instead of permanent white rings.
    float foam = 0.0;
    float waveEnergy = 0.3 + uWind * 0.5 + uSwell * 0.35 + uStorm * 0.4;
    if (shore < 18.0 && depth < 14.0) {
      vec2 coastPoint = vSurfacePosition;
      float coastNoise = fbm(coastPoint * 0.048 + vec2(uTime * 0.003, 11.2));
      float swashPhase = uWaveTime * 0.9 + coastNoise * 5.4;
      float runupReach = 3.2 + waveEnergy * 5.6 + uTyphoon * 9.0;
      float front = runupReach * (0.5 + 0.5 * cos(swashPhase));
      float incoming = smoothstep(-0.2, 0.55, sin(swashPhase));
      // One mip-filtered mask fetch replaces three value-noise octaves.
      // Mirrored wrapping avoids discontinuities at the generated tile edges.
      vec2 foamUV = (coastPoint - uFlowOffset * 0.24) * 0.14
        + vec2(coastNoise * 0.10, uWaveTime * 0.009);
      float laceNoise = uFoamReady > 0.5 ? texture2D(uFoamMap, foamUV).r
        : fbm(coastPoint * 0.72 - uFlowOffset * 0.17 + vec2(0.0, uWaveTime * 0.065));
      float lace = smoothstep(0.25, 0.71, laceNoise);
      float brokenShore=smoothstep(0.32,0.67,fbm(coastPoint*0.13-uFlowOffset*0.025+coastNoise));
      // A water head climbs the real sand apron. Its edge is defined by
      // water thickness, rather than a white ring travelling offshore.
      float thinFilm=1.0-smoothstep(0.025,0.12,opticalDepth);
      float swashFront=mix(thinFilm,1.0-smoothstep(0.45,1.8,abs(shore-front)),uTyphoon);
      float residue=(1.0-smoothstep(0.35,1.2,opticalDepth))
        *(0.08+(1.0-incoming)*0.15)*lace;
      float breaker = smoothstep(0.54, 0.94, sin(shore * 0.62 + uWaveTime * 1.25 + coastNoise * 4.5));
      breaker *= (1.0 - smoothstep(4.0, 10.0 + waveEnergy * 4.0, shore)) *
                 smoothstep(0.8, 3.0, shore) * smoothstep(0.3, 0.66, laceNoise);
      foam = (swashFront*(0.85+incoming*0.15)*mix(0.65,1.0,lace)*mix(0.65,1.0,brokenShore)+
             residue*0.7+breaker*brokenShore*(0.08+waveEnergy*0.12))*(1.0-uTyphoon*0.72);
    }
    // Whitecaps also occur in fine weather, confined to steep, patchy crests.
    // The large mask groups them into small streaks rather than a dot texture.
    if (distanceToCamera < 520.0) {
      vec2 drift = p - uFlowOffset * 0.4;
      vec2 acrossWind = vec2(-uWindDirection.y, uWindDirection.x);
      vec2 capPoint = vec2(dot(drift, uWindDirection) * 0.1, dot(drift, acrossWind) * 0.046);
      float capPatch = fbm(capPoint + vec2(7.3, uWaveTime * 0.008));
      // A steep slope is not automatically a breaking crest: whitening every
      // intersecting normal ridge creates the old diamond/white-line network.
      float whitecap = smoothstep(0.09, 0.24, waveBreaking) * smoothstep(0.51, 0.74, capPatch);
      float capDetail = uFoamReady > 0.5 ? texture2D(uFoamMap,
        vec2(dot(drift, uWindDirection), dot(drift, acrossWind)) * vec2(0.12, 0.24)).r
        : noise(drift * 0.65);
      float capLace = smoothstep(0.18, 0.70, capDetail);
      foam += whitecap * capLace * (0.22 + uWind * 0.36 + uStorm * 0.24) *
              smoothstep(2.0, 8.0, shore) * (1.0 - smoothstep(180.0, 520.0, distanceToCamera));
    }
    if (uTyphoon > 0.001) {
      vec3 breakup=surgeBreakup(base,depth,exposure);
      vec2 drift=base-uFlowOffset*0.65;
      float churn=fbm(drift*0.19);
      vec2 warp=vec2(churn-0.5,noise(drift*0.12+13.7)-0.5);
      float lace=uFoamReady>0.5 ? texture2D(uFoamMap,drift*0.16+warp*0.45).r : noise(drift*0.8+warp);
      // Keep density continuous: thresholding the lace into white/clear pixels
      // makes every breaker look like the same high-contrast painted pattern.
      float fragments=sqrt(max(lace,0.0))*(0.70+churn*0.30);
      float falling=breakup.x*fragments;
      float wake=breakup.y*fragments*smoothstep(0.29,0.65,churn)*0.9;
      float impact=breakup.z*(1.0-smoothstep(2.0,22.0,shore))*fragments;
      float brokenFoam=(falling*0.95+wake+impact)
        *(1.0-smoothstep(350.0,1100.0,distanceToCamera));
      foam=max(foam,brokenFoam);
    }
    foam = clamp(foam,0.0,0.9)*smoothstep(0.0,0.025,opticalDepth);
    // Quiet water still has shoreline lace, with no persistent surf inside.
    foam *= mix(0.22, 1.0, clamp((exposure - 0.28) / 0.72, 0.0, 1.0));
    vec3 nightFoam = vec3(0.022, 0.036, 0.054) +
                     (vec3(0.32, 0.25, 0.14) * (0.35 + moonDiffuse * 0.65) +
                      vec3(0.025, 0.048, 0.075)) * moonAmbient;
    nightFoam=mix(nightFoam,vec3(.10,.014,.010)*(0.55+moonDiffuse*0.45),uLunarWorldTint);
    // Foam scatters the same overcast skylight as the water. A fixed daytime
    // white appears emissive in a storm, regardless of the surrounding light.
    vec3 foamSky=mix(uZenithColor,uHorizonColor,0.65);
    float skyLuminance=dot(foamSky,vec3(0.2126,0.7152,0.0722));
    vec3 foamAmbient=mix(vec3(skyLuminance),foamSky,0.28)*1.10;
    vec3 foamSun=uSunColor*sunDiffuse*uSunVisibility*0.35;
    vec3 dayFoam=(foamAmbient+foamSun)*(0.70+max(normal.y,0.0)*0.30);
    vec3 litFoam=mix(nightFoam,dayFoam,uDaylight);
    // Sparse, wet bubbles transmit the sea's blue-grey; only aerated cores
    // approach the brighter diffuse colour. No opaque white decal is applied.
    float aeration=smoothstep(0.08,0.55,foam);
    vec3 foamColor=mix(water*1.15,litFoam,0.65+aeration*0.35);
    float foamOpacity=foam*(0.80+aeration*0.15);
    color = mix(color, foamColor, foamOpacity);

    // A few terrain probes give the nearby water a soft island shadow.
    float shadow = 0.0;
    if (length(p) < 230.0 && uSunHeight > 0.08) {
      vec2 towardSun = normalize(uSunDirection.xz);
      float rise = uSunDirection.y / max(length(uSunDirection.xz), 0.05);
      for (int i = 1; i <= 5; i++) {
        float reach = float(i) * 18.0;
        float obstruction = terrainHeight(p + towardSun * reach) - reach * rise;
        shadow = max(shadow, smoothstep(-3.0, 4.0, obstruction));
      }
    }
    color *= 1.0 - shadow * 0.25 * uSunVisibility;

    float haze = 1.0 - exp(-distanceToCamera * (0.00042 + uFog * 0.0042));
    // Far water converges to the horizon in this viewing direction, not to
    // a uniform orange tint. The same palette is used by the reflected sky.
    vec3 horizonRay = vec3(-viewDirection.x, 0.0, -viewDirection.z);
    vec3 hazeColor = skyPalette(horizonRay);
    if (uSeaHorizonNight > 0.0 && distanceToCamera > 160.0) {
      // 近海平滑交接到共享雾；700m 外深夜只剩一层距离雾，远端收敛到天空低空色。
      // 使用真实的带符号视线，缓慢的方向噪声让海天渐变更朦胧而不移动海平面。
      vec3 seaHorizonRay = -viewDirection;
      float horizonBlend = smoothstep(160.0, 700.0, distanceToCamera);
      float legacyHazeWeight = clamp(haze, 0.0, 0.96)
        * (1.0 - clamp(uSeaHorizonNight, 0.0, 1.0) * horizonBlend);
      float sharedHazeWeight = seaHorizonOceanWeight(seaHorizonRay, distanceToCamera) * horizonBlend;
      float waterWeight = max(0.0, 1.0 - legacyHazeWeight - sharedHazeWeight);
      color = color * waterWeight + hazeColor * legacyHazeWeight
        + seaHorizonRadiance(seaHorizonRay) * sharedHazeWeight;
    } else {
      color = mix(color, hazeColor, clamp(haze, 0.0, 0.96));
    }
    // 近岸清水透出真正的水下几何；深水、远景和掠射角以反射为主。
    float closeWater = 1.0 - smoothstep(32.0, 160.0, distanceToCamera);
    float transmission = seabedTransmission(opticalDepth) * closeWater * uWaterClarity
      * (1.0 - fresnel * 0.94) * 0.86 * (1.0-foamOpacity*0.97);
    // 薄水膜在沙洲交界逐渐透明，避免浪面三角形留下灰色硬切块。
    float contactBand=max(.14,min(.45,fwidth(opticalDepth)*1.5));
    float contactFade=smoothstep(0.0,contactBand,opticalDepth);
    float waterAlpha=(1.0-clamp(transmission,0.0,.86))*contactFade;
    if(waterAlpha<.003)discard;
    gl_FragColor = vec4(color,waterAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createOcean(scene, { heightAt, shelterAt } = {}) {
  const iterator = buildBathymetry(heightAt, shelterAt);
  let result;
  do { result = iterator.next(); } while (!result.done);
  return createOceanFromData(scene, { heightAt, shelterAt }, result.value);
}

/** Preserve the synchronous ocean exactly, yielding between bathymetry rows. */
export async function createOceanAsync(scene, { heightAt, shelterAt, signal, ...startupOptions } = {}) {
  throwIfAborted(signal);
  const data = await runStartupGenerator(buildBathymetry(heightAt, shelterAt, signal), startupOptions);
  throwIfAborted(signal);
  return createOceanFromData(scene, { heightAt, shelterAt, signal }, data);
}

function createOceanFromData(scene, { heightAt, shelterAt, signal }, data) {
  const cleanup = createCleanupScope();
  let disposed = false;
  try {
  const {texture:bathymetry,heightMap} = createBathymetry(data);
  cleanup.add(() => bathymetry.dispose());
  cleanup.add(() => heightMap.dispose());
  const foam = createOceanFoamTexture();
  cleanup.add(() => foam.dispose());
  const seaHorizon = getSeaHorizonState();
  const uniforms = {
    uTime: { value: 0 },
    uWaveTime: { value: 0 },
    uWind: { value: 0.25 },
    uSwell: { value: 0.38 },
    uGust: { value: 0.12 },
    uWindDirection: { value: new THREE.Vector2(0.83, 0.55).normalize() },
    uFlowOffset: { value: new THREE.Vector2() },
    uStorm: { value: 0 },
    uTyphoon: { value: 0 },
    uDaylight: { value: 1 },
    uCloudiness: { value: 0.12 },
    uSkyCloudCover: { value: 0.12 },
    uSeaHorizonNight: { value: seaHorizon.night },
    uSeaHorizonColor: { value: new THREE.Color().fromArray(seaHorizon.color) },
    uSeaHorizonTime: { value: 0 },
    uSeaHorizonWeather: { value: seaHorizon.weather },
    uSeaHorizonCloudCover: { value: seaHorizon.cloudCover },
    uFog: { value: 0 },
    uWaterClarity: { value: 1 },
    uSunHeight: { value: 0.85 },
    uSunVisibility: { value: 1 },
    uSunDirection: { value: new THREE.Vector3(-0.5, 0.8, -0.3).normalize() },
    uMoonDirection: { value: new THREE.Vector3(0.5, -0.8, 0.3).normalize() },
    uMoonLight: { value: 1 },
    uMoonTint: { value: new THREE.Color(1,1,1) },
    uLunarWorldTint: {value:0},
    uShallowColor: { value: new THREE.Color('#29b8ad') },
    uDeepColor: { value: new THREE.Color('#075777') },
    uHorizonColor: { value: new THREE.Color('#adcbd5') },
    uZenithColor: { value: new THREE.Color('#568daf') },
    uSunColor: { value: new THREE.Color('#fff4db') },
    uSunsetGlow: { value: 0 },
    uSunsetHorizonMix: { value: 0 },
    uSunsetZenithMix: { value: 0 },
    uSunsetHorizonColor: { value: new THREE.Color() },
    uSunsetZenithColor: { value: new THREE.Color() },
    uSunsetCloudGold: { value: new THREE.Color() },
    uSunsetCloudRose: { value: new THREE.Color() },
    uSunsetCloudShadow: { value: new THREE.Color() },
    uBathymetry: { value: bathymetry },
    uTerrainHeight: {value:heightMap},
    uCoastUvTransform:{value:new THREE.Vector2((COAST_RESOLUTION-1)/COAST_RESOLUTION,.5/COAST_RESOLUTION)},
    uFoamMap: { value: foam.texture },
    uFoamReady: { value: 0 },
    uCoastExtent: { value: COAST_EXTENT },
  };
  foam.ready.then(loaded => {
    if (!disposed) uniforms.uFoamReady.value = loaded ? 1 : 0;
  });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: true,
  });
  cleanup.add(() => material.dispose());
  const geometry = createOceanGeometry();
  cleanup.add(() => geometry.dispose());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = '动态海洋';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  const spray = createOceanSpray(scene, { heightAt, shelterAt });
  cleanup.add(() => spray.dispose());
  cleanup.add(() => scene.remove(mesh));

  const dayHorizon = new THREE.Color('#bddeeb');
  const duskHorizon = new THREE.Color('#ef9a70');
  const nightHorizon = new THREE.Color('#142b43');
  const moonHorizon = new THREE.Color('#355875');
  const dayZenith = new THREE.Color('#5e9dcc');
  const nightZenith = new THREE.Color('#070f25');
  const moonZenith = new THREE.Color('#183451');
  const overcast = new THREE.Color('#8c9aa0');
  const sunWhite = new THREE.Color('#fff4d8');
  const sunWarm = new THREE.Color('#ff9f52');
  const warmShallowWater = new THREE.Color('#29b8ad');
  const warmDeepWater = new THREE.Color('#075777');
  const coldShallowWater = new THREE.Color('#44aeb5');
  const coldDeepWater = new THREE.Color('#164b68');
  const clearShallowWater = new THREE.Color('#28b9c8');
  const clearDeepWater = new THREE.Color('#075ab5');
  const clearColdDeepWater = new THREE.Color('#155aa2');
  const cloudyShallowWater = new THREE.Color('#6b9f9d');
  const cloudyDeepWater = new THREE.Color('#376279');
  const stormShallowWater = new THREE.Color('#527a85');
  const stormDeepWater = new THREE.Color('#294c66');
  const fogShallowWater = new THREE.Color('#93b2b6');
  const fogDeepWater = new THREE.Color('#5c7b8e');
  const bloodShallowWater=new THREE.Color(.45,.035,.022),bloodDeepWater=new THREE.Color(.14,.008,.012);
  const bloodHorizon=new THREE.Color(.033,.004,.0062),bloodZenith=new THREE.Color(.011,.0012,.0021);
  const scratch = new THREE.Color();
  const sunsetSun = new THREE.Color();
  const weatherState = { typhoon: 0, clearBlue: 0, wind: 0.25, windSpeed: 7, swell: 0.38, gust: 0.12, cloudiness: 0.1, storm: 0, fog: 0, rain: 0, snow: 0 };
  let windAngle = Math.atan2(0.55, 0.83);
  let waveTime = 0;
  let lastUpdateTime = null;

  function finiteInput(value, fallback, min = 0, max = 1) {
    return THREE.MathUtils.clamp(Number.isFinite(value) ? value : fallback, min, max);
  }

  function update(time, env = {}) {
    if (disposed) return;
    time = Number.isFinite(time) ? time : (lastUpdateTime ?? 0);
    const firstUpdate = lastUpdateTime === null;
    const delta = firstUpdate ? 0 : getAnimationDelta(time - lastUpdateTime, .15, env);
    const weatherBlend = firstUpdate ? 1 : 1 - Math.exp(-delta * 1.7);
    const wind = finiteInput(env.wind, 0.25);
    weatherState.wind = THREE.MathUtils.lerp(weatherState.wind, wind, weatherBlend);
    weatherState.windSpeed = THREE.MathUtils.lerp(weatherState.windSpeed, finiteInput(env.windSpeed, 2 + wind * 20, 2, (env.roughSea??env.typhoon) > 0 ? 60 : 22), weatherBlend);
    weatherState.typhoon = THREE.MathUtils.lerp(weatherState.typhoon, finiteInput(env.roughSea??env.typhoon, 0), weatherBlend);
    weatherState.swell = THREE.MathUtils.lerp(weatherState.swell, finiteInput(env.swell, 0.38), weatherBlend);
    weatherState.gust = THREE.MathUtils.lerp(weatherState.gust, finiteInput(env.gust, 0.12), weatherBlend);
    weatherState.cloudiness = THREE.MathUtils.lerp(weatherState.cloudiness, finiteInput(env.cloudiness, 0.1), weatherBlend);
    weatherState.storm = THREE.MathUtils.lerp(weatherState.storm, finiteInput(env.storm, 0), weatherBlend);
    weatherState.fog = THREE.MathUtils.lerp(weatherState.fog, finiteInput(env.fog, 0), weatherBlend);
    weatherState.rain = THREE.MathUtils.lerp(weatherState.rain, finiteInput(env.rain, 0), weatherBlend);
    weatherState.snow = THREE.MathUtils.lerp(weatherState.snow, finiteInput(env.snow, 0), weatherBlend);
    weatherState.clearBlue = THREE.MathUtils.lerp(weatherState.clearBlue, env.weather === 'sunny' ? 1 : 0, weatherBlend);
    let targetWindAngle = Math.atan2(0.55, 0.83);
    const direction = env.windDirection;
    if (Array.isArray(direction) && direction.length === 2 && direction.every(Number.isFinite) &&
        Math.hypot(...direction) > 0.001) {
      targetWindAngle = Math.atan2(direction[1], direction[0]);
    } else if (direction?.isVector2 && direction.lengthSq() > 0.001) {
      targetWindAngle = Math.atan2(direction.y, direction.x);
    }
    const angleDifference = Math.atan2(Math.sin(targetWindAngle - windAngle), Math.cos(targetWindAngle - windAngle));
    windAngle += angleDifference * (firstUpdate ? 1 : 1 - Math.exp(-delta * 0.24));
    uniforms.uWindDirection.value.set(Math.cos(windAngle), Math.sin(windAngle));
    // Integrate speed rather than multiplying the current speed by elapsed time.
    // Changing weather or catching a gust cannot jump the wave phase.
    waveTime += delta * (0.72 + weatherState.windSpeed * 0.035);
    uniforms.uWaveTime.value = waveTime;
    uniforms.uFlowOffset.value.addScaledVector(uniforms.uWindDirection.value, delta * (0.18 + weatherState.windSpeed * 0.06));
    lastUpdateTime = time;
    const daylight = finiteInput(env.daylight, 1);
    const lunarWorldTint=finiteInput(env.lunarWorldTintStrength,0)*(1-THREE.MathUtils.smoothstep(daylight,.01,.16));
    uniforms.uLunarWorldTint.value=lunarWorldTint;
    const cloudiness = weatherState.cloudiness;
    const storm = weatherState.storm;
    // The visible sun, island shadows and ocean glints share one direction.
    // Physical altitude remains separate so framing cannot keep sunlight at night.
    const physicalSun = env.sunDirection;
    const visibleSun = env.sunBackdropDirection ?? physicalSun;
    const sunHeight = physicalSun?.isVector3 && physicalSun.lengthSq() > 0.001
      ? physicalSun.y / physicalSun.length() : uniforms.uSunDirection.value.y;
    if (visibleSun?.isVector3 && visibleSun.lengthSq() > 0.001) uniforms.uSunDirection.value.copy(visibleSun).normalize();
    const moonDirection = uniforms.uMoonDirection.value;
    moonDirection.copy(physicalSun?.isVector3 ? physicalSun : uniforms.uSunDirection.value).normalize().negate();
    if (env.moonDirection?.isVector3 && env.moonDirection.lengthSq() > 0.001) {
      moonDirection.copy(env.moonDirection).normalize();
    } else if (Array.isArray(env.moon) && env.moon.length === 3 && env.moon.every(Number.isFinite) &&
               env.moon.some(component => component !== 0)) {
      moonDirection.set(...env.moon).normalize();
    }
    uniforms.uMoonLight.value = THREE.MathUtils.clamp(Number.isFinite(env.moonLight) ? env.moonLight : 1, 0, 1);
    uniforms.uMoonTint.value.fromArray(env.moonLightTint ?? [1,1,1]);
    const moonAmbient = uniforms.uMoonLight.value * (1 - daylight) *
      (1 - cloudiness * 0.92) * (1 - weatherState.fog * 0.65);
    const dusk = (1 - THREE.MathUtils.smoothstep(Math.abs(sunHeight), 0.03, 0.55))
      * THREE.MathUtils.smoothstep(daylight, 0.01, 0.55) * (1 - cloudiness * 0.65);
    const sunset = getSunsetState({ sunHeight, daylight, cloudiness, storm,
      fog: weatherState.fog, rain: weatherState.rain, snow: weatherState.snow, hour: env.hour });
    uniforms.uSunsetGlow.value = sunset.glow;
    uniforms.uSunsetHorizonMix.value = sunset.horizonMix;
    uniforms.uSunsetZenithMix.value = sunset.zenithMix;
    // The sky applies this broad storm dimming after its colour layers. Its
    // reflected targets need the same factor; weather already gates glow.
    const sunsetDim = 1 - storm * 0.42;
    uniforms.uSunsetHorizonColor.value.fromArray(sunset.horizonColor).multiplyScalar(sunsetDim);
    uniforms.uSunsetZenithColor.value.fromArray(sunset.zenithColor).multiplyScalar(sunsetDim);
    uniforms.uSunsetCloudGold.value.fromArray(sunset.cloudGold).multiplyScalar(sunsetDim);
    uniforms.uSunsetCloudRose.value.fromArray(sunset.cloudRose).multiplyScalar(sunsetDim);
    uniforms.uSunsetCloudShadow.value.fromArray(sunset.cloudShadow).multiplyScalar(sunsetDim);
    uniforms.uTime.value = time;
    uniforms.uWind.value = weatherState.wind;
    uniforms.uSwell.value = weatherState.swell;
    uniforms.uGust.value = weatherState.gust;
    uniforms.uStorm.value = storm;
    uniforms.uTyphoon.value = weatherState.typhoon;
    spray.update(delta, waveTime, { typhoon: weatherState.typhoon, daylight, cloudiness, storm }, [Math.cos(windAngle), Math.sin(windAngle)]);
    uniforms.uDaylight.value = daylight;
    uniforms.uCloudiness.value = cloudiness;
    // A changing visible cloud population is independent of weather coverage.
    // Legacy callers still reflect their smoothed weather cloudiness.
    uniforms.uSkyCloudCover.value = finiteInput(env.skyCloudCover, cloudiness);
    // 与天空读取同帧状态；共享线性色已经含天气暗化，不再次乘 storm。
    const seaHorizon = env.seaHorizon ?? getSeaHorizonState(env);
    uniforms.uSeaHorizonNight.value = seaHorizon.night;
    uniforms.uSeaHorizonColor.value.fromArray(seaHorizon.color);
    uniforms.uSeaHorizonTime.value = time;
    uniforms.uSeaHorizonWeather.value = seaHorizon.weather;
    uniforms.uSeaHorizonCloudCover.value = seaHorizon.cloudCover;
    uniforms.uFog.value = weatherState.fog;
    uniforms.uWaterClarity.value = (0.18 + daylight * 0.82) * (1 - storm * .82)
      * (1 - weatherState.fog * .75) * (1 - weatherState.rain * .45);
    uniforms.uSunHeight.value = sunHeight;
    uniforms.uSunVisibility.value = getSunVisibility({ sunHeight, daylight,
      cloudiness, storm, fog: weatherState.fog, rain: weatherState.rain, snow: weatherState.snow });
    uniforms.uHorizonColor.value.copy(nightHorizon).lerp(moonHorizon, moonAmbient * 0.7)
      .lerp(dayHorizon, daylight).lerp(duskHorizon, dusk * 0.68 * (1 - sunset.glow));
    scratch.copy(overcast).multiplyScalar(0.18 + daylight * 0.82);
    uniforms.uHorizonColor.value.lerp(scratch, cloudiness * 0.64 + storm * 0.15);
    uniforms.uZenithColor.value.copy(nightZenith).lerp(moonZenith, moonAmbient * 0.7)
      .lerp(dayZenith, daylight).lerp(scratch, cloudiness * 0.55);
    uniforms.uHorizonColor.value.multiplyScalar(1 - storm * 0.42);
    uniforms.uZenithColor.value.multiplyScalar(1 - storm * 0.42);
    uniforms.uSunColor.value.copy(sunWarm).lerp(sunWhite, THREE.MathUtils.clamp(sunHeight * 2.8, 0, 1));
    // Ease only the shared palette's activation edge; noon/night retain their
    // established colour and the visible sunset glint shares the sun's RGB.
    sunsetSun.fromArray(sunset.sunColor);
    uniforms.uSunColor.value.lerp(sunsetSun, THREE.MathUtils.smoothstep(sunset.glow, 0, 0.03));
    const cold = env.seasonIndex === 3 || env.season === '冬';
    // Water depth still separates the clear cyan shelf from the blue open sea.
    // Smoothed cloud/storm/fog coverage reduces saturation rather than making
    // a rainy sea abruptly green; reflected sky and haze remain independent.
    // Strong daylight and a clear sky allow richer blue absorption in open
    // water. Dusk, clouds and wet weather retain their established palettes.
    const clearBlue = weatherState.clearBlue * THREE.MathUtils.smoothstep(daylight, .55, .95)
      * THREE.MathUtils.smoothstep(sunHeight, .15, .7)
      * (1 - THREE.MathUtils.smoothstep(Math.max(cloudiness, uniforms.uSkyCloudCover.value), .2, .85))
      * (1 - weatherState.fog) * (1 - weatherState.rain) * (1 - storm);
    const cloudTint = THREE.MathUtils.smoothstep(cloudiness, 0.2, 0.95) * 0.65;
    const stormTint = storm * 0.48;
    const fogTint = weatherState.fog * 0.36;
    uniforms.uShallowColor.value.copy(cold ? coldShallowWater : warmShallowWater)
      .lerp(clearShallowWater, clearBlue)
      .lerp(cloudyShallowWater, cloudTint).lerp(stormShallowWater, stormTint)
      .lerp(fogShallowWater, fogTint);
    uniforms.uDeepColor.value.copy(cold ? coldDeepWater : warmDeepWater)
      .lerp(cold ? clearColdDeepWater : clearDeepWater, clearBlue)
      .lerp(cloudyDeepWater, cloudTint).lerp(stormDeepWater, stormTint)
      .lerp(fogDeepWater, fogTint);
    uniforms.uShallowColor.value.lerp(bloodShallowWater,lunarWorldTint);
    uniforms.uDeepColor.value.lerp(bloodDeepWater,lunarWorldTint);
    uniforms.uHorizonColor.value.lerp(bloodHorizon,lunarWorldTint);
    uniforms.uZenithColor.value.lerp(bloodZenith,lunarWorldTint);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cleanup.dispose();
  }

  function cameraWaterHeightAt(x,z) {
    return sampleCameraWater(x,z,lastUpdateTime??0,waveTime,windAngle,weatherState);
  }
  const sampleCameraWater=createCameraWaterSampler(mesh.geometry,bathymetry);
  // Publish only when every owner has registered its cleanup.
  throwIfAborted(signal);
  scene.add(mesh);
  return { mesh, update, dispose, setQuality: spray.setQuality, bathymetry,cameraWaterHeightAt,
    ready: Promise.all([foam.ready,spray.ready]).then(([foamReady])=>foamReady) };
  } catch (error) {
    disposed = true;
    cleanup.dispose();
    throw error;
  }
}
