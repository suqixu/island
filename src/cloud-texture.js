import volumes from './assets/data/cloud-volumes.json' with { type: 'json' };
import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

// Default startup loads v1. The other sheets are requested only for all-cloud mode.
const atlasUrls = [
  new URL('./assets/textures/sky/cloud-atlas-v1.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v2.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v3.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v4.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v5.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v6.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v7.webp', import.meta.url).href,
  new URL('./assets/textures/sky/cloud-atlas-v8.webp', import.meta.url).href,
];
const cloudKinds = ['cumulus', 'cumulus', 'tower', 'cumulus', 'altocumulus', 'cirrus', 'cumulus', 'altocumulus'];

export async function loadCloudTextures({signal, atlas = 1}={}) {
  const sheets=atlas==='all'?atlasUrls.map((_,index)=>index):atlas==='additional'
    ? atlasUrls.slice(1).map((_,index)=>index+1)
    : [Number.isInteger(atlas)&&atlas>=1&&atlas<=atlasUrls.length?atlas-1:0];
  return loadOptionalResource(async()=>{
    const loader = new THREE.TextureLoader();
    const results=await Promise.allSettled(sheets.map(sheet=>loader.loadAsync(atlasUrls[sheet])));
    const failure=results.find(result=>result.status==='rejected');
    if(failure){
      results.forEach(result=>{if(result.status==='fulfilled')result.value.dispose();});
      throw failure.reason;
    }
    return results.flatMap(({value:mapAtlas},index)=>{
      const sheet=sheets[index];
      mapAtlas.colorSpace = THREE.SRGBColorSpace;
      mapAtlas.minFilter = THREE.LinearFilter;
      mapAtlas.magFilter = THREE.LinearFilter;
      mapAtlas.generateMipmaps = false;
      return cloudKinds.map((kind, cell) => {
        const map = cell === 0 ? mapAtlas : mapAtlas.clone();
        map.repeat.set(.248, .496);
        map.offset.set((cell % 4) * .25 + .001, cell < 4 ? .502 : .002);
        map.userData = { cloudKind: kind, cloudId: sheet * 8 + cell };
        map.needsUpdate = true;
        return map;
      });
    });
  },{signal,fallback:undefined,dispose:maps=>maps?.forEach(map=>map.dispose()),
    onFallback:error=>console.warn('云图未就绪，保留本地云体',error)});
}

// Deal every silhouette once before reusing it; shuffling never mutates the
// loader's shared map list or changes the lighting direction baked in a sprite.
export function shuffleCloudMaps(maps, random = Math.random) {
  const shuffled = maps.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const decoded = new Map();
function unpack(volume) {
  if (decoded.has(volume.seed)) return decoded.get(volume.seed);
  const packed = atob(volume.pixels), result = new Uint8Array(volume.width * volume.height * 4);
  let source = 0, target = 0;
  while (source < packed.length) {
    const header = packed.charCodeAt(source++);
    if (header >= 128) {
      const count = header - 125, value = packed.charCodeAt(source++);
      result.fill(value, target, target + count); target += count;
    } else {
      for (let count = header + 1; count > 0; count--) result[target++] = packed.charCodeAt(source++);
    }
  }
  if (target !== result.length) throw new Error('云体光照数据长度不完整');
  decoded.set(volume.seed, result);
  return result;
}

// Original 3D density volumes are baked by scripts/assets/render-cloud-volumes.py.
// Their view-ray extinction and sunlight scattering retain soft internal
// shadows. Synchronous decoding keeps them ready before the first frame.
export function createCloudTextureData(seed, { kind = 'cumulus', width, height } = {}) {
  const choices = volumes.filter(volume => volume.kind === kind);
  const volume = choices.find(volume => volume.seed === seed) ?? choices[(seed >>> 0) % choices.length];
  if (!volume) throw new Error(`未知云体类型：${kind}`);
  const original = unpack(volume);
  width ??= volume.width; height ??= volume.height;
  if (width === volume.width && height === volume.height) return { data: original, width, height };
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.min(volume.width - 1, Math.round(x * (volume.width - 1) / (width - 1)));
    const sourceY = Math.min(volume.height - 1, Math.round(y * (volume.height - 1) / (height - 1)));
    const source = (sourceY * volume.width + sourceX) * 4, target = (y * width + x) * 4;
    data.set(original.subarray(source, source + 4), target);
  }
  return { data, width, height };
}
