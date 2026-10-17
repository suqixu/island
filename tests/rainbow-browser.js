import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { createOcean } from '../src/ocean.js';
import { createIsland } from '../src/island.js';

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, .5, 65000);
const controls = new OrbitControls(camera, renderer.domElement);
const atmosphere = createAtmosphere(scene);
const island = createIsland(scene);
const ocean = createOcean(scene, { heightAt: island.heightAt });
const sky = atmosphere.group.children.find(object => object.material?.uniforms?.uRainbowStrength);
const env = { hour: 14.5, daylight: 1, weather: 'sunny', season: 'summer', wind: .23,
  windSpeed: 4, rain: 0, storm: 0, fog: 0, snow: 0, cloudiness: .16, skyCloudCover: .26, moonLight: 0 };
atmosphere.update(0, { ...env, weather: 'rain', rain: 1 }, camera);
for (let frame = 1; frame <= 360; frame++) atmosphere.update(frame / 12, env, camera);
let mode = 'single', view = 'sea';
function setView(next) {
  view = next;
  island.group.visible = next === 'island';
  camera.position.set(...(next === 'island' ? [160, 68, 200] : [0, 5, 230]));
  controls.target.set(...(next === 'island' ? [0, 12, 0] : [0, 32, -600]));
  controls.update();
}
function render() {
  camera.updateMatrixWorld();
  atmosphere.update(30, env, camera);
  sky.material.uniforms.uRainbowSecondary.value = mode === 'double' ? .52 : 0;
  if (mode === 'off') sky.material.uniforms.uRainbowStrength.value = 0;
  island.update(30, env); ocean.update(30, { ...env, sunDirection: sky.material.uniforms.uSunDirection.value });
  renderer.render(scene, camera);
  document.getElementById('status').textContent = `${view === 'sea' ? '远海' : '海岛'} · ${mode} · 虹强度 ${sky.material.uniforms.uRainbowStrength.value.toFixed(2)}`;
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { setView(button.dataset.view); render(); });
document.querySelectorAll('[data-bow]').forEach(button => button.onclick = () => { mode = button.dataset.bow; render(); });
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); render(); }
window.addEventListener('resize', resize); controls.addEventListener('change', render);
window.rainbowQA = { scene, renderer, camera, atmosphere, sky, env, render };
setView('sea'); resize();
window.addEventListener('pagehide', () => { controls.dispose(); atmosphere.dispose(); ocean.dispose(); renderer.dispose(); });
