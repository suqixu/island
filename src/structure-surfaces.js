import * as THREE from 'three';
import { loadOptionalResource } from './resource-loading.js';

const dockUrl = new URL('./assets/textures/boats/sailboat-materials-v1.webp', import.meta.url).href;
const lighthouseUrl = new URL('./assets/textures/structures/lighthouse-plaster-v1.webp', import.meta.url).href;
const pavilionRoofUrl = new URL('./assets/textures/structures/pavilion-ceramic-albedo-v1.webp', import.meta.url).href;
const emptyMaps = () => ({ albedo: null, relief: null });
const disposeMaps = maps => { for (const map of new Set(Object.values(maps ?? {}))) map?.dispose(); };

/** Extract atlas pixels once; never let cloth bleed into the dock's mipmaps. */
export function createStructureSurfaceMaps({ data, width, height }, { rightHalf = false } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || data?.length !== width * height * 4 || (rightHalf && width % 2)) throw new RangeError('结构贴图像素尺寸不完整');
  const croppedWidth = rightHalf ? width / 2 : width, start = rightHalf ? croppedWidth : 0;
  const color = new Uint8Array(croppedWidth * height * 4), elevation = new Uint8Array(croppedWidth * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < croppedWidth; x++) {
    const from = (y * width + start + x) * 4, to = (y * croppedWidth + x) * 4;
    color.set(data.subarray(from, from + 4), to);
    elevation[y * croppedWidth + x] = Math.round(data[from] * .2126 + data[from + 1] * .7152 + data[from + 2] * .0722);
  }
  const albedo = new THREE.DataTexture(color, croppedWidth, height, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const relief = new THREE.DataTexture(elevation, croppedWidth, height, THREE.RedFormat);
  relief.unpackAlignment = 1;
  for (const map of [albedo, relief]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.flipY = true;
    map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
  }
  return { albedo, relief };
}

async function readSurfacePixels(url, { signal, width, height }) {
  let bitmap, canvas;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`结构贴图请求失败: ${response.status}`);
    bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
      premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取结构贴图像素');
    context.drawImage(bitmap, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
}

async function loadSurfaces(url, rightHalf, { signal, readPixels = readSurfacePixels, ...timing } = {}) {
  return loadOptionalResource(async () => createStructureSurfaceMaps(
    await readPixels(url, { signal, width: rightHalf ? 1024 : 512, height: 512 }), { rightHalf }),
  { timeoutMs: 4000, retries: 1, ...timing, signal, fallback: emptyMaps(), dispose: disposeMaps });
}
export const loadDockSurfaces = options => loadSurfaces(dockUrl, true, options);
export const loadLighthouseSurfaces = options => loadSurfaces(lighthouseUrl, false, options);
export const loadPavilionRoofSurfaces = options => loadSurfaces(pavilionRoofUrl, false, options);

/** A scene owner keeps its maps separate from other structures using the atlas. */
export function createStructureSurfaceState({ownsMaps = true} = {}) {
  const uniforms = { uStructureAlbedo: { value: null }, uStructureRelief: { value: null }, uStructureEnabled: { value: 0 } };
  const released = new WeakSet();
  let disposed = false;
  const release = map => { if (ownsMaps && map && !released.has(map)) { released.add(map); map.dispose(); } };
  function setMaps(maps = {}) {
    if (disposed) { for (const map of new Set(Object.values(maps))) release(map); return; }
    const previous = new Set([uniforms.uStructureAlbedo.value, uniforms.uStructureRelief.value]);
    if ('albedo' in maps) uniforms.uStructureAlbedo.value = maps.albedo;
    if ('relief' in maps) uniforms.uStructureRelief.value = maps.relief;
    uniforms.uStructureEnabled.value = uniforms.uStructureAlbedo.value && uniforms.uStructureRelief.value ? 1 : 0;
    const current = new Set([uniforms.uStructureAlbedo.value, uniforms.uStructureRelief.value]);
    for (const map of previous) if (!current.has(map)) release(map);
  }
  function dispose() { if (disposed) return; setMaps(emptyMaps()); disposed = true; }
  return { uniforms, setMaps, dispose };
}

/** Metre-based dominant-plane projection avoids stretching scaled dock posts.
 * Two texture reads per visible structure fragment, independent of quality.
 */
export function attachStructureSurface(material, state, { plaster = false, painted = false, ceramic = false, local = false } = {}) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    Object.assign(shader.uniforms, state.uniforms);
    shader.vertexShader = `varying vec3 vStructureWorld;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', `
        vec4 structureWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          structureWorld = instanceMatrix * structureWorld;
        #endif
        vStructureWorld = ${local ? 'structureWorld.xyz' : '(modelMatrix * structureWorld).xyz'};
        #include <project_vertex>`);
    shader.fragmentShader = `varying vec3 vStructureWorld;
      uniform sampler2D uStructureAlbedo;
      uniform sampler2D uStructureRelief;
      uniform float uStructureEnabled;
      vec3 structureSurfaceNormal(vec3 p, vec3 n, float height, float facing) {
        vec3 sx = normalize(dFdx(p)), sy = normalize(dFdy(p));
        vec3 rx = cross(sy, n), ry = cross(n, sx);
        float determinant = dot(sx, rx) * facing;
        vec3 gradient = sign(determinant) * (dFdx(height) * rx + dFdy(height) * ry);
        return normalize(max(abs(determinant), 0.00001) * n - gradient);
      }\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float structureHeight = 0.0;
      if (uStructureEnabled > 0.5) {
        vec3 structureAxis = abs(normalize(cross(dFdx(vStructureWorld), dFdy(vStructureWorld))));
        vec2 structureUv = structureAxis.y > max(structureAxis.x, structureAxis.z)
          ? vStructureWorld.${local ? 'xz' : 'zx'} * vec2(0.9, 0.34)
          : structureAxis.x > structureAxis.z ? vStructureWorld.zy * vec2(0.6, 0.45)
          : vStructureWorld.xy * vec2(0.6, 0.45);
        vec3 structureAlbedo = texture2D(uStructureAlbedo, structureUv).rgb;
        ${ceramic
    ? 'diffuseColor.rgb *= clamp(0.72 + dot(structureAlbedo, vec3(0.2126, 0.7152, 0.0722)) * 1.4, 0.72, 1.25);'
    : painted
    ? 'diffuseColor.rgb *= clamp(0.64 + dot(structureAlbedo, vec3(0.2126, 0.7152, 0.0722)) * 1.7, 0.64, 1.20);'
    : plaster
    ? 'diffuseColor.rgb *= clamp(0.78 + dot(structureAlbedo, vec3(0.2126, 0.7152, 0.0722)) * 0.32, 0.78, 1.05);'
    : 'diffuseColor.rgb = diffuse * clamp(structureAlbedo * 1.8, 0.25, 1.3);'}
        structureHeight = texture2D(uStructureRelief, structureUv).r * ${plaster ? '0.0015' : ceramic ? '0.002' : painted ? '0.003' : '0.006'};
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `vec3 structureBaseNormal = normal;
      #include <normal_fragment_maps>
      if (uStructureEnabled > 0.5)
        normal = structureSurfaceNormal(-vViewPosition, structureBaseNormal, structureHeight, faceDirection);`);
  };
  material.customProgramCacheKey = () => `${key}|structure-surface-v2-${plaster}-${painted}-${ceramic}-${local}`;
  return material;
}
