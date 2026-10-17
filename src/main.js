import * as THREE from 'three';
import { getAnimationRate } from './animation-time.js';
import { getMusicSceneEffects, isExclusiveMusicTrack } from './music-scene-effects.js';
import { createDetailFocus } from './detail-focus.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createBloomPass } from './bloom.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createIslandAsync } from './island.js';
import { nextStartupPaint } from './startup-tasks.js';
import { createOcean } from './ocean.js';
import { createMarine } from './marine.js';
import { createSailboats } from './sailboats.js';
import { createLagoonLife } from './lagoon-life.js';
import { createLighthouse } from './lighthouse.js';
import { LIGHTHOUSE_SITE } from './lighthouse-layout.js';
import { createLandmarkMusicTrigger } from './landmark-music-trigger.js';
import { createPavilionMusicTrigger } from './pavilion-music-trigger.js';
import { createPathLamps } from './path-lamps.js';
import { createRestPavilion } from './rest-pavilion.js';
import { REST_PAVILION_SITES } from './rest-pavilion-layout.js';
import { createPavilionSurfaceSampler } from './rest-pavilion-surface.js';
import { getIslandPathLayout, PATH_LIFT } from './path-layout.js';
import { createAtmosphere } from './atmosphere.js';
import { createCloudCoverState, advanceCloudCover } from './cloud-cover.js';
import { getSeaHorizonState } from './sea-horizon.js';
import { CAVE_LAYOUT } from './cave-layout.js';
import { getLagoonShelter } from './lagoon.js';
import { loadLunarSurface } from './lunar-surface.js';
import { getMoonBackdropDirection, MOON_VIEW_POLAR_LIMITS } from './moon-framing.js';
import { getSunBackdropState, getSunVisibility } from './sun-framing.js';
import { createAudio } from './audio.js';
import chunjiangMusicUrl from './assets/audio/chunjiang-synth.mp3?url';
import caiyunMusicUrl from './assets/audio/caiyun-synth.mp3?url';
import pingshaMusicUrl from './assets/audio/pingsha-synth.mp3?url';
import mengjiangMusicUrl from './assets/audio/mengjiang-synth.mp3?url';
import shangeMusicUrl from './assets/audio/shange-synth.mp3?url';
import islandSongMusicUrl from './assets/audio/island-shange.mp3?url';
import zuguoMusicUrl from './assets/audio/zuguo-synth.mp3?url';
import liangzhuMusicUrl from './assets/audio/liangzhu-synth.mp3?url';
import nuerqingMusicUrl from './assets/audio/nuerqing-synth.mp3?url';
import wangningmeiMusicUrl from './assets/audio/wangningmei-synth.mp3?url';
import molihuaMusicUrl from './assets/audio/molihua-synth.mp3?url';
import yueerMusicUrl from './assets/audio/yueer-synth.mp3?url';
import southPavilionMusicUrl from './assets/audio/gongde-baoshan-zhou.mp3?url';
import eastPavilionMusicUrl from './assets/audio/xinjing.mp3?url';
import caveChantMusicUrl from './assets/audio/dabei-zhou.mp3?url';
import caveDreamMusicUrl from './assets/audio/mengzhong-eji.mp3?url';
import caveBoruMusicUrl from './assets/audio/bo-rulai.mp3?url';
import lighthouseLubinghuaUrl from './assets/audio/lubinghua.mp3?url';
import lighthouseHualianUrl from './assets/audio/hualian.mp3?url';
import lighthouseTuogaoUrl from './assets/audio/tuogao-song.mp3?url';
import caveMusicUrl from './assets/audio/jiegenghua.mp3?url';
import dockMusicUrl from './assets/audio/songbie.mp3?url';
import lighthouseMusicUrl from './assets/audio/yueer-ming-fenger-jing.mp3?url';
import openingSealUrl from './assets/images/zzy-seal.png?url';
import { createSimulation, advanceSimulation, getEnvironment, finishMoonNight } from './simulation.js';
import { MOON_PHASES, LUNAR_CYCLE_DAYS } from './moon.js';
import { createPoetry, loadPoetryFont } from './poetry.js';
import { createFrameLoop } from './frame-loop.js';
import { loadingScreen } from './loading-screen-entry.js';

