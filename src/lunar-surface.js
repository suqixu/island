import * as THREE from 'three';
import moonSurfaceUrl from './assets/moon-lroc-2k.jpg';

/**
 * NASA CGI Moon Kit: LRO / LROC's real lunar surface color map.
 * The equirectangular image has north at the top and longitude 0 at its center.
 * Source: https://svs.gsfc.nasa.gov/4720/
 */
export async function loadLunarSurface() {
  const texture = await new THREE.TextureLoader().loadAsync(moonSurfaceUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.name = 'NASA LRO / LROC lunar surface';
  return texture;
}
