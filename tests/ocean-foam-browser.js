import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createOcean } from '../src/ocean.js';
import { createIsland } from '../src/models/island.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { loadCloudTextures } from '../src/cloud-texture.js';
import { getLagoonShelter, LAGOON_LAYOUT } from '../src/lagoon.js';
import { createCameraSafety } from '../src/camera-safety.js';
import { getCaveCameraFloor } from '../src/models/island-cave.js';
import { loadCoastalSurfaces } from '../src/coastal-surfaces.js';
import { loadLeafTextures } from '../src/leaf-texture.js';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, .5, 65000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=6;controls.maxDistance=700;
const island = createIsland(scene);
const ocean = createOcean(scene, { heightAt: island.heightAtRendered, shelterAt: getLagoonShelter });
const cameraSafety=createCameraSafety(camera,controls,{heightAt:island.heightAtRendered,
  waterHeightAt:(x,z)=>ocean.cameraWaterHeightAt(x,z),interiorFloorAt:getCaveCameraFloor});
const [cloudMaps, loaded, coastalMaps, leafMaps] = await Promise.all([loadCloudTextures(), ocean.ready, loadCoastalSurfaces(), loadLeafTextures()]);
island.setCoastalMaps(coastalMaps);
island.setLeafMaps(leafMaps);
const atmosphere = createAtmosphere(scene, { cloudMaps });
const uniforms = ocean.mesh.material.uniforms;
const env = { hour: 14.5, daylight: 1, weather: 'sunny', season: 'summer', wind: .48, windSpeed: 10,
  swell: .5, gust: .15, rain: 0, storm: 0, fog: 0, snow: 0, cloudiness: .12, skyCloudCover: .24, moonLight: .8 };
let texture = true, running = false, elapsed = 30, raf = null, last = performance.now();
function view(name) {
  const preset = name === 'beach' ? { position: [-25.4,3.1,74.3], target: [-41,.3,113] } : name === 'island' ? { position: [210, 62, 250], target: [0, 9, 0] } : name === 'lagoon' ? LAGOON_LAYOUT.view
    : name === 'sea' ? { position: [145, 4, 210], target: [200, .4, 80] }
    : { position: [115, 9, 51], target: [89, -1.15, 26] };
  camera.position.fromArray(preset.position); controls.target.fromArray(preset.target); controls.update(); render();
}
function render() {
  ocean.update(elapsed, { ...env, sunDirection: new THREE.Vector3(-.5, .8, -.3).normalize() });
  cameraSafety.update();camera.updateMatrixWorld();atmosphere.update(elapsed, env, camera);
  island.update(elapsed, env); uniforms.uFoamReady.value = texture && loaded ? 1 : 0;
  renderer.render(scene, camera);
  const map = uniforms.uFoamMap.value;
  const bytes = map.image.data.byteLength;
  const stats=sprayStats();
  document.getElementById('status').textContent = `${loaded ? '512×512 R8 贴图已加载' : '贴图未就绪，使用程序泡沫'} · ${texture ? '贴图' : '程序'}模式 · 海面遮罩约 ${(bytes * 4 / 3 / 1024 / 1024).toFixed(2)} MiB（含mipmap） · ${renderer.info.render.calls}次绘制 · ${stats.count}个飞溅水滴/水雾 · ${stats.crowns??0}簇贴图破浪 · ${atmosphere.lightningActive?'闪电照亮中':'无闪电'}`;
}
function sprayStats() {
  const spray=scene.getObjectByName('拍岸浪花');
  if(!spray)return {count:0,peak:0,x:0,z:0};
  const a=spray.geometry.attributes;let count=0,peak=0,x=0,z=0,best=0;
  for(let i=0;i<a.aAlpha.count;i++)if(a.aAlpha.array[i]>.12) {
    count++;const y=a.position.array[i*3+1];
    peak=Math.max(peak,y);
    const score=(a.aKind.array[i]>1.5?3:0)+a.aAlpha.array[i]+Math.min(y,8)*.03;
    if(score>best){best=score;x=a.position.array[i*3];z=a.position.array[i*3+2];}
  }
  const crownsMesh=scene.getObjectByName('拍岸破浪水冠');let crowns=0,freshCrown=false;
  if(crownsMesh?.material.uniforms.uSprayReady.value) {
    const c=crownsMesh.geometry.attributes;let score=0;
    for(let i=0;i<crownsMesh.geometry.instanceCount;i++)if(c.aAlpha.array[i]>.05){
      crowns++;
      const fresh=c.aMist.array[i]<.2&&c.aHeight.array[i]>4&&c.aAlpha.array[i]>.2;
      const value=c.aAlpha.array[i]*c.aHeight.array[i]*(1-c.aMist.array[i]);
      if(fresh&&value>score){score=value;freshCrown=true;x=c.aCenter.array[i*3];z=c.aCenter.array[i*3+2];}
    }
  }
  return {count,peak,x,z,crowns,freshCrown};
}
document.getElementById('impact').onclick=()=>{
  if(running)document.getElementById('animate').click();
  if(!env.typhoon)document.getElementById('typhoon').click();
  let stats;
  for(let i=0;i<900;i++) {
    elapsed+=.04;ocean.update(elapsed,env);atmosphere.update(elapsed,env,camera);
    stats=sprayStats();if(stats.freshCrown&&stats.count>15)break;
  }
  if(stats.count) {
    controls.target.set(stats.x,3,stats.z);
    camera.position.set(stats.x-env.windDirection[0]*48,16,stats.z-env.windDirection[1]*48);
    controls.update();
  }
  render();
};
document.getElementById('flash').onclick=()=>{
  if(running)document.getElementById('animate').click();
  if(!env.typhoon)document.getElementById('typhoon').click();
  view('island');
  const sky=atmosphere.group.children.find(object=>object.material?.uniforms?.uLightning);
  for(let i=0;i<1200;i++) {
    elapsed+=.01;atmosphere.update(elapsed,env,camera);ocean.update(elapsed,env);
    if(sky.material.uniforms.uLightning.value>.95)break;
  }
  render();
};
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
document.getElementById('typhoon').onclick = () => {
  Object.assign(env, { weather: 'typhoon', typhoon: 1, wind: 1, windSpeed: 48, swell: .95, gust: .85, rain: 1, storm: 1, cloudiness: .99, skyCloudCover: 1, windDirection: [-.7, -.714] });
  for (let i = 0; i < 100; i++) { elapsed += .1; ocean.update(elapsed, env); atmosphere.update(elapsed, env, camera); }
  render();
};
document.getElementById('sunny').onclick = () => {
  Object.assign(env, { weather: 'sunny', typhoon: 0, wind: .48, windSpeed: 10, swell: .5, gust: .15, rain: 0, storm: 0, cloudiness: .12, skyCloudCover: .24 });
  for (let i = 0; i < 100; i++) { elapsed += .1; ocean.update(elapsed, env); atmosphere.update(elapsed, env, camera); }
  render();
};
document.getElementById('step').onclick = () => { for (let i = 0; i < 20; i++) { elapsed += .1; ocean.update(elapsed, env); atmosphere.update(elapsed, env, camera); } render(); };
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

document.getElementById('hide-tools').onclick=()=>{document.querySelector('aside').hidden=true;document.getElementById('show-tools').hidden=false;};
document.getElementById('show-tools').onclick=()=>{document.querySelector('aside').hidden=false;document.getElementById('show-tools').hidden=true;};
