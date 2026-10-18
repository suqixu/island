import loadingConfig from './config/loading.json' with {type:'json'};
import { DEFAULTS, WEATHER_CONFIG, CAMERA_CONFIG, RENDERING_CONFIG, initializeSettingInputs } from './runtime-config.js';
import musicConfig from './config/music.json' with {type:'json'};
import {prepareAuroraPreview} from './aurora.js';
import * as THREE from 'three';
import { getAnimationRate } from './animation-time.js';
import { createSolarEclipse } from './solar-eclipse.js';
import { createLunarEclipse, getLunarEclipseEnvironment, getLunarEclipseSeaHorizon } from './lunar-eclipse.js';
import { getArtificialLightControls } from './artificial-light-controls.js';
import { createSunsetBirds } from './sunset-birds.js';
import { createDetailFocus } from './detail-focus.js';
import { createCameraSafety } from './camera-safety.js';
import { getCaveCameraFloor } from './models/island-cave.js';
import { getConstellationViewFov } from './constellation-framing.js';
import { loadRockSurface } from './rock-surface.js';
import { loadCoastalSurfaces } from './coastal-surfaces.js';
import { loadLeafTextures } from './leaf-texture.js';
import { loadCaveSurface } from './cave-surface.js';
import { loadDockSurfaces, loadLighthouseSurfaces, loadPavilionRoofSurfaces, createStructureSurfaceState } from './structure-surfaces.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createBloomPass } from './bloom.js';
import { createScreenOutputPass } from './screen-output-pass.js';
import { createIslandAsync } from './models/island.js';
import { nextStartupPaint } from './startup-tasks.js';
import { createOcean } from './ocean.js';
import { createMarine } from './models/marine.js';
import { createSailboats } from './models/sailboats.js';
import { createLagoonLife } from './models/lagoon-life.js';
import { createLighthouse } from './models/lighthouse.js';
import { LIGHTHOUSE_SITE } from './lighthouse-layout.js';
import { createPathLamps } from './models/path-lamps.js';
import { createRestPavilion } from './models/rest-pavilion.js';
import { REST_PAVILION_SITES } from './rest-pavilion-layout.js';
import { createPavilionSurfaceSampler } from './rest-pavilion-surface.js';
import { getIslandPathLayout, PATH_LIFT } from './path-layout.js';
import { createAtmosphere } from './atmosphere.js';
import { loadCloudTextures } from './cloud-texture.js';
import {createCloudTexturePool} from './cloud-texture-pool.js';
import {selectWeather,getWeatherButtonState} from './weather-controls.js';
import { createCloudCoverState, advanceCloudCover } from './cloud-cover.js';
import { getSeaHorizonState } from './sea-horizon.js';
import { CAVE_LAYOUT } from './cave-layout.js';
import { getLagoonShelter } from './lagoon.js';
import { loadLunarSurface } from './lunar-surface.js';
import { getMoonBackdropDirection, MOON_VIEW_POLAR_LIMITS } from './moon-framing.js';
import { getSunBackdropState, getSunVisibility } from './sun-framing.js';
import openingSealUrl from './assets/ui/zzy-seal.webp?url';
import { createSimulation, advanceSimulation, getEnvironment, finishMoonNight } from './simulation.js';
import { MOON_PHASES, LUNAR_CYCLE_DAYS } from './moon.js';
import { createDeferredPoetry } from './deferred-poetry.js';
import { createDraggablePanel } from './draggable-panel.js';
import { createUpdateHistory } from './update-history.js';
import { loadOptionalResource } from './resource-loading.js';
import { createFrameLoop } from './frame-loop.js';
import { createCleanupScope } from './cleanup-scope.js';
import { startSoundOnFirstGesture } from './sound-gesture.js';
import { loadingScreen } from './loading-screen-entry.js';

const $ = (id) => document.getElementById(id);
const paths = {
  next: '<path d="m5 4 10 8L5 20V4Z"/><path d="M19 4v16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  cloud: '<path d="M6 18a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 1 1 18 18H6Z"/>',
  rain: '<path d="M6 14a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 0 1 18 14M8 17l-1 3m6-3-1 3m6-3-1 3"/>',
  fog: '<path d="M7 11a4 4 0 1 1 1.4-7.7 5 5 0 0 1 9.4 2.7 3 3 0 0 1 1.2 5M3 15h18M5 19h14"/>',
  storm: '<path d="M6 14a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 0 1 18 14M13 12l-4 6h4l-2 5 6-8h-4l2-3"/>',
  typhoon: '<path d="M20 5c-5-4-13-1-13 5a5 5 0 0 0 9 3M4 19c5 4 13 1 13-5a5 5 0 0 0-9-3"/><circle cx="12" cy="12" r="2"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 10l4-1-1-4M19.5 14l-4 1 1 4M7.5 19l1-4-4-1M16.5 5l-1 4 4 1"/>',
  constellation: '<path d="m5 6 6 3 7-5m-7 5-3 9 11 1-1-9"/><circle cx="5" cy="6" r="1.3"/><circle cx="11" cy="9" r="1.3"/><circle cx="18" cy="4" r="1.3"/><circle cx="8" cy="18" r="1.3"/><circle cx="19" cy="19" r="1.3"/>',
  meteor: '<path d="m4 3 11 11M3 9l7 7M10 3l8 8"/><path d="m17 13 1.2 2.8L21 17l-2.8 1.2L17 21l-1.2-2.8L13 17l2.8-1.2L17 13Z"/>',
  aurora: '<path d="M3 16c2-10 4 4 6-6s4 6 6-2 4 1 6-4M3 21c2-10 4 4 6-6s4 6 6-2 4 1 6-4"/><path d="M6 13v4m6-8v5m6-7v4"/>',
  comet: '<circle cx="17" cy="17" r="3.2"/><path d="M14 16 3 5l13 9M16 13 9 3l9 11M13 18 3 11l11 9"/>',
  instant: '<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>',
  eclipse: '<circle cx="12" cy="12" r="5"/><path d="M12 7a5 5 0 0 1 0 10 6 6 0 0 0 0-10Z" fill="currentColor"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  lunar: '<circle cx="12" cy="12" r="8.5"/><path d="M7 5a10 10 0 0 1 12 12A8.5 8.5 0 0 0 7 5Z" fill="currentColor" opacity=".65"/>',
  lights: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.5-1 2H9c0-.5 0-1.2-1-2ZM12 1v1M3 5l1.5 1M21 5l-1.5 1M2 12h2m16 0h2"/>',
  labels: '<path d="M4 5h16M4 12h12M4 19h16"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="#365346"/><circle cx="15" cy="12" r="2" fill="#365346"/><circle cx="8" cy="18" r="2" fill="#365346"/>',
  cycle: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/>',
  rate: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-25 12 12)"/>',
  drag: '<path d="M8 13V6a2 2 0 0 1 4 0v5M12 10a2 2 0 0 1 4 0v2m0-1a2 2 0 0 1 4 0v4c0 5-3 7-6 7h-1c-3 0-5-3-7-6l-2-3a2 2 0 0 1 3-2l1 1"/>',
};
paths['cloud-few']=`<g transform="translate(3 2) scale(.75)" stroke-width="1.9">${paths.cloud}</g>`;
paths['cloud-medium']=`<g transform="translate(0 -1) scale(.65)" stroke-width="2.1">${paths.cloud}</g><g transform="translate(8 7) scale(.65)" stroke-width="2.1">${paths.cloud}</g>`;
paths['cloud-many']=`<g transform="translate(0 -1) scale(.52)" stroke-width="2.5">${paths.cloud}</g><g transform="translate(11 -1) scale(.52)" stroke-width="2.5">${paths.cloud}</g><g transform="translate(5.5 8) scale(.52)" stroke-width="2.5">${paths.cloud}</g>`;
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }
// Cache the eight silhouettes; automatic cycling only replaces a changed phase.
const moonPhaseIcons = MOON_PHASES.map(({ phase }) => {
  const waxing = phase <= .5;
  const terminator = Math.cos(phase * Math.PI * 2);
  const radius = Math.abs(terminator) * 9;
  const returnArc = radius < .001 ? 'L12 3' : `A${radius.toFixed(3)} 9 0 0 ${waxing ? Number(terminator < 0) : Number(terminator >= 0)} 12 3`;
  const lit = phase === 0 ? '' : `<path d="M12 3A9 9 0 0 ${waxing ? 1 : 0} 12 21${returnArc}Z" fill="currentColor"/>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>${lit}</svg>`;
});
document.querySelectorAll('[data-icon]').forEach((el) => el.innerHTML = icon(el.dataset.icon));
$('sound-toggle').innerHTML = icon('mute');
$('capture').innerHTML = icon('camera');
$('fullscreen').innerHTML = icon('expand');
$('settings-icon').innerHTML = icon('settings');
$('tour-icon').innerHTML = icon('orbit');

