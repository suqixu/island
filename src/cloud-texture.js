import volumes from './assets/data/cloud-volumes.json' with { type: 'json' };
import * as THREE from 'three';

const atlasUrls = [
  new URL('./assets/images/cloud-atlas-v1.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v2.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v3.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v4.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v5.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v6.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v7.png', import.meta.url).href,
  new URL('./assets/images/cloud-atlas-v8.png', import.meta.url).href,
];
const cloudKinds = ['cumulus', 'cumulus', 'tower', 'cumulus', 'altocumulus', 'cirrus', 'cumulus', 'altocumulus'];

export async function loadCloudTextures() {
  const loader = new THREE.TextureLoader();
  // Wait for every request so a failed load cannot strand completed GPU assets.
  const results = await Promise.allSettled(atlasUrls.map(url => loader.loadAsync(url)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    throw failure.reason;
  }
  return results.flatMap(({ value: atlas }, sheet) => {
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    return cloudKinds.map((kind, cell) => {
      const map = cell === 0 ? atlas : atlas.clone();
      map.repeat.set(.248, .496);
      map.offset.set((cell % 4) * .25 + .001, cell < 4 ? .502 : .002);
      map.userData = { cloudKind: kind, cloudId: sheet * 8 + cell };
      map.needsUpdate = true;
      return map;
    });
  });
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

// Original 3D density volumes are baked by scripts/render-cloud-volumes.py.
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
