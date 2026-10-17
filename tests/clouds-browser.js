import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { loadCloudTextures } from '../src/cloud-texture.js';

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .5, 65000);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
document.body.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
const start = performance.now(), cloudMaps = await loadCloudTextures();
const atmosphere = createAtmosphere(scene, { cloudMaps }), buildMs = performance.now() - start;
const clouds = atmosphere.group.children.filter(object => object.isSprite && object.userData.kind);
let env, elapsed = 0, atlas = false, atlasPage = 0;
function preset(name) {
  atlas = false;
  clouds.forEach(cloud => { cloud.position.y = cloud.userData.origin.y; });
  camera.position.set(0, 5, 230); controls.target.set(0, 300, -600); controls.update();
  env = { hour: 12, daylight: 1, weather: 'sunny', season: 'summer', wind: .25, windSpeed: 5,
    rain: 0, storm: 0, snow: 0, fog: 0, cloudiness: .12, skyCloudCover: name === 'busy' ? .78 : name === 'empty' ? 0 : .38, moonLight: 0 };
  if (name === 'sunset') Object.assign(env, { hour: 17.8, daylight: .35, skyCloudCover: .65 });
  if (name === 'night') Object.assign(env, { hour: 22, daylight: 0, moonLight: .6, skyCloudCover: .45 });
  render();
}
function render() {
  camera.updateMatrixWorld(); atmosphere.update(elapsed, env, camera);
  if (atlas) {
    const representatives = Array.from(new Map(clouds.map(cloud => [cloud.material.map.userData.cloudId, cloud])).values())
      .sort((a, b) => a.material.map.userData.cloudId - b.material.map.userData.cloudId).slice(atlasPage * 8, atlasPage * 8 + 8);
    clouds.forEach(cloud => { cloud.visible = representatives.includes(cloud); });
    representatives.forEach((cloud, i) => {
      cloud.position.set((i % 4 - 1.5) * 290, (i < 4 ? 165 : -125), -600);
      cloud.scale.set(320, 245, 1); cloud.material.opacity = 1;
    });
  }
  renderer.render(scene, camera);
  document.getElementById('status').textContent = atlas ? `64 种云形 · 第 ${atlasPage + 1} / 8 组`
    : `可见云群 ${clouds.filter(cloud => cloud.visible).length} / ${clouds.length} · 大气准备 ${buildMs.toFixed(0)}ms`;
}
document.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => preset(button.dataset.preset));
function showAtlas() {
  preset('busy'); atlas = true;
  camera.position.set(0, 0, 300); controls.target.set(0, 0, -600); controls.update(); render();
}
document.getElementById('atlas').onclick = () => { atlasPage = 0; showAtlas(); };
document.getElementById('atlas-next').onclick = () => { atlasPage = (atlasPage + 1) % 8; showAtlas(); };
controls.addEventListener('change', () => { if (env) render(); });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); render(); });
window.cloudQA = { scene, camera, renderer, atmosphere, clouds, cloudMaps, render, buildMs };
preset('clear'); renderer.setSize(innerWidth, innerHeight); render();
window.addEventListener('pagehide', () => { controls.dispose(); atmosphere.dispose(); renderer.dispose(); });