let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200); }

const islandStageLabels = loadingConfig.islandStages;

async function boot() {
  const cleanup = createCleanupScope({ onFailure: loadingFailed });
  const startupController = new AbortController();
  cleanup.add(() => startupController.abort());
  // DOM property handlers also retain the scene; restore their pre-boot values.
  const handlers = [...document.querySelectorAll('button, input, select, [data-view], [data-season], [data-weather]')]
    .map(element => [element, element.onclick, element.oninput, element.onchange]);
  cleanup.add(() => {
    for (const [element, onclick, oninput, onchange] of handlers) Object.assign(element, { onclick, oninput, onchange });
    handlers.length = 0;
    clearTimeout(toastTimer);
  });
  await cleanup.run(async () => {
  const startup = { startedAt: performance.now(), stages: [], slices: [] };
  async function stage(name, label, build) {
    loadingScreen.setStage(label);
    await nextStartupPaint();
    const start = performance.now();
    try {
      const resource = await build();
      if (resource?.dispose) cleanup.add(() => resource.dispose());
      return resource;
    }
    finally { startup.stages.push({ stage: name, durationMs: performance.now() - start }); }
  }
  await nextStartupPaint();
  // The save button renders immediately before toBlob; normal frames need no
  // persistent canvas buffer in addition to the composer's render targets.
  // Scene geometry renders into the composer; its final full-screen output
  // gains nothing from a second multisampled default framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: RENDERING_CONFIG.renderer.antialias, powerPreference: RENDERING_CONFIG.renderer.powerPreference });
  cleanup.add(() => renderer.forceContextLoss());
  cleanup.add(() => renderer.domElement.remove());
  cleanup.add(() => renderer.dispose());
  const initialQuality = RENDERING_CONFIG.qualityOptions.find(option => option.value === RENDERING_CONFIG.defaultQuality);
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, initialQuality.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = RENDERING_CONFIG.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = initialQuality.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('scene').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sunsetBirds = createSunsetBirds();scene.add(sunsetBirds.group);
  cleanup.add(() => sunsetBirds.dispose());
  const camera = new THREE.PerspectiveCamera(innerWidth < CAMERA_CONFIG.mobileBreakpoint ? CAMERA_CONFIG.fov.mobile : CAMERA_CONFIG.fov.desktop, innerWidth / innerHeight, CAMERA_CONFIG.near, CAMERA_CONFIG.far);
  const mobileScale = innerWidth < CAMERA_CONFIG.mobileBreakpoint ? CAMERA_CONFIG.mobileScale : 1;
  camera.position.set(...CAMERA_CONFIG.views.island.position.map(value => value * mobileScale));
  const controls = new OrbitControls(camera, renderer.domElement);
  cleanup.add(() => controls.dispose());
  controls.target.set(...CAMERA_CONFIG.views.island.target);
  const { maxPolarAnglePi, ...orbitSettings } = CAMERA_CONFIG.orbit;
  Object.assign(controls, orbitSettings, { autoRotate: DEFAULTS.interface.autoRotate });
  controls.maxPolarAngle = Math.PI * maxPolarAnglePi;
  controls.update();
  // Fetch assets while CPU construction runs. Capture rejection immediately so
  // a fast network failure cannot become an unhandled rejection before use.
  const assetStart = performance.now();
  const resources = Promise.all([
    loadLunarSurface({signal:startupController.signal}).then(value => ({ value, transfer: cleanup.add(() => value?.dispose()) })),
    loadCloudTextures({signal:startupController.signal}).then(value => ({ value, transfer: cleanup.add(() => value?.forEach(map => map.dispose())) })),
    loadRockSurface({signal:startupController.signal}).then(value => ({ value, transfer: cleanup.add(() => value?.dispose()) })),
  ])
    .then(values => ({ values }), error => ({ error }))
    .finally(() => startup.stages.push({ stage: 'assets', durationMs: performance.now() - assetStart }));
  const island = await stage('island', loadingConfig.startupStages['island'], () => createIslandAsync(scene, {
    onProgress: name => loadingScreen.setStage(islandStageLabels[name]),
    onSlice: slice => startup.slices.push(slice),
  }));
  const ocean = await stage('ocean', loadingConfig.startupStages['ocean'], () =>
    createOcean(scene, { heightAt: island.heightAtRendered, shelterAt: getLagoonShelter }));
  const cameraSafety=createCameraSafety(camera,controls,{heightAt:island.heightAtRendered,
    interiorFloorAt:getCaveCameraFloor,waterHeightAt:(x,z)=>ocean.cameraWaterHeightAt(x,z)});
  const marine = await stage('marine', loadingConfig.startupStages['marine'], () => createMarine(scene, { heightAt: island.heightAt }));
  const sailboats = await stage('sailboats', loadingConfig.startupStages['sailboats'], () => createSailboats(scene, { heightAt: island.heightAt }));
  const lagoonLife = await stage('lagoon-life', loadingConfig.startupStages['lagoon-life'], () =>
    createLagoonLife(scene, { heightAt: island.heightAtRendered }));
  const lighthouse = await stage('lighthouse', loadingConfig.startupStages['lighthouse'], () => createLighthouse(scene, { ...LIGHTHOUSE_SITE, heightAt: island.heightAtRendered,
    approach: { ...LIGHTHOUSE_SITE.approach,
      y: island.heightAtRendered(LIGHTHOUSE_SITE.approach.x, LIGHTHOUSE_SITE.approach.z) + PATH_LIFT } }));
  const pathLamps = await stage('path-lamps', loadingConfig.startupStages['path-lamps'], () => createPathLamps(scene, { heightAt: island.heightAtRendered,
    layout: getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach }) }));
  const pavilionSurface = createPavilionSurfaceSampler(island, REST_PAVILION_SITES);
  const restPavilions = [];
  const pavilionRoofSurface = createStructureSurfaceState();
  cleanup.add(() => pavilionRoofSurface.dispose());
  for (const site of REST_PAVILION_SITES) {
    const pavilion = await stage(`pavilion-${site.id}`, loadingConfig.startupStages.pavilion, () => createRestPavilion(scene, { ...site, heightAt: pavilionSurface,
      stoneSurface: island.group.getObjectByName('山径天然石阶'),
      approach: { ...site.approach, y: pavilionSurface(site.approach.x, site.approach.z) } }));
    pavilion.group.name = `${site.id === 'south' ? '南峰' : '东峰'}观景木亭`;
    restPavilions.push(pavilion);
  }
  const loaded = await stage('resource-wait', loadingConfig.startupStages['resource-wait'], () => resources);
  if (loaded.error) throw loaded.error;
  const [moonAsset, cloudAsset, rockAsset] = loaded.values;
  island.setRockMap(rockAsset.value);rockAsset.transfer();
  const moonMap = moonAsset.value, cloudMaps = cloudAsset.value;
  const atmosphere = await stage('atmosphere', loadingConfig.startupStages['atmosphere'], () => createAtmosphere(scene, { moonMap, cloudMaps, terrainHeightAt: island.heightAtRendered }));
  // Atmosphere's disposal now owns these textures, including the shared atlas.
  moonAsset.transfer(); cloudAsset.transfer();
  const poetry = createDeferredPoetry({
    load: async signal => {
      const module = await loadOptionalResource(() => import('./poetry.js'), {signal});
      if (!module || signal.aborted) throw new Error('诗句模块未就绪');
      const font = await module.loadPoetryFont({signal});
      if (!font || signal.aborted) throw new Error('书法字体未就绪');
      return module.createPoetry(scene, camera, {
        font,
        getFocusDistance: () => camera.position.distanceTo(controls.target),
        onCueChange: text => { $('poem-caption').textContent = text; },
        onComplete: () => finishMoonNight(state),
      });
    },
    onError: error => {
      console.warn('诗句暂时无法开启', error);
      toast('诗句暂时无法开启，请稍后再试');
    },
    onChange: refreshPoetryControls,
  });
  cleanup.add(() => poetry.dispose());
  function refreshPoetryControls() {
    $('poem-toggle').classList.toggle('enabled', poetry.enabled);
    $('poem-toggle').setAttribute('aria-pressed', String(poetry.enabled));
    $('poem-toggle').setAttribute('aria-label', poetry.enabled ? '关闭诗意字幕' : '开启诗意字幕');
    $('poem-caption').hidden = !poetry.enabled;
  }
  refreshPoetryControls();
  $('poem-toggle').onclick = () => poetry.setEnabled(!poetry.enabled);
  let zenMode = false, uiBeforeZen = [];
  const zenButton = $('zen-toggle');
  zenButton.disabled = false;
  zenButton.onclick = () => {
    zenMode = !zenMode;
    if (zenMode) {
      uiBeforeZen = [...document.querySelectorAll('[data-zen-ui]')].map(element => ({element, inert:element.inert}));
      uiBeforeZen.forEach(({element}) => { element.inert = true; });
    } else {
      uiBeforeZen.forEach(({element, inert}) => { element.inert = inert; });
      uiBeforeZen = [];
    }
    document.body.classList.toggle('zen-mode', zenMode);
    zenButton.innerHTML = zenMode ? '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></g></svg>' : '禅';
    zenButton.setAttribute('aria-pressed', String(zenMode));
    zenButton.setAttribute('aria-label', zenMode ? '退出禅模式，显示全部界面' : '进入禅模式');
    zenButton.title = zenMode ? '显示全部界面' : '禅模式 · 隐藏全部界面';
  };
  const openingSeal = $('opening-seal'), sealImage = $('opening-seal-image');
  sealImage.src = openingSealUrl;
  let sealAnimation, sealDisposed = false;
  cleanup.add(() => { sealDisposed = true; sealAnimation?.cancel(); });
  async function showOpeningSeal() {
    try { await sealImage.decode(); } catch { return; }
    if (sealDisposed) return;
    openingSeal.hidden = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anchor = openingSeal.getBoundingClientRect();
    const centerX = innerWidth / 2 - (anchor.left + anchor.width / 2);
    const centerY = innerHeight / 2 - (anchor.top + anchor.height / 2);
    const giantScale = Math.min(innerWidth * .64, innerHeight * .44, 360) / anchor.width;
    const centered = `translate3d(${centerX}px,${centerY}px,0) scale(${giantScale})`;
    const keyframes = reducedMotion ? [{opacity:0},{opacity:1}] : [
      {opacity:0, transform:`translate3d(${centerX}px,${centerY - 18}px,0) scale(${giantScale * 1.14})`, offset:0},
      {opacity:1, transform:centered, offset:.16},
      {opacity:1, transform:centered, offset:.42, easing:'cubic-bezier(.4,0,.2,1)'},
      {opacity:1, transform:'translate3d(0,0,0) scale(1)', offset:.90},
      {opacity:1, transform:'translate3d(0,0,0) scale(1)', offset:1},
    ];
    sealAnimation = openingSeal.animate(keyframes,
      {duration:reducedMotion ? 1200 : 6400, delay:850, fill:'both', easing:'ease-out'});
    sealAnimation.finished.then(() => {
      openingSeal.classList.add('stamped');
      sealAnimation.cancel();
      sealAnimation = undefined;
    }).catch(() => {});
  }
  const musicMessages = {
    missing: '日落音乐 · 待加入天气预报版音源',
    loading: '正在准备渔舟唱晚',
    ready: '日落时播放渔舟唱晚',
    playing: '夕阳 · 渔舟唱晚',
    paused: '日落音乐已暂停',
    error: '日落音乐未能加载 · 保留原背景乐',
  };
  let sunsetStatus = 'idle', backgroundStatus, soundEnabled = false, audioBusy = false, musicPaused = musicConfig.playback.paused;
  let musicMode = musicConfig.playback.defaultMode, selectedTrack;
  const musicModes = musicConfig.playback.modes;
  function updateMusicControls() {
    const playing = soundEnabled && !musicPaused;
    $('music-play').innerHTML = icon(playing ? 'pause' : 'play');
    $('music-play').setAttribute('aria-label', playing ? '暂停背景音乐' : '播放背景音乐');
    $('music-play').title = playing ? '暂停背景音乐' : '播放背景音乐';
    const mode = musicModes.find(value => value.id === musicMode);
    $('music-mode-icon').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${mode.path}"/></svg>`;
    $('music-mode-label').textContent = mode.label;
    $('music-mode').setAttribute('aria-label', `播放方式：${mode.label}，点击切换`);
    $('music-mode').title = `${mode.label} · 点击切换播放方式`;
  }
  function updateMusicStatus() {
    let message = '随景音乐';
    if (backgroundStatus?.title) {
      const {state,title,label} = backgroundStatus;
      message = state === 'playing' ? `${label} · ${title}`
        : state === 'loading' ? `正在准备${title}`
        : state === 'paused' ? `${title}已暂停`
        : state === 'buffering' ? `${title}正在缓冲`
        : '曲目暂未能播放 · 保留自然声';
    } else if (sunsetStatus === 'playing') message = musicMessages.playing;
    $('sunset-music-status').textContent = message;
    $('sunset-music-status').title = message;
  }
  updateMusicStatus();
  const audioOptions = {
    onSunsetMusicStatus: ({state}) => { sunsetStatus = state; updateMusicStatus(); },
    onBackgroundMusicStatus: status => {
      backgroundStatus = status;
      if (status.id && (status.state === 'playing' || status.state === 'loading')) selectedTrack = status.id;
      updateMusicStatus();
      updateMusicControls();
    },
  };
  let audio, audioDisposed = false;
  cleanup.add(() => { audioDisposed = true; audio?.dispose(); });
  atmosphere.onThunder = () => audio?.thunder();
  const soundOffset = new THREE.Vector3(), soundRight = new THREE.Vector3();
  function playSpatialEvent(event, play) {
    soundOffset.copy(event.position).sub(camera.position);
    const distance = soundOffset.length();
    soundRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const pan = distance > .001 ? soundOffset.dot(soundRight) / distance : 0;
    play?.({ ...event, distance, pan });
  }
  marine.onEvent = event => playSpatialEvent(event, audio?.wildlife);
  restPavilions.forEach(pavilion => {
    pavilion.onChime = event => playSpatialEvent(event, audio?.chime);
  });
  const state = createSimulation();
  const cloudTexturePool=createCloudTexturePool({defaultMaps:cloudMaps,
    loadAdditional:()=>loadCloudTextures({signal:startupController.signal,atlas:cloudMaps?'additional':'all'}),
    apply:maps=>atmosphere.setCloudMaps(maps)});
  cleanup.add(()=>cloudTexturePool.dispose());
  let lastCloudMode;
  function syncCloudTextures(mode){
    if(mode===lastCloudMode)return;
    lastCloudMode=mode;cloudTexturePool.select(mode!=='default');
  }
  const solarEclipse = createSolarEclipse();
  const lunarEclipse = createLunarEclipse();
  let lunarEclipseState;
  let artificialLightMode=DEFAULTS.sky.artificialLights;
  const sceneRates = DEFAULTS.simulation.sceneRates;
  const cloudCover = createCloudCoverState();
  const sunDirection = new THREE.Vector3();
  const composer = new EffectComposer(renderer);
  cleanup.add(() => composer.dispose());
  function addPass(pass) { cleanup.add(() => pass.dispose()); composer.addPass(pass); }
  addPass(new RenderPass(scene, camera));
  const bloom = createBloomPass(innerWidth, innerHeight);
  // Three 0.180's bloom dispose does not release its high-pass material.
  cleanup.add(() => bloom.materialHighPassFilter.dispose());
  addPass(bloom); addPass(createScreenOutputPass());
  let cameraMotion = null, lastUI = 0, frames = 0, fpsTime = 0;
  let interacting = false, interactionUntil = 0;
  let quality = RENDERING_CONFIG.defaultQuality;
  initializeSettingInputs(document, state, quality);
  const seasons = WEATHER_CONFIG.seasonNames;
  const weathers = WEATHER_CONFIG.names;
  function formatTime(hour) { return `${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor(hour % 1 * 60)).padStart(2,'0')}`; }
  function refreshUI() {
    const env = getLunarEclipseEnvironment(getEnvironment(state),lunarEclipseState), time = formatTime(state.hour);
    syncCloudTextures(env.cloudMode);
    $('time-value').textContent = time; $('status-time').textContent = time;
    if (document.activeElement !== $('time-range')) $('time-range').value = state.hour;
    $('season-label').textContent = seasons[state.seasonIndex]; $('weather-label').textContent = weathers[state.weather];
    $('temperature').textContent = `${Math.round(env.temperature)}°`;
    $('wind-speed').textContent = `风速 ${env.windSpeed.toFixed(1)} m/s`;
    const moonlit = (1 - env.daylight) * env.moonLight * (1 - env.cloudiness * .9) * (1 - env.fog * .8);
    const sunlit = getSunVisibility({ ...env, sunHeight: env.sun[1] / Math.hypot(...env.sun) });
    document.documentElement.style.setProperty('--scene-shade-opacity', String(1 - Math.max(moonlit * .65, sunlit * .38)));
    const moonPreset = MOON_PHASES[Math.round(env.moonPhase * 8) % 8];
    const phaseKey = `${moonPreset.phase}:${state.autoMoon}`;
    if ($('moon-phase').dataset.phase !== phaseKey) {
      $('moon-phase').innerHTML = moonPhaseIcons[MOON_PHASES.indexOf(moonPreset)] + (state.autoMoon ? `<span class="moon-auto-indicator" aria-hidden="true">${icon('cycle')}</span>` : '');
      $('moon-phase').dataset.phase = phaseKey;
    }
    const nextMoonName = state.autoMoon ? MOON_PHASES[0].name : MOON_PHASES[MOON_PHASES.indexOf(moonPreset) + 1]?.name ?? '自动轮换';
    const moonMode = state.autoMoon ? '月相自动轮换' : '月相';
    $('moon-phase').classList.toggle('selected', state.autoMoon);
    $('moon-phase').setAttribute('aria-pressed', state.autoMoon);
    $('moon-phase').setAttribute('aria-label', `${moonMode}：${moonPreset.name}，点击切换${nextMoonName}`);
    $('moon-phase').title = `${moonMode} · ${moonPreset.name} · 下一项：${nextMoonName}`;
    document.querySelectorAll('[data-season]').forEach(el => { const selected = Number(el.dataset.season) === state.seasonIndex; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed',selected); });
    document.querySelectorAll('[data-weather]').forEach(el => {
      const view=getWeatherButtonState(state,el.dataset.weather);
      el.classList.toggle('selected',view.selected);el.setAttribute('aria-pressed',view.selected);
      el.setAttribute('aria-label',view.label);el.title=view.label;
      const slot=el.querySelector('[data-icon]');
      if(slot&&slot.dataset.icon!==view.icon){slot.innerHTML=icon(view.icon);slot.dataset.icon=view.icon;}
    });
    $('auto-season').checked = state.autoSeason; $('auto-weather').checked = state.autoWeather;
    $('time-toggle').classList.toggle('selected', state.running);
    $('time-toggle').setAttribute('aria-pressed', state.running);
    $('time-toggle').setAttribute('aria-label',state.running ? '暂停昼夜、四季与月相轮换' : '继续昼夜、四季与月相轮换');
    $('time-toggle').title = state.running ? '暂停轮换' : '继续轮换';
    $('scene-rate-label').textContent = `${state.speed}×`;
    $('scene-rate').setAttribute('aria-label', `场景速度：${state.speed}倍，点击切换`);
    $('scene-rate').title = state.speed === 16 ? '场景16倍速 · 随机单曲循环 · 点击切换' : `场景${state.speed}倍速 · 点击切换`;
  }
  function panel(open) { $('control-panel').classList.toggle('closed', !open); $('panel-toggle').setAttribute('aria-expanded',open); $('control-panel').inert = !open; }
  $('panel-toggle').onclick = () => panel($('control-panel').classList.contains('closed'));
  $('panel-close').onclick = () => panel(false);
  cleanup.add(createDraggablePanel($('control-panel'),$('panel-drag-handle')).dispose);
  cleanup.add(createUpdateHistory($('panel-drag-handle')).dispose);
  if (innerWidth <= CAMERA_CONFIG.mobileBreakpoint) panel(false);
  document.querySelectorAll('[data-season]').forEach(el => el.onclick = () => { state.seasonIndex = Number(el.dataset.season); state.seasonProgress = 0; refreshUI(); });
  document.querySelectorAll('[data-weather]').forEach(el => el.onclick = () => { selectWeather(state,el.dataset.weather); refreshUI(); });
  $('auto-season').onchange = (event) => { state.autoSeason = event.target.checked; };
  $('auto-weather').onchange = (event) => { state.autoWeather = event.target.checked; state.weatherProgress = 0; state.weatherDuration = undefined; state.weatherSeasonIndex = -1; };
  const constellationModes=DEFAULTS.sky.constellationModes,constellationNames=DEFAULTS.sky.constellationNames;
  let constellationIndex=constellationModes.indexOf(DEFAULTS.sky.constellation),moonCameraView=false,auroraCameraView=false;
  function updateCameraFov(){
    camera.fov=auroraCameraView?CAMERA_CONFIG.fov.aurora:getConstellationViewFov(moonCameraView?CAMERA_CONFIG.fov.moon:(innerWidth<CAMERA_CONFIG.mobileBreakpoint?CAMERA_CONFIG.fov.mobile:CAMERA_CONFIG.fov.desktop),camera.aspect,constellationModes[constellationIndex]!=='off');
    camera.updateProjectionMatrix();
  }
  function updateConstellationControls(){
    const mode=constellationModes[constellationIndex],button=$('constellation-toggle');atmosphere.setConstellationMode(mode);
    updateCameraFov();poetry.reframe();
    button.dataset.mode=mode;button.classList.toggle('selected',mode!=='off');
    button.setAttribute('aria-pressed',String(mode!=='off'));button.setAttribute('aria-label',`星座：${constellationNames[constellationIndex]}`);
    button.title=`星座：${constellationNames[constellationIndex]} · 点击切换为${constellationNames[(constellationIndex+1)%constellationModes.length]}`;
  }
  updateConstellationControls();
  $('constellation-toggle').onclick=()=>{
    constellationIndex=(constellationIndex+1)%constellationModes.length;
    updateConstellationControls();
    toast(`星座：${constellationNames[constellationIndex]}`);
  };
  const skyModes=DEFAULTS.sky.modes,skyModeNames=DEFAULTS.sky.modeNames;
  const lightModes=DEFAULTS.sky.lightModes,lightModeNames=DEFAULTS.sky.lightModeNames;
  function updateLightControls(){
    const index=lightModes.indexOf(artificialLightMode),button=$('lights-toggle');
    button.dataset.mode=artificialLightMode;button.classList.toggle('selected',index!==2);
    button.setAttribute('aria-pressed',String(index!==2));button.setAttribute('aria-label',`灯光：${lightModeNames[index]}`);
    button.title=`灯光：${lightModeNames[index]} · 点击切换为${lightModeNames[(index+1)%lightModes.length]}`;
  }
  updateLightControls();
  $('lights-toggle').onclick=()=>{
    artificialLightMode=lightModes[(lightModes.indexOf(artificialLightMode)+1)%lightModes.length];
    updateLightControls();
    toast(`灯光：${artificialLightMode==='auto'?'随时间自动变化':lightModeNames[lightModes.indexOf(artificialLightMode)]}`);
  };
  for(const [id,name,setMode,defaultMode]of [
    ['meteor-toggle','流星',atmosphere.setMeteorMode,DEFAULTS.sky.meteor],
    ['comet-toggle','彗星',atmosphere.setCometMode,DEFAULTS.sky.comet],
    ['aurora-toggle','极光',atmosphere.setAuroraMode,DEFAULTS.sky.aurora],
    ['eclipse-toggle','日食',solarEclipse.setMode,DEFAULTS.sky.solarEclipse],
    ['lunar-eclipse-toggle','月食',lunarEclipse.setMode,DEFAULTS.sky.lunarEclipse],
  ]){
    let index=skyModes.indexOf(defaultMode);const button=$(id);
    const period=id==='aurora-toggle'?'冬季晴夜':id==='eclipse-toggle'?'白天':id==='lunar-eclipse-toggle'?'满月夜':'晴夜';
    function updateSkyControls(){
      const mode=skyModes[index];
      button.dataset.mode=mode;button.classList.toggle('selected',mode!=='off');
      button.setAttribute('aria-pressed',String(mode!=='off'));
      button.setAttribute('aria-label',`${name}：${skyModeNames[index]}`);
      button.title=`${name}：${skyModeNames[index]} · 点击切换为${skyModeNames[(index+1)%skyModes.length]}`;
    }
    setMode(defaultMode);updateSkyControls();
    button.onclick=()=>{
      index=(index+1)%skyModes.length;const mode=skyModes[index];
      if(id==='aurora-toggle'&&mode==='instant'){
        prepareAuroraPreview(state,cloudCover);
        // A wide upward view includes the low arcs and the crown near zenith.
        // Establish its bearing before the event chooses a fixed sky direction.
        auroraCameraView=true;moonCameraView=false;cameraMotion=null;
        controls.autoRotate=false;updateTourControls();
        controls.minDistance=CAMERA_CONFIG.orbit.minDistance;controls.maxDistance=CAMERA_CONFIG.orbit.maxDistance;
        controls.minPolarAngle=CAMERA_CONFIG.orbit.minPolarAngle;controls.maxPolarAngle=Math.PI*CAMERA_CONFIG.auroraMaxPolarAnglePi;
        camera.position.set(...CAMERA_CONFIG.views.aurora.position);controls.target.set(...CAMERA_CONFIG.views.aurora.target);controls.update();
        updateCameraFov();poetry.reframe();
        document.querySelectorAll('[data-view]').forEach(view=>{view.classList.remove('selected');view.setAttribute('aria-pressed','false');});
        panel(false);refreshUI();
      }
      if(id==='eclipse-toggle'&&mode==='instant'){
        const environment=getEnvironment(state);
        if(environment.daylight<.9||environment.sun[1]<.58||state.hour<9||state.hour>15.5){state.hour=12;state.moonNightEnding=null;refreshUI();}
      }
      if(id==='lunar-eclipse-toggle'&&mode==='instant'){
        state.hour=22;state.lunarDay=LUNAR_CYCLE_DAYS/2;state.moonNightEnding=null;
        state.holdSunClock=false;state.holdMoonClock=false;
        document.querySelector('[data-view="moon"]').click();
        panel(false);refreshUI();
      }
      setMode(mode);
      updateSkyControls();
      toast(`${name}：${skyModeNames[index]}${mode==='instant'?['日食','月食'].includes(name)?` · 立即播放一次完整${name}`:` · ${period}立即出现并连续播放`:mode==='default'?` · ${period}随机出现`:''}`);
    };
  }
  $('moon-phase').onclick = () => {
    lunarEclipse.reset();state.holdMoonClock=false;state.holdSunClock=false;
    const current = Math.round(getEnvironment(state).moonPhase * MOON_PHASES.length) % MOON_PHASES.length;
    if (!state.autoMoon && current === MOON_PHASES.length - 1) {
      state.autoMoon = true;
    } else {
      const next = MOON_PHASES[state.autoMoon ? 0 : current + 1];
      state.lunarDay = next.phase * LUNAR_CYCLE_DAYS;
      state.autoMoon = false;
    }
    refreshUI();
  };
  $('time-range').oninput = (event) => { state.moonNightEnding = null; state.hour = Number(event.target.value); state.holdSunClock=false;state.holdMoonClock=false;solarEclipse.reset();lunarEclipse.reset();poetry.restart(); refreshUI(); };
  $('time-toggle').onclick = () => { state.running = !state.running; refreshUI(); };
  $('scene-rate').onclick = () => {
    state.speed = sceneRates[(sceneRates.indexOf(state.speed) + 1) % sceneRates.length];
    audio?.setAnimationRate(getAnimationRate(state));
    refreshUI();
  };
  async function toggleSound() {
    if (audioBusy) return;
    audioBusy = true;
    try {
      if (!soundEnabled) {
        if (!audio) {
          const { createAudio } = await import('./audio-player.js');
          if (audioDisposed) return;
          audio = createAudio(audioOptions);
          audio.setMusicVolume(Number($('music-volume').value));
          audio.setAmbientVolume(Number($('ambient-volume').value));
          audio.setMusicPlayback({mode:musicMode,paused:musicPaused,
            trackId:musicMode === 'scenic' ? undefined : selectedTrack ?? musicConfig.playback.defaultTrackId});
          audio.setAnimationRate(getAnimationRate(state));
        }
        await audio.start();
        if (audioDisposed) return;
        soundEnabled = true; toast('自然声场已开启 · 海浪、海鸟、风铃与海洋生灵');
      }
      else { audio?.setEnabled(false); soundEnabled = false; toast('声音已关闭'); }
      $('sound-toggle').innerHTML = icon(soundEnabled ? 'volume' : 'mute');
      $('sound-toggle').classList.toggle('enabled',soundEnabled);
      $('sound-toggle').setAttribute('aria-label',soundEnabled ? '关闭自然声音' : '开启自然声音');
      $('sound-toggle').setAttribute('title',soundEnabled ? '关闭自然声音' : '开启自然声音');
    } catch (error) { toast(`声音未能开启：${error.message}`); }
    finally { audioBusy = false; updateMusicControls(); }
  }
  $('sound-toggle').onclick = toggleSound;
  $('music-mode').onclick = () => {
    musicMode = musicModes[(musicModes.findIndex(mode => mode.id === musicMode) + 1) % musicModes.length].id;
    audio?.setMusicPlayback({mode:musicMode, trackId:musicMode === 'scenic' ? undefined : selectedTrack ?? musicConfig.playback.defaultTrackId});
    updateMusicControls();
  };
  $('music-play').onclick = async () => {
    if (audioBusy) return;
    musicPaused = soundEnabled ? !musicPaused : false;
    audio?.setMusicPlayback({paused:musicPaused});
    if (!soundEnabled) await toggleSound();
    updateMusicControls();
  };
  $('music-next').onclick = async () => {
    if (audioBusy) return;
    if (!soundEnabled) await toggleSound();
    if (!soundEnabled) return;
    audio?.nextMusicTrack();
    updateMusicControls();
  };
  cleanup.add(startSoundOnFirstGesture({
    target: document, enabled: DEFAULTS.interface.soundEnabled,
    ignoredElements: [$('sound-toggle'), $('music-play'), $('music-next')],
    isActive: () => soundEnabled || audioBusy || audioDisposed,
    start: toggleSound,
  }));
  updateMusicControls();
  $('ambient-volume').value = musicConfig.volume.ambient;
  $('music-volume').value = musicConfig.volume.music;
  for (const [id, setter, valueID] of [['ambient-volume','setAmbientVolume','ambient-value'],['music-volume','setMusicVolume','music-value']]) {
    const input = $(id);
    function setVolume() { const value = Number(input.value); audio?.[setter](value); $(valueID).textContent = `${Math.round(value * 100)}%`; input.style.background = `linear-gradient(to right,#c8d99d ${value*100}%,rgba(221,235,209,.17) ${value*100}%)`; }
    input.oninput = setVolume; setVolume();
  }
  function updateTourControls() {
    $('tour-label').textContent = controls.autoRotate ? '暂停环岛漫游' : '开启环岛漫游';
    $('tour-icon').innerHTML = icon(controls.autoRotate ? 'pause' : 'orbit');
    $('tour-toggle').title = $('tour-label').textContent;
    $('tour-toggle').setAttribute('aria-pressed', controls.autoRotate);
    $('tour-toggle').classList.toggle('enabled', controls.autoRotate);
  }
  $('tour-toggle').onclick = () => {
    cameraMotion = null; controls.autoRotate = !controls.autoRotate;
    updateTourControls();
    if (controls.autoRotate) toast('环岛漫游已开启 · 拖动可自由调整视角');
  };
  const views = {
    ...CAMERA_CONFIG.views,
    island: { ...CAMERA_CONFIG.views.island, position: CAMERA_CONFIG.views.island.position.map(value => value * mobileScale) },
    cave: { position: [CAVE_LAYOUT.entrance.x + CAVE_LAYOUT.direction.x * CAMERA_CONFIG.caveView.distance,
      CAVE_LAYOUT.entrance.y + CAMERA_CONFIG.caveView.height, CAVE_LAYOUT.entrance.z + CAVE_LAYOUT.direction.z * CAMERA_CONFIG.caveView.distance],
      target: [CAVE_LAYOUT.entrance.x, CAVE_LAYOUT.entrance.y + CAMERA_CONFIG.caveView.targetHeight, CAVE_LAYOUT.entrance.z] },
    lighthouse: {
      position: lighthouse.group.position.toArray().map((value,index) => value + CAMERA_CONFIG.lighthouseView.positionOffset[index]),
      target: [lighthouse.group.position.x, lighthouse.group.position.y + CAMERA_CONFIG.lighthouseView.targetHeight, lighthouse.group.position.z],
    },
  };
  REST_PAVILION_SITES.forEach((site, index) => {
    const { x, z } = site.position, direction = site.entranceDirection;
    const floorTop = restPavilions[index].group.userData.floorTop;
    views[`${site.id}-pavilion`] = {
      position: [x + direction.x * CAMERA_CONFIG.pavilionView.forward + direction.z * CAMERA_CONFIG.pavilionView.side, floorTop + CAMERA_CONFIG.pavilionView.height,
        z + direction.z * CAMERA_CONFIG.pavilionView.forward - direction.x * CAMERA_CONFIG.pavilionView.side],
      target: [x, floorTop + CAMERA_CONFIG.pavilionView.targetHeight, z],
    };
  });
  document.querySelectorAll('[data-view]').forEach(el => el.onclick = (event) => {
    const view = views[el.dataset.view];
    auroraCameraView=false;
    const moonView = el.dataset.view === 'moon';
    controls.minDistance = el.dataset.view.endsWith('-pavilion') ? CAMERA_CONFIG.viewMinDistances.pavilion
      : CAMERA_CONFIG.viewMinDistances[el.dataset.view] ?? CAMERA_CONFIG.orbit.minDistance;
    controls.minPolarAngle = moonView ? MOON_VIEW_POLAR_LIMITS.min : CAMERA_CONFIG.orbit.minPolarAngle;
    controls.maxPolarAngle = moonView ? MOON_VIEW_POLAR_LIMITS.max : Math.PI * CAMERA_CONFIG.orbit.maxPolarAnglePi;
    controls.maxDistance = moonView ? CAMERA_CONFIG.moonMaxDistance : CAMERA_CONFIG.orbit.maxDistance;
    moonCameraView=moonView;updateCameraFov();
    if (moonView) {
      poetry.reframe();
      controls.autoRotate = false;
      updateTourControls();
      if (getEnvironment(state).daylight > 0.1) { state.moonNightEnding = null; state.hour = 22; poetry.restart(); refreshUI(); }
    }
    if(event?.immediate){camera.position.set(...view.position);controls.target.set(...view.target);controls.update();}
    else cameraMotion = { start: state.elapsed, from: camera.position.clone(), targetFrom: controls.target.clone(), to: new THREE.Vector3(...view.position), targetTo: new THREE.Vector3(...view.target) };
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('selected',button === el); button.setAttribute('aria-pressed',button === el); });
  });
  document.querySelector(`[data-view="${CAMERA_CONFIG.initialView}"]`)?.onclick({immediate:true});
  updateTourControls();
  cleanup.listen(controls, 'start', () => { cameraMotion = null; interacting = true; });
  cleanup.listen(controls, 'end', () => { interacting = false; interactionUntil = performance.now() + 1200; });
  const detailFocus=createDetailFocus({element:renderer.domElement,camera,
    roots:[island.group,lighthouse.group,pathLamps.group,...restPavilions.map(pavilion=>pavilion.group),ocean.mesh],water:ocean.mesh,
    onFocus({position,target}){
      controls.minDistance=CAMERA_CONFIG.focusMinDistance;controls.maxDistance=CAMERA_CONFIG.orbit.maxDistance;
      controls.minPolarAngle=CAMERA_CONFIG.orbit.minPolarAngle;controls.maxPolarAngle=Math.PI*CAMERA_CONFIG.orbit.maxPolarAnglePi;controls.autoRotate=false;
      moonCameraView=false;auroraCameraView=false;updateCameraFov();poetry.reframe();
      updateTourControls();
      cameraMotion={start:state.elapsed,from:camera.position.clone(),targetFrom:controls.target.clone(),to:position,targetTo:target};
      document.querySelectorAll('[data-view]').forEach(button=>{button.classList.remove('selected');button.setAttribute('aria-pressed','false');});
      toast('已拉近 · 拖动环绕，滚轮缩放 · 点“全岛”返回');
    }});
  cleanup.add(() => detailFocus.dispose());
  $('capture').onclick = () => {
    composer.render();
    renderer.domElement.toBlob(blob => {
      if (!blob) return toast('保存失败，请稍后重试');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `浮屿-${seasons[state.seasonIndex]}-${weathers[state.weather]}-${formatTime(state.hour).replace(':','')}.png`;
      link.style.display = 'none'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); toast('风景照片已生成 · 请查看浏览器下载');
    });
  };
  $('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('当前浏览器暂不支持全屏'); }
    catch { toast('当前浏览器暂不支持全屏'); }
  };
  function resize() {
    camera.aspect = innerWidth / innerHeight; updateCameraFov();
    renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
    poetry.reframe();
  }
  cleanup.listen(window, 'resize', resize);
  const qualityOptions = RENDERING_CONFIG.qualityOptions;
  function applyQuality(next){
    quality = next.value;
    $('quality').textContent = next.label;
    $('quality').setAttribute('aria-label', `渲染画质：${next.label}，点击切换`);
    island.setQuality?.(quality);
    ocean.setQuality(quality);
    marine.setQuality(quality);
    sailboats.setQuality(quality);
    sunsetBirds.setQuality(quality);
    lagoonLife.setQuality(quality);
    atmosphere.setQuality(quality);
    lighthouse.setQuality(quality);
    pathLamps.setQuality(quality);
    restPavilions.forEach(pavilion => pavilion.setQuality(quality));
    renderer.setPixelRatio(Math.min(devicePixelRatio, next.pixelRatio));
    composer.setPixelRatio(renderer.getPixelRatio());
    bloom.enabled = next.bloom; renderer.shadowMap.enabled = next.shadows; resize();
  }
  applyQuality(initialQuality);
  $('quality').onclick = () => {
    const next = qualityOptions[(qualityOptions.findIndex(option => option.value === quality) + 1) % qualityOptions.length];
    applyQuality(next);toast(`已切换为${next.label}画质`);
  };
  cleanup.listen(document, 'keydown',event => {
    if (event.target.matches('input, select, button')) return;
    if (event.key === 'Escape') panel(false);
    if (event.code === 'Space') { event.preventDefault(); state.running = !state.running; refreshUI(); }
  });
  cleanup.listen(renderer.domElement, 'webglcontextlost',event => { event.preventDefault(); toast('图形连接中断，正在恢复'); });
  cleanup.listen(renderer.domElement, 'webglcontextrestored',() => location.reload());
  let previousTime = performance.now();
  function frame(now, render = true) {
    const delta = Math.max(0, Math.min((now-previousTime)/1000,.1)); previousTime = now;
    advanceSimulation(state,delta);
    if (cameraMotion) {
      const progress = Math.min((state.elapsed-cameraMotion.start)/CAMERA_CONFIG.transitionDuration,1), eased = progress*progress*(3-2*progress);
      camera.position.lerpVectors(cameraMotion.from,cameraMotion.to,eased); controls.target.lerpVectors(cameraMotion.targetFrom,cameraMotion.targetTo,eased);
      if (progress === 1) cameraMotion = null;
    }
    controls.update(delta * getAnimationRate(state));
    cameraSafety.update();
    const baseEnv = getEnvironment(state);
    syncCloudTextures(baseEnv.cloudMode);
    baseEnv.skyCloudCover = advanceCloudCover(cloudCover, state.elapsed, baseEnv).coverage;
    lunarEclipseState=lunarEclipse.update(delta,baseEnv);
    const env=getLunarEclipseEnvironment(baseEnv,lunarEclipseState);
    sunDirection.set(...env.sun).normalize(); env.sunDirection = sunDirection;
    env.eclipse=solarEclipse.update(delta,env);
    state.holdSunClock=env.eclipse.active||env.lunarEclipse.active;
    state.holdMoonClock=env.lunarEclipse.active;
    env.solarDaylight=env.daylight;
    env.daylight*=env.eclipse.lightFactor;
    const sunBackdrop = getSunBackdropState(camera, innerWidth, innerHeight, sunDirection);
    env.sunBackdropDirection = sunBackdrop.direction;
    env.sunAngularRadius = sunBackdrop.angularRadius*(1+env.eclipse.coverage*.8);
    env.sunFramed = sunBackdrop.framed;
    const moonlit = (1 - env.daylight) * env.moonLight * (1 - env.cloudiness * .9) * (1 - env.fog * .8);
    renderer.toneMappingExposure = RENDERING_CONFIG.renderer.toneMappingExposure + moonlit * .30;
    env.moonDirection = getMoonBackdropDirection(camera, innerWidth, env);
    env.seaHorizon = getLunarEclipseSeaHorizon(env,getSeaHorizonState(env));
    Object.assign(env,getArtificialLightControls(artificialLightMode));
    island.update(state.elapsed,env); ocean.update(state.elapsed,env); audio?.update(state.elapsed,env);
    cameraSafety.update();
    marine.update(state.elapsed,env,camera);
    sailboats.update(state.elapsed,env,camera);
    sunsetBirds.update(state.elapsed,env,camera);
    lagoonLife.update(state.elapsed,env,camera);
    lighthouse.update(state.elapsed,env);
    pathLamps.update(state.elapsed,env,camera);
    restPavilions.forEach(pavilion => pavilion.update(state.elapsed,env));
    atmosphere.update(state.elapsed,env,camera);
    env.moonDiscOpacity=atmosphere.moonDiscOpacity;
    env.moonInFrame=atmosphere.moonInFrame;
    poetry.update(state.elapsed,env,Boolean(cameraMotion));
    document.body.classList.toggle('poetry-sky', poetry.active);
    if (!render) return;
    composer.render();
    if (now-lastUI > 220) { refreshUI(); lastUI = now; }
    frames++; fpsTime += delta;
    if (fpsTime > 1.5) { $('fps-label').textContent = `${Math.round(frames/fpsTime)} 帧 / 秒`; fpsTime = 0; frames = 0; }
  }
  // Set current sunlight, fog, uniforms and visible objects before precompiling.
  // Shadow/depth programs and composer passes can still require first-render work.
  frame(performance.now(), false);
  await stage('scene-preparation', loadingConfig.startupStages['scene-preparation'], () => loadOptionalResource(() => renderer.compileAsync(scene, camera), {
    signal: startupController.signal, ...DEFAULTS.loading.scenePreparation,
    onFallback: error => console.warn('预热未完成，继续准备首帧', error),
  }));
  previousTime = performance.now();
  let firstFrame = true;
  const frameLoop = createFrameLoop(now => {
    if (!firstFrame) return frame(now);
    try {
      frame(now);
      firstFrame = false;
      startup.durationMs = performance.now() - startup.startedAt;
      loadingScreen.complete();
      showOpeningSeal();
      // Fine ground detail is optional: let the first landscape paint before
      // downloading/decoding these maps. The island owns late-load disposal.
      nextStartupPaint().then(() => loadCoastalSurfaces({signal:startupController.signal})).then(maps => {
        lighthouse.setStepMap(maps.stone); island.setCoastalMaps(maps);
      })
        .catch(error => console.warn('地表细节贴图未能加载',error));
      nextStartupPaint().then(() => loadLeafTextures({signal:startupController.signal})).then(maps => island.setLeafMaps(maps))
        .catch(error => console.warn('叶片细节贴图未能加载',error));
      nextStartupPaint().then(() => loadCaveSurface({signal:startupController.signal})).then(maps => island.setCaveMaps(maps))
        .catch(error => console.warn('洞穴细节贴图未能加载',error));
      nextStartupPaint().then(() => sailboats.loadSurfaces({signal:startupController.signal}))
        .catch(error => console.warn('帆船细节贴图未能加载',error));
      nextStartupPaint().then(() => loadDockSurfaces({signal:startupController.signal})).then(maps=>{
        restPavilions.forEach(pavilion=>pavilion.setSurfaceMaps({wood:maps})); island.setDockMaps(maps);
      })
        .catch(error => console.warn('码头细节贴图未能加载',error));
      nextStartupPaint().then(() => loadLighthouseSurfaces({signal:startupController.signal})).then(maps=>lighthouse.setSurfaceMaps(maps))
        .catch(error => console.warn('灯塔细节贴图未能加载',error));
      nextStartupPaint().then(() => loadPavilionRoofSurfaces({signal:startupController.signal})).then(maps=>{
        pavilionRoofSurface.setMaps(maps);restPavilions.forEach(pavilion=>pavilion.setSurfaceMaps({roof:maps}));
      }).catch(error => console.warn('亭子瓦面贴图未能加载',error));
    } catch (error) {
      cleanup.fail(error);
    }
  }, { maxFps: now => interacting || now < interactionUntil || Boolean(cameraMotion) || controls.autoRotate ? RENDERING_CONFIG.frameRates.active : RENDERING_CONFIG.frameRates.idle });
  cleanup.add(() => frameLoop.dispose());
  const visibilityChanged = () => document.hidden ? frameLoop.pause() : frameLoop.start();
  cleanup.listen(document, 'visibilitychange', visibilityChanged);
  refreshUI();
  frameLoop.start();
  cleanup.listen(window, 'pagehide',event => {
    frameLoop.pause();
    if (!event.persisted) cleanup.dispose();
  });
  cleanup.listen(window, 'pageshow',event => {
    if (event.persisted) frameLoop.start();
    if (event.persisted && soundEnabled && audio) audio.start().catch(() => {
      soundEnabled = false; $('sound-toggle').innerHTML = icon('mute'); $('sound-toggle').classList.remove('enabled');
      $('sound-toggle').setAttribute('aria-label','开启自然声音'); $('sound-toggle').setAttribute('title','开启自然声音');
      updateMusicControls();
    });
  });
  // Small read-only status surface for diagnosis and browser verification.
  window.isola = { state, scene, camera, renderer, controls, startup, getEnvironment: () => getEnvironment(state) };
  cleanup.add(() => { delete window.isola; });
  });
}

function loadingFailed(error) {
  console.error(error);
  loadingScreen.fail(loadingConfig.errors.startup);
}

boot().catch(loadingFailed);
