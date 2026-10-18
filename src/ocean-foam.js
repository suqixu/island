import * as THREE from 'three';

const FOAM_SIZE = 512;
const foamUrl = new URL('./assets/textures/water/ocean-foam-lace-v1.webp', import.meta.url).href;

// Alpha contains foam density; transparent pixels can retain arbitrary RGB.
export function extractFoamMask({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || data?.length !== width * height * 4) throw new RangeError('泡沫像素尺寸不完整');
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index++) mask[index] = data[index * 4 + 3];
  return mask;
}

/** Decode once at the GPU mask size. Waves animate UVs, never this pixel data. */
export function createOceanFoamTexture() {
  const texture = new THREE.DataTexture(new Uint8Array(FOAM_SIZE * FOAM_SIZE), FOAM_SIZE, FOAM_SIZE, THREE.RedFormat);
  texture.name = '海浪泡沫 · imagegen 单通道遮罩';
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const controller = new AbortController();
  let disposed = false;
  const ready = typeof document !== 'undefined' && typeof createImageBitmap === 'function'
    ? (async () => {
      let bitmap, canvas;
      try {
        const response = await fetch(foamUrl, { signal: controller.signal });
        if (!response.ok) return false;
        bitmap = await createImageBitmap(await response.blob(), {
          resizeWidth: FOAM_SIZE, resizeHeight: FOAM_SIZE, resizeQuality: 'high',
          premultiplyAlpha: 'none', colorSpaceConversion: 'none',
        });
        if (disposed) return false;
        canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(FOAM_SIZE, FOAM_SIZE)
          : Object.assign(document.createElement('canvas'), { width: FOAM_SIZE, height: FOAM_SIZE });
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return false;
        context.drawImage(bitmap, 0, 0, FOAM_SIZE, FOAM_SIZE);
        const mask = extractFoamMask(context.getImageData(0, 0, FOAM_SIZE, FOAM_SIZE));
        texture.image.data.set(mask);
        texture.needsUpdate = true;
        return true;
      } catch { return false; } // Offline/unsupported decode retains procedural foam.
      finally {
        bitmap?.close();
        if (canvas) canvas.width = canvas.height = 1;
      }
    })() : Promise.resolve(false);
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    texture.dispose();
  }
  return { texture, ready, dispose };
}
