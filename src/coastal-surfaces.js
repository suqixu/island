import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';
import { SAND_SURFACE_GLSL } from './sand-surface.js';

const urls = {
  sand: new URL('./assets/textures/terrain/beach-fine-sand-albedo-v2.webp', import.meta.url).href,
  lagoon: new URL('./assets/textures/terrain/lagoon-sandbed-albedo-v1.webp', import.meta.url).href,
  stone: new URL('./assets/textures/terrain/weathered-step-stone-albedo-v1.webp', import.meta.url).href,
};

/** Optional detail assets: each failed map retains its procedural fallback. */
export async function loadCoastalSurfaces({signal}={}) {
  const loader = new THREE.TextureLoader();
  return Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([name,url]) => {
    const map=await loadOptionalResource(async()=>{
      const map = await loader.loadAsync(url);
      map.name = `Imagegen coastal ${name}`;
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 4;
      return map;
    },{signal,dispose:value=>value?.dispose()});
    return [name,map];
  })));
}

export function createCoastalSurfaceUniforms() {
  return {
    uSandMap: {value:null}, uSandMapEnabled: {value:0},
    uLagoonMap: {value:null}, uLagoonMapEnabled: {value:0},
    uStepMap: {value:null}, uStepMapEnabled: {value:0},
  };
}

// Metres, rather than mesh UVs, keep the grain consistent across the beach,
// sand spit and path edges. Stone uses three axes so risers never smear.
export const COASTAL_SURFACE_GLSL = /* glsl */ `
  ${SAND_SURFACE_GLSL}
  uniform sampler2D uSandMap;
  uniform float uSandMapEnabled;
  uniform sampler2D uLagoonMap;
  uniform float uLagoonMapEnabled;
  uniform sampler2D uStepMap;
  uniform float uStepMapEnabled;
  vec3 coastalSand(vec3 p) {
    vec2 uv = p.xz / 1.8;
    vec3 grain = texture2D(uSandMap,uv).rgb * 0.72
      + texture2D(uSandMap,vec2(-uv.y,uv.x) * 0.83 + vec2(0.37,0.61)).rgb * 0.28;
    return mix(vec3(0.76,0.67,0.52),grain,0.50);
  }
  vec3 lagoonSediment(vec3 p) {
    vec2 uv = vec2(p.x * 0.94 + p.z * 0.34, -p.x * 0.34 + p.z * 0.94) / 3.4;
    return mix(vec3(0.64,0.56,0.40),texture2D(uLagoonMap,uv).rgb,0.52);
  }
  vec3 coastalStep(vec3 p) {
    vec3 w = pow(abs(normalize(cross(dFdx(p),dFdy(p)))),vec3(4.0));
    w /= max(dot(w,vec3(1.0)),0.0001);
    return texture2D(uStepMap,p.yz / 1.35).rgb * w.x
      + texture2D(uStepMap,p.xz / 1.35).rgb * w.y
      + texture2D(uStepMap,p.xy / 1.35).rgb * w.z;
  }
`;
