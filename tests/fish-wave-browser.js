import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFishWave } from '../src/models/fish-wave.js';
import { createOcean } from '../src/ocean.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { createIsland } from '../src/models/island.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .5, 65000);
camera.position.set(160, 68, 200);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 15, 0); controls.update();
const island = createIsland(scene), ocean = createOcean(scene, { heightAt: island.heightAt });
const atmosphere = createAtmosphere(scene);
const env = { hour: 17.5, daylight: .7, weather: 'sunny', season: 'summer', seasonIndex: 1,
  wind: .22, windSpeed: 5, rain: 0, snow: 0, storm: 0, fog: 0, cloudiness: .12, skyCloudCover: .12,
  sun: [-.6, .16, -.78], sunDirection: new THREE.Vector3(-.6, .16, -.78).normalize(), moonLight: 0 };
const age = document.getElementById('age'), quality = document.getElementById('quality');
let effect, time = 0, playing = false, previous, placementSeed = Math.random();
function reset(value = +age.value) {
  effect?.dispose();
  let samples = 0;
  effect = createFishWave(scene, { heightAt: island.heightAt, waterHeightAt: ocean.cameraWaterHeightAt,
    random: () => samples++ === 0 ? 0 : placementSeed });
  effect.setQuality(quality.value); time = 0;
  for (let frame = 0; frame <= (45.05 + value) * 20; frame++) {
    time = frame / 20; effect.update(time, env, camera);
  }
  render();
}
function render() {
  atmosphere.update(time, env, camera); island.update(time, env); ocean.update(time, env);
  effect.update(time, env, camera); renderer.render(scene, camera);
  document.getElementById('status').textContent = `${effect.phase} · ${quality.selectedOptions[0].textContent} · ${effect.group.getObjectByName('跃浪银鱼').count} 条 · ${renderer.info.render.calls} 次绘制`;
}
document.querySelectorAll('[data-age]').forEach(button => button.onclick = () => { age.value = button.dataset.age; reset(); });
document.querySelectorAll('[data-weather]').forEach(button => button.onclick = () => {
  env.weather = button.dataset.weather; env.typhoon = +(env.weather === 'typhoon'); env.blizzard = +(env.weather === 'blizzard'); reset();
});
document.getElementById('relocate').onclick = () => { placementSeed = Math.random(); reset(); };
age.oninput = () => reset(); quality.onchange = () => { effect.setQuality(quality.value); render(); };
document.getElementById('play').onclick = event => { playing = !playing; event.target.textContent = playing ? '暂停' : '播放'; };
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); render(); }
controls.addEventListener('change', () => { if (effect) render(); });
reset(); resize(); window.addEventListener('resize', resize);
renderer.setAnimationLoop(now => {
  const dt = previous === undefined ? 0 : Math.min(.1, (now - previous) / 1000); previous = now;
  if (!playing) return;
  time += dt; age.value = Math.min(25, time - 45.05); render();
  if (time > 70) { playing = false; document.getElementById('play').textContent = '播放'; }
});
window.fishWaveQA = { scene, camera, renderer, get effect() { return effect; }, reset, render };
window.addEventListener('pagehide', () => { renderer.setAnimationLoop(null); effect.dispose(); island.dispose(); ocean.dispose(); atmosphere.dispose(); controls.dispose(); renderer.dispose(); });