const $ = (id) => document.getElementById(id);
// The synthesized recording is bundled locally, so playback also works on Pages
// without a third-party player or expiring streaming link.
const sunsetMusicUrl = new URL('./assets/audio/yuzhou-changwan-weather.mp3', import.meta.url).href;
const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  cloud: '<path d="M6 18a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 1 1 18 18H6Z"/>',
  rain: '<path d="M6 14a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 0 1 18 14M8 17l-1 3m6-3-1 3m6-3-1 3"/>',
  fog: '<path d="M7 11a4 4 0 1 1 1.4-7.7 5 5 0 0 1 9.4 2.7 3 3 0 0 1 1.2 5M3 15h18M5 19h14"/>',
  storm: '<path d="M6 14a4 4 0 1 1 .9-7.9 6 6 0 0 1 11.7 1.5A3.3 3.3 0 0 1 18 14M13 12l-4 6h4l-2 5 6-8h-4l2-3"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 10l4-1-1-4M19.5 14l-4 1 1 4M7.5 19l1-4-4-1M16.5 5l-1 4 4 1"/>',
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

const islandStageLabels = {
  terrain: '正在铺设海床与山峰', 'cave-opening': '正在开凿山洞入口',
  cave: '正在布置山洞', paths: '正在铺设环岛山路', forest: '正在栽种森林',
  palms: '正在种植椰树', understory: '正在铺设草丛与野花',
  rocks: '正在摆放海岸岩石', dock: '正在搭建码头', birds: '正在召集鸟群',
};

