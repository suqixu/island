import * as THREE from 'three';

const FOAM_SIZE = 512;
const foamUrl = new URL('./assets/textures/water/ocean-foam-mask-v1.bin', import.meta.url).href;

// Alpha contains foam density; transparent pixels can retain arbitrary RGB.
export function extractFoamMask({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || data?.length !== width * height * 4) throw new RangeError('泡沫像素尺寸不完整');
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index++) mask[index] = data[index * 4 + 3];
  return mask;
}

/** Prebaked R8 bytes already match the GPU mask. Waves animate only the UVs. */
export function createOceanFoamTexture({ signal, fetchMask = globalThis.fetch?.bind(globalThis) } = {}) {
  const texture = new THREE.DataTexture(new Uint8Array(FOAM_SIZE * FOAM_SIZE), FOAM_SIZE, FOAM_SIZE, THREE.RedFormat);
  texture.name = '海浪泡沫 · imagegen 单通道遮罩';
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let disposed = false;
  const ready = fetchMask && !controller.signal.aborted
    ? (async () => {
      try {
        const response = await fetchMask(foamUrl, { signal: controller.signal });
        if (!response.ok || disposed || controller.signal.aborted) return false;
        const mask = new Uint8Array(await response.arrayBuffer());
        if (disposed || controller.signal.aborted || mask.length !== FOAM_SIZE * FOAM_SIZE) return false;
        texture.image.data.set(mask);
        texture.needsUpdate = true;
        return true;
      } catch { return false; } // Offline or invalid masks retain procedural foam.
      finally {
        signal?.removeEventListener('abort', abort);
      }
    })() : Promise.resolve(false);
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    signal?.removeEventListener('abort', abort);
    texture.dispose();
  }
  return { texture, ready, dispose };
}
