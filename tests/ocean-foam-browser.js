import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createOcean } from '../src/ocean.js';
import { createIsland } from '../src/island.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { loadCloudTextures } from '../src/cloud-texture.js';
import { getLagoonShelter, LAGOON_LAYOUT } from '../src/lagoon.js';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, .5, 65000);
const controls = new OrbitControls(camera, renderer.domElement);
const island = createIsland(scene);
const ocean = createOcean(scene, { heightAt: island.heightAt, shelterAt: getLagoonShelter });
const [cloudMaps, loaded] = await Promise.all([loadCloudTextures(), ocean.ready]);
const atmosphere = createAtmosphere(scene, { cloudMaps });
const uniforms = ocean.mesh.material.uniforms;
const env = { hour: 14.5, daylight: 1, weather: 'sunny', season: 'summer', wind: .48, windSpeed: 10,
  swell: .5, gust: .15, rain: 0, storm: 0, fog: 0, snow: 0, cloudiness: .12, skyCloudCover: .24, moonLight: .8 };
let texture = true, running = false, elapsed = 30, raf = null, last = performance.now();
function view(name) {
  const preset = name === 'lagoon' ? LAGOON_LAYOUT.view
    : name === 'sea' ? { position: [145, 4, 210], target: [200, .4, 80] }
    : { position: [115, 9, 51], target: [89, -1.15, 26] };
  camera.position.fromArray(preset.position); controls.target.fromArray(preset.target); controls.update(); render();
}
function render() {
  camera.updateMatrixWorld(); atmosphere.update(elapsed, env, camera);
  ocean.update(elapsed, { ...env, sunDirection: new THREE.Vector3(-.5, .8, -.3).normalize() });
  island.update(elapsed, env); uniforms.uFoamReady.value = texture && loaded ? 1 : 0;
  renderer.render(scene, camera);
  const map = uniforms.uFoamMap.value;
  const bytes = map.image.data.byteLength;
  document.getElementById('status').textContent = `${loaded ? '512×512 R8 贴图已加载' : '贴图未就绪，使用程序泡沫'} · ${texture ? '贴图' : '程序'}模式 · GPU纹理约 ${(bytes * 4 / 3 / 1024 / 1024).toFixed(2)} MiB（含mipmap） · ${renderer.info.render.calls}次绘制`;
}
function mode(next) {
  texture = next;
  document.getElementById('texture').setAttribute('aria-pressed', String(next));
  document.getElementById('procedural').setAttribute('aria-pressed', String(!next));
  render();
}
function tick(now) {
  raf = null;
  if (!running || document.hidden) return;
  elapsed += Math.min(.1, (now - last) / 1000); last = now; render(); raf = requestAnimationFrame(tick);
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => view(button.dataset.view));
document.getElementById('texture').onclick = () => mode(true);
document.getElementById('procedural').onclick = () => mode(false);
document.getElementById('animate').onclick = () => {
  running = !running; document.getElementById('animate').setAttribute('aria-pressed', String(running));
  if (running) { last = performance.now(); raf = requestAnimationFrame(tick); }
  else if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
};
document.getElementById('day').onclick = () => { Object.assign(env, { hour: 14.5, daylight: 1 }); render(); };
document.getElementById('night').onclick = () => { Object.assign(env, { hour: 22, daylight: 0 }); render(); };
controls.addEventListener('change', () => { if (!running) render(); });
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); render();
});
document.getElementById('benchmark').onclick = async event => {
  if (running) document.getElementById('animate').click();
  const button = event.currentTarget; button.disabled = true;
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const results = [];
  for (const next of [false, true, true, false]) {
    mode(next);
    const cpu = [], gpu = [], pending = [];
    for (let index = 0; index < 70; index++) {
      await new Promise(requestAnimationFrame);
      const query = ext && index >= 20 ? gl.createQuery() : null;
      if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      const start = performance.now(); render(); const duration = performance.now() - start;
      if (index >= 20) cpu.push(duration);
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
      for (let q = pending.length - 1; q >= 0; q--) if (gl.getQueryParameter(pending[q], gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(pending[q], gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(pending[q]); pending.splice(q, 1);
      }
    }
    pending.forEach(query => gl.deleteQuery(query));
    const median = values => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(2) : '不支持';
    results.push(`${next ? '贴图' : '程序'}：CPU提交 ${median(cpu)}ms / GPU ${median(gpu)}ms`);
    document.getElementById('timings').textContent = results.join('；');
  }
  mode(true); button.disabled = false;
};
view('coast');
window.addEventListener('pagehide', () => {
  running = false; if (raf !== null) cancelAnimationFrame(raf);
  controls.dispose(); atmosphere.dispose(); ocean.dispose(); island.dispose(); renderer.dispose();
});