async function boot() {
  const startup = { startedAt: performance.now(), stages: [], slices: [] };
  async function stage(name, label, build) {
    loadingScreen.setStage(label);
    await nextStartupPaint();
    const start = performance.now();
    try { return await build(); }
    finally { startup.stages.push({ stage: name, durationMs: performance.now() - start }); }
  }
  await nextStartupPaint();
  // The save button renders immediately before toBlob; normal frames need no
  // persistent canvas buffer in addition to the composer's render targets.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('scene').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(innerWidth < 760 ? 54 : 46, innerWidth / innerHeight, .5, 65000);
  const mobileScale = innerWidth < 760 ? 1.48 : 1;
  camera.position.set(160 * mobileScale, 68 * mobileScale, 200 * mobileScale);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 15, 0); controls.enableDamping = true; controls.dampingFactor = .05;
  controls.minDistance = 38; controls.maxDistance = 480; controls.maxPolarAngle = Math.PI * .49;
  controls.minPolarAngle = .08; controls.enablePan = true; controls.autoRotateSpeed = .32;
  controls.update();
  // Fetch assets while CPU construction runs. Capture rejection immediately so
  // a fast network failure cannot become an unhandled rejection before use.
  const assetStart = performance.now();
  const resources = Promise.all([loadLunarSurface(), loadPoetryFont()])
    .then(values => ({ values }), error => ({ error }))
    .finally(() => startup.stages.push({ stage: 'assets', durationMs: performance.now() - assetStart }));
  const island = await stage('island', '正在搭建海岛', () => createIslandAsync(scene, {
    onProgress: name => loadingScreen.setStage(islandStageLabels[name]),
    onSlice: slice => startup.slices.push(slice),
  }));
  const ocean = await stage('ocean', '正在准备海浪', () =>
    createOcean(scene, { heightAt: island.heightAt, shelterAt: getLagoonShelter }));
  const marine = await stage('marine', '正在呼叫鲸鱼和海豚', () => createMarine(scene, { heightAt: island.heightAt }));
  const sailboats = await stage('sailboats', '正在驾驶渔船', () => createSailboats(scene, { heightAt: island.heightAt }));
  const lagoonLife = await stage('lagoon-life', '正在放生龙虾和鱼群', () =>
    createLagoonLife(scene, { heightAt: island.heightAtRendered }));
  const lighthouse = await stage('lighthouse', '正在搭建灯塔', () => createLighthouse(scene, { ...LIGHTHOUSE_SITE, heightAt: island.heightAtRendered,
    approach: { ...LIGHTHOUSE_SITE.approach,
      y: island.heightAtRendered(LIGHTHOUSE_SITE.approach.x, LIGHTHOUSE_SITE.approach.z) + PATH_LIFT } }));
  const pathLamps = await stage('path-lamps', '正在点亮山路', () => createPathLamps(scene, { heightAt: island.heightAtRendered,
    layout: getIslandPathLayout({ caveEndpoint: CAVE_LAYOUT.approach }) }));
  const pavilionSurface = createPavilionSurfaceSampler(island, REST_PAVILION_SITES);
  const restPavilions = [];
  for (const site of REST_PAVILION_SITES) {
    const pavilion = await stage(`pavilion-${site.id}`, '正在建设观景凉亭', () => createRestPavilion(scene, { ...site, heightAt: pavilionSurface,
      stoneSurface: island.group.getObjectByName('山径天然石阶'),
      approach: { ...site.approach, y: pavilionSurface(site.approach.x, site.approach.z) } }));
    pavilion.group.name = `${site.id === 'south' ? '南峰' : '东峰'}观景木亭`;
    restPavilions.push(pavilion);
  }
  const loaded = await stage('resource-wait', '正在准备月色与书法', () => resources);
  if (loaded.error) throw loaded.error;
  const [moonMap, poetryFont] = loaded.values;
  const atmosphere = await stage('atmosphere', '正在摆动太阳和月亮', () => createAtmosphere(scene, { moonMap, terrainHeightAt: island.heightAtRendered }));
  const poetry = await stage('poetry', '正在准备流动诗句', () => createPoetry(scene, camera, {
    font: poetryFont,
    getFocusDistance: () => camera.position.distanceTo(controls.target),
    onCueChange: text => { $('poem-caption').textContent = text; },
    onComplete: () => finishMoonNight(state),
  }));
  $('poem-toggle').onclick = () => {
    poetry.setEnabled(!poetry.enabled);
    $('poem-toggle').classList.toggle('enabled', poetry.enabled);
    $('poem-toggle').setAttribute('aria-pressed', String(poetry.enabled));
    $('poem-toggle').setAttribute('aria-label', poetry.enabled ? '关闭诗意字幕' : '开启诗意字幕');
    $('poem-caption').hidden = !poetry.enabled;
  };
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
    zenButton.textContent = zenMode ? '…' : '禅';
    zenButton.setAttribute('aria-pressed', String(zenMode));
    zenButton.setAttribute('aria-label', zenMode ? '退出禅模式，显示全部界面' : '进入禅模式');
    zenButton.title = zenMode ? '显示全部界面' : '禅模式 · 隐藏全部界面';
  };
  const openingSeal = $('opening-seal'), sealImage = $('opening-seal-image');
  sealImage.src = openingSealUrl;
  let sealAnimation, sealDisposed = false;
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
  let sunsetStatus = 'idle', backgroundStatus, soundEnabled = false, audioBusy = false, musicPaused = false;
  let musicMode = 'scenic', musicRate = 1, selectedTrack;
  const musicModes = [
    {id:'scenic',label:'随景播放',path:'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'},
    {id:'single',label:'单曲循环',path:'m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3M11 10l1-1v6'},
    {id:'sequence',label:'顺序播放',path:'m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3'},
    {id:'random',label:'随机播放',path:'m17 3 4 4-4 4M3 7h3c5 0 7 10 12 10h3M3 17h3c5 0 7-10 12-10h3m-4 6 4 4-4 4'},
  ];
  const musicRates = [.5,.75,1,1.25,1.5,2];
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
    $('music-rate-label').textContent = `${musicRate}×`;
    $('music-rate').setAttribute('aria-label', `音乐速度：${musicRate}倍，点击切换`);
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
  const audio = createAudio({ sunsetMusicUrl, lighthouseMusicUrl, dockMusicUrl, caveMusicUrl, caveChantMusicUrl, caveDreamMusicUrl, caveBoruMusicUrl, lighthouseLubinghuaUrl, lighthouseHualianUrl, lighthouseTuogaoUrl, southPavilionMusicUrl, eastPavilionMusicUrl, islandSongMusicUrl,
    backgroundTracks: {
      chunjiang: {url:chunjiangMusicUrl,title:'春江花月夜'},
      caiyun: {url:caiyunMusicUrl,title:'彩云追月'},
      pingsha: {url:pingshaMusicUrl,title:'平沙落雁'},
      mengjiang: {url:mengjiangMusicUrl,title:'孟姜女哭长城'},
      shange: {url:shangeMusicUrl,title:'山歌好比春江水'},
      zuguo: {url:zuguoMusicUrl,title:'我的祖国'},
      liangzhu: {url:liangzhuMusicUrl,title:'梁祝'},
      nuerqing: {url:nuerqingMusicUrl,title:'女儿情'},
      wangningmei: {url:wangningmeiMusicUrl,title:'枉凝眉'},
      molihua: {url:molihuaMusicUrl,title:'茉莉花'},
      yueer: {url:yueerMusicUrl,title:'月儿明风儿静'},
    },
    onSunsetMusicStatus: ({state}) => { sunsetStatus = state; updateMusicStatus(); },
    onBackgroundMusicStatus: status => {
      backgroundStatus = status;
      if (status.id && !isExclusiveMusicTrack(status.id) && (status.state === 'playing' || status.state === 'loading')) selectedTrack = status.id;
      updateMusicStatus();
      updateMusicControls();
    },
  });
  atmosphere.onThunder = () => audio.thunder();
  const soundOffset = new THREE.Vector3(), soundRight = new THREE.Vector3();
  function playSpatialEvent(event, play) {
    soundOffset.copy(event.position).sub(camera.position);
    const distance = soundOffset.length();
    soundRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const pan = distance > .001 ? soundOffset.dot(soundRight) / distance : 0;
    play({ ...event, distance, pan });
  }
  marine.onEvent = event => playSpatialEvent(event, audio.wildlife);
  restPavilions.forEach(pavilion => {
    pavilion.onChime = event => playSpatialEvent(event, audio.chime);
  });
  const state = createSimulation();
  const sceneRates = [0.5, 1, 2, 3, 4, 8, 16];
  const cloudCover = createCloudCoverState();
  const sunDirection = new THREE.Vector3();
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bloom = createBloomPass(innerWidth, innerHeight);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  let cameraMotion = null, lastUI = 0, frames = 0, fpsTime = 0;
  let quality = 'high';
  const seasons = ['春日', '夏日', '金秋', '冬日'];
  const weathers = { sunny: '晴朗', cloudy: '多云', rain: '细雨', fog: '薄雾', storm: '雷暴', snow: '飘雪' };
  function formatTime(hour) { return `${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor(hour % 1 * 60)).padStart(2,'0')}`; }
  function refreshUI() {
    const env = getEnvironment(state), time = formatTime(state.hour);
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
    document.querySelectorAll('[data-weather]').forEach(el => { const selected = el.dataset.weather === state.weather; el.classList.toggle('selected',selected); el.setAttribute('aria-pressed',selected); });
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
  if (innerWidth <= 760) panel(false);
  document.querySelectorAll('[data-season]').forEach(el => el.onclick = () => { state.seasonIndex = Number(el.dataset.season); state.seasonProgress = 0; refreshUI(); });
  document.querySelectorAll('[data-weather]').forEach(el => el.onclick = () => { state.weather = el.dataset.weather; state.weatherProgress = 0; refreshUI(); });
  $('auto-season').onchange = (event) => { state.autoSeason = event.target.checked; };
  $('auto-weather').onchange = (event) => { state.autoWeather = event.target.checked; state.weatherProgress = 0; };
  $('moon-phase').onclick = () => {
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
  $('time-range').oninput = (event) => { state.moonNightEnding = null; state.hour = Number(event.target.value); poetry.restart(); refreshUI(); };
  $('time-toggle').onclick = () => { state.running = !state.running; refreshUI(); };
  $('scene-rate').onclick = () => {
    state.speed = sceneRates[(sceneRates.indexOf(state.speed) + 1) % sceneRates.length];
    audio.setAnimationRate(getAnimationRate(state));
    refreshUI();
  };
  async function toggleSound() {
    if (audioBusy) return;
    audioBusy = true;
    try {
      if (!soundEnabled) { await audio.start(); soundEnabled = true; toast('自然声场已开启 · 海浪、海鸟、风铃与海洋生灵'); }
      else { audio.setEnabled(false); soundEnabled = false; toast('声音已关闭'); }
      $('sound-toggle').innerHTML = icon(soundEnabled ? 'volume' : 'mute');
      $('sound-toggle').classList.toggle('enabled',soundEnabled);
      $('sound-toggle').setAttribute('aria-label',soundEnabled ? '关闭自然声音' : '开启自然声音');
      $('sound-toggle').setAttribute('title',soundEnabled ? '关闭自然声音' : '开启自然声音');
    } catch (error) { toast(`声音未能开启：${error.message}`); }
    finally { audioBusy = false; updateMusicControls(); }
  }
  $('sound-toggle').onclick = toggleSound;
  $('music-mode').onclick = () => {
    viewMusicTriggers.forEach(trigger => trigger.cancel());
    musicMode = musicModes[(musicModes.findIndex(mode => mode.id === musicMode) + 1) % musicModes.length].id;
    audio.setMusicPlayback({mode:musicMode, trackId:musicMode === 'scenic' ? undefined : selectedTrack ?? 'chunjiang'});
    updateMusicControls();
  };
  $('music-rate').onclick = () => {
    musicRate = musicRates[(musicRates.indexOf(musicRate) + 1) % musicRates.length];
    audio.setMusicPlayback({rate:musicRate});updateMusicControls();
  };
  $('music-play').onclick = async () => {
    if (audioBusy) return;
    musicPaused = soundEnabled ? !musicPaused : false;
    audio.setMusicPlayback({paused:musicPaused});
    if (!soundEnabled) await toggleSound();
    updateMusicControls();
  };
  updateMusicControls();
  for (const [id, setter, valueID] of [['ambient-volume','setAmbientVolume','ambient-value'],['music-volume','setMusicVolume','music-value']]) {
    const input = $(id);
    function setVolume() { const value = Number(input.value); audio[setter](value); $(valueID).textContent = `${Math.round(value * 100)}%`; input.style.background = `linear-gradient(to right,#c8d99d ${value*100}%,rgba(221,235,209,.17) ${value*100}%)`; }
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
    island: { position: [160 * mobileScale,68 * mobileScale,200 * mobileScale], target: [0,15,0] },
    beach: { position: [-48,22,133], target: [-9,5,48] },
    dock: { position: [40,12,128], target: [5,5,60] },
    reef: { position: [115,17,51], target: [89,-1.15,26] },
    lagoon: { position: [88,24,120], target: [54,-.6,82] },
    cave: { position: [CAVE_LAYOUT.entrance.x + CAVE_LAYOUT.direction.x * 20,
      CAVE_LAYOUT.entrance.y + 6, CAVE_LAYOUT.entrance.z + CAVE_LAYOUT.direction.z * 20],
      target: [CAVE_LAYOUT.entrance.x, CAVE_LAYOUT.entrance.y + 2.3, CAVE_LAYOUT.entrance.z] },
    lighthouse: {
      position: [lighthouse.group.position.x + 24, lighthouse.group.position.y + 14, lighthouse.group.position.z + 27],
      target: [lighthouse.group.position.x, lighthouse.group.position.y + 5.5, lighthouse.group.position.z],
    },
    moon: { position: [150,24,200], target: [0,65,0] },
  };
  REST_PAVILION_SITES.forEach((site, index) => {
    const { x, z } = site.position, direction = site.entranceDirection;
    const floorTop = restPavilions[index].group.userData.floorTop;
    views[`${site.id}-pavilion`] = {
      position: [x + direction.x * 13 + direction.z * 7.8, floorTop + 6.4,
        z + direction.z * 13 - direction.x * 7.8],
      target: [x, floorTop + 1.3, z],
    };
  });
  let viewMusicRevision = 0;
  const viewMusicTriggers = restPavilions.map((pavilion,index) => createPavilionMusicTrigger(
    pavilion.group.position.clone().add(new THREE.Vector3(0, 1.3, 0)), `${REST_PAVILION_SITES[index].id}-pavilion`));
  viewMusicTriggers.push(createLandmarkMusicTrigger(new THREE.Vector3(
    CAVE_LAYOUT.entrance.x, CAVE_LAYOUT.entrance.y + 2.3, CAVE_LAYOUT.entrance.z), 'cave'));
  viewMusicTriggers.push(createLandmarkMusicTrigger(new THREE.Vector3(...views.dock.target), 'dock'));
  viewMusicTriggers.push(createLandmarkMusicTrigger(new THREE.Vector3(...views.lighthouse.target), 'lighthouse'));
  viewMusicTriggers.push(createLandmarkMusicTrigger(new THREE.Vector3(...views.island.target), 'island'));
  document.querySelectorAll('[data-view]').forEach(el => el.onclick = async () => {
    const startViewMusic = viewMusicTriggers.map(trigger => trigger.selectView(el.dataset.view)).some(Boolean);
    const view = views[el.dataset.view];
    const moonView = el.dataset.view === 'moon';
    controls.minDistance = el.dataset.view.endsWith('-pavilion') ? 7
      : el.dataset.view === 'lighthouse' ? 10 : el.dataset.view === 'cave' ? 12 : ['reef', 'lagoon'].includes(el.dataset.view) ? 16 : 38;
    controls.minPolarAngle = moonView ? MOON_VIEW_POLAR_LIMITS.min : .08;
    controls.maxPolarAngle = moonView ? MOON_VIEW_POLAR_LIMITS.max : Math.PI * .49;
    controls.maxDistance = moonView ? 310 : 480;
    camera.fov = moonView ? 66 : (innerWidth < 760 ? 54 : 46);
    camera.updateProjectionMatrix();
    if (moonView) {
      poetry.reframe();
      controls.autoRotate = false;
      updateTourControls();
      if (getEnvironment(state).daylight > 0.1) { state.moonNightEnding = null; state.hour = 22; poetry.restart(); refreshUI(); }
    }
    cameraMotion = { start: state.elapsed, from: camera.position.clone(), targetFrom: controls.target.clone(), to: new THREE.Vector3(...view.position), targetTo: new THREE.Vector3(...view.target) };
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('selected',button === el); button.setAttribute('aria-pressed',button === el); });
    if (startViewMusic) {
      viewMusicRevision++;
      musicPaused = false; audio.setMusicPlayback({paused:false});
      if (!soundEnabled && !audioBusy) await toggleSound();
      updateMusicControls();
    }
  });
  controls.addEventListener('start', () => { cameraMotion = null; });
  const detailFocus=createDetailFocus({element:renderer.domElement,camera,
    roots:[island.group,lighthouse.group,pathLamps.group,...restPavilions.map(pavilion=>pavilion.group),ocean.mesh],water:ocean.mesh,
    onFocus({position,target}){
      controls.minDistance=3;controls.maxDistance=480;
      controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI*.49;controls.autoRotate=false;
      camera.fov=innerWidth<760?54:46;camera.updateProjectionMatrix();poetry.reframe();
      updateTourControls();
      cameraMotion={start:state.elapsed,from:camera.position.clone(),targetFrom:controls.target.clone(),to:position,targetTo:target};
      document.querySelectorAll('[data-view]').forEach(button=>{button.classList.remove('selected');button.setAttribute('aria-pressed','false');});
      toast('已拉近 · 拖动环绕，滚轮缩放 · 点“全岛”返回');
    }});
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
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
    poetry.reframe();
  }
  window.addEventListener('resize', resize);
  const qualityOptions = [{ value: 'high', label: '精细' }, { value: 'medium', label: '均衡' }, { value: 'low', label: '流畅' }];
  $('quality').onclick = () => {
    const next = qualityOptions[(qualityOptions.findIndex(option => option.value === quality) + 1) % qualityOptions.length];
    quality = next.value;
    $('quality').textContent = next.label;
    $('quality').setAttribute('aria-label', `渲染画质：${next.label}，点击切换`);
    island.setQuality?.(quality);
    marine.setQuality(quality);
    sailboats.setQuality(quality);
    lagoonLife.setQuality(quality);
    lighthouse.setQuality(quality);
    pathLamps.setQuality(quality);
    restPavilions.forEach(pavilion => pavilion.setQuality(quality));
    renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.7 : quality === 'medium' ? 1.2 : .8));
    composer.setPixelRatio(renderer.getPixelRatio());
    bloom.enabled = quality !== 'low'; renderer.shadowMap.enabled = quality !== 'low'; resize();
    toast(`已切换为${next.label}画质`);
  };
  document.addEventListener('keydown',event => {
    if (event.target.matches('input, select, button')) return;
    if (event.key === 'Escape') panel(false);
    if (event.code === 'Space') { event.preventDefault(); state.running = !state.running; refreshUI(); }
  });
  renderer.domElement.addEventListener('webglcontextlost',event => { event.preventDefault(); toast('图形连接中断，正在恢复'); });
  renderer.domElement.addEventListener('webglcontextrestored',() => location.reload());
  let previousTime = performance.now();
  function frame(now, render = true) {
    const delta = Math.max(0, Math.min((now-previousTime)/1000,.1)); previousTime = now;
    advanceSimulation(state,delta);
    if (cameraMotion) {
      const progress = Math.min((state.elapsed-cameraMotion.start)/1.8,1), eased = progress*progress*(3-2*progress);
      camera.position.lerpVectors(cameraMotion.from,cameraMotion.to,eased); controls.target.lerpVectors(cameraMotion.targetFrom,cameraMotion.targetTo,eased);
      if (progress === 1) cameraMotion = null;
    }
    controls.update(delta * getAnimationRate(state));
    const env = getEnvironment(state);
    env.viewMusicRevision = viewMusicRevision;
    env.southPavilionMusic = viewMusicTriggers[0].isActive(camera.position, controls.target, Boolean(cameraMotion));
    env.eastPavilionMusic = viewMusicTriggers[1].isActive(camera.position, controls.target, Boolean(cameraMotion));
    Object.assign(env, viewMusicTriggers[2].getMusicFlags(camera.position, controls.target, Boolean(cameraMotion)),
      viewMusicTriggers[3].getMusicFlags(camera.position, controls.target, Boolean(cameraMotion)),
      viewMusicTriggers[4].getMusicFlags(camera.position, controls.target, Boolean(cameraMotion)),
      viewMusicTriggers[5].getMusicFlags(camera.position, controls.target, Boolean(cameraMotion)));
    env.skyCloudCover = advanceCloudCover(cloudCover, state.elapsed, env).coverage;
    sunDirection.set(...env.sun).normalize(); env.sunDirection = sunDirection;
    const sunBackdrop = getSunBackdropState(camera, innerWidth, innerHeight, sunDirection);
    env.sunBackdropDirection = sunBackdrop.direction;
    env.sunAngularRadius = sunBackdrop.angularRadius;
    env.sunFramed = sunBackdrop.framed;
    const moonlit = (1 - env.daylight) * env.moonLight * (1 - env.cloudiness * .9) * (1 - env.fog * .8);
    renderer.toneMappingExposure = 1.04 + moonlit * .30;
    env.moonDirection = getMoonBackdropDirection(camera, innerWidth, env);
    env.seaHorizon = getSeaHorizonState(env);
    env.artificialLightsOff = getMusicSceneEffects(backgroundStatus, { enabled: soundEnabled, paused: musicPaused }).artificialLightsOff;
    island.update(state.elapsed,env); ocean.update(state.elapsed,env); audio.update(state.elapsed,env);
    marine.update(state.elapsed,env,camera);
    sailboats.update(state.elapsed,env,camera);
    lagoonLife.update(state.elapsed,env,camera);
    lighthouse.update(state.elapsed,env);
    pathLamps.update(state.elapsed,env,camera);
    restPavilions.forEach(pavilion => pavilion.update(state.elapsed,env));
    atmosphere.update(state.elapsed,env,camera);
    env.moonDiscOpacity=atmosphere.moonDiscOpacity;
    env.moonInFrame=atmosphere.moonInFrame;
    env.poetrySuppressed = getMusicSceneEffects(backgroundStatus, { enabled: soundEnabled, paused: musicPaused }).poetrySuppressed;
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
  await stage('scene-preparation', '正在准备第一眼风景', () => renderer.compileAsync(scene, camera));
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
    } catch (error) {
      frameLoop.pause();
      loadingFailed(error);
    }
  });
  const visibilityChanged = () => document.hidden ? frameLoop.pause() : frameLoop.start();
  document.addEventListener('visibilitychange', visibilityChanged);
  refreshUI();
  frameLoop.start();
  window.addEventListener('pagehide',event => {
    frameLoop.pause();
    if (!event.persisted) {
      sealDisposed = true;
      sealAnimation?.cancel();
      frameLoop.dispose();
      loadingScreen.dispose();
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('resize', resize);
      audio.dispose(); marine.dispose(); sailboats.dispose(); lagoonLife.dispose(); lighthouse.dispose(); pathLamps.dispose();
      restPavilions.forEach(pavilion => pavilion.dispose());
      poetry.dispose(); atmosphere.dispose(); ocean.dispose(); island.dispose();
      detailFocus.dispose();controls.dispose();
      composer.passes.forEach(pass => pass.dispose());
      // Three 0.180's bloom dispose does not release its high-pass material.
      bloom.materialHighPassFilter.dispose();
      composer.dispose(); renderer.dispose();
    }
  });
  window.addEventListener('pageshow',event => {
    if (event.persisted) frameLoop.start();
    if (event.persisted && soundEnabled) audio.start().catch(() => {
      soundEnabled = false; $('sound-toggle').innerHTML = icon('mute'); $('sound-toggle').classList.remove('enabled');
      $('sound-toggle').setAttribute('aria-label','开启自然声音'); $('sound-toggle').setAttribute('title','开启自然声音');
      updateMusicControls();
    });
  });
  // Small read-only status surface for diagnosis and browser verification.
  window.isola = { state, scene, camera, renderer, controls, startup, getEnvironment: () => getEnvironment(state) };
}

function loadingFailed(error) {
  console.error(error);
  loadingScreen.fail('海岛未能加载，请使用支持 WebGL 2 的浏览器，并开启硬件加速。' + `（${error.message}）`);
}

boot().catch(loadingFailed);
