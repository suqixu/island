import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, WEATHER_CONFIG, CAMERA_CONFIG, RENDERING_CONFIG, initializeSettingInputs } from '../src/runtime-config.js';
import { createSimulation, getEnvironment } from '../src/simulation.js';
import { LUNAR_CYCLE_DAYS } from '../src/moon.js';

function settingsDocument() {
  const elements = new Map(['time-range', 'auto-season', 'auto-weather', 'quality'].map(id => [id, { setAttribute(name, value) { this[name] = value; } }]));
  return { getElementById: id => elements.get(id), elements };
}

test('集中默认配置保留半速夏日晴天、满月、诗关闭与漫游关闭', () => {
  const state = createSimulation();
  assert.equal(state.hour, 14.5);
  assert.equal(state.speed, .5);
  assert.equal(state.seasonIndex, 1);
  assert.equal(state.weather, 'sunny');
  assert.equal(state.lunarDay, LUNAR_CYCLE_DAYS * DEFAULTS.simulation.moonPhase);
  assert.ok(Math.abs(getEnvironment(state).moonPhase - .5) < 1e-12);
  assert.equal(DEFAULTS.interface.poetryEnabled, false);
  assert.equal(DEFAULTS.interface.soundEnabled, false);
  assert.equal(DEFAULTS.interface.autoRotate, false);
  assert.equal(DEFAULTS.sky.meteor, 'default');
  assert.equal(RENDERING_CONFIG.defaultQuality, 'high');
  assert.equal(CAMERA_CONFIG.initialView, 'island');
});

test('新场景状态彼此独立，覆盖参数不会污染下一次创建或只读配置', () => {
  const first = createSimulation({seasonIndex: 3, hour: 22});
  const second = createSimulation();
  first.weather = 'snow';
  first.seasonProgress = 120;
  assert.equal(first.weatherSeasonIndex, 3);
  assert.equal(second.weather, 'sunny');
  assert.equal(second.seasonProgress, 0);
  assert.equal(DEFAULTS.simulation.hour, 14.5);
  assert.throws(() => { WEATHER_CONFIG.presets.sunny.wind = 999; }, TypeError);
  assert.throws(() => { CAMERA_CONFIG.views.island.position[0] = 999; }, TypeError);
});

test('界面初值从模拟状态与画质配置写入，覆盖页面静态残留值', () => {
  const document = settingsDocument();
  const state = createSimulation({ hour: 22, autoSeason: false, autoWeather: false });
  initializeSettingInputs(document, state, 'low');
  assert.equal(document.elements.get('time-range').value, 22);
  assert.equal(document.elements.get('auto-season').checked, false);
  assert.equal(document.elements.get('auto-weather').checked, false);
  assert.equal(document.elements.get('quality').textContent, '流畅');
  assert.match(document.elements.get('quality')['aria-label'], /流畅/);
});

test('修改配置默认模式与画质后，独立运行的天象首帧和星点数量实际生效', async () => {
  const { spawnSync } = await import('node:child_process');
  // A separate module cache lets this test edit the imported JSON before the
  // production configuration entry freezes it, without changing any disk file.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as THREE from 'three';
    import defaults from './src/config/defaults.json' with {type:'json'};
    import rendering from './src/config/rendering.json' with {type:'json'};
    defaults.sky.solarEclipse='instant';
    defaults.sky.lunarEclipse='instant';
    defaults.sky.meteor='instant';
    defaults.sky.comet='instant';
    defaults.sky.aurora='instant';
    rendering.defaultQuality='low';
    const {createSolarEclipse}=await import('./src/solar-eclipse.js');
    const {createLunarEclipse}=await import('./src/lunar-eclipse.js');
    const {createNightSky}=await import('./src/night-sky.js');
    const {createMeteorShower}=await import('./src/meteor-shower.js');
    const view=new THREE.PerspectiveCamera(46,1.6,.5,7000);
    view.position.set(160,68,200);view.lookAt(0,15,0);view.updateMatrixWorld();
    const day={daylight:1,sun:[.3,.8,.5],cloudiness:.12,fog:0};
    const night={season:'winter',weather:'sunny',hour:22,daylight:0,moonIllumination:1,moonAltitude:.45,cloudiness:.12,fog:0};
    assert.equal(createSolarEclipse({random:()=>1}).update(0,day).active,true);
    assert.equal(createLunarEclipse({random:()=>1}).update(0,night).active,true);
    const shower=createMeteorShower({timeRandom:()=>1,groupRandom:()=>.5});
    shower.update(.1,1,view);
    assert.ok(shower.group.getObjectByName('meteor').geometry.drawRange.count>0);
    const sky=createNightSky({eventRandom:()=>1});
    sky.update(0,night,view);
    assert.equal(sky.group.getObjectByName('catalogue-stars').geometry.drawRange.count,1700);
    assert.equal(sky.group.getObjectByName('comet').visible,true);
    assert.equal(sky.group.getObjectByName('aurora').visible,true);
    shower.dispose();sky.dispose();
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('触屏手机首屏采用均衡，桌面和非触屏窄窗保留精细，可继续手动切换', async () => {
  const { getInitialQuality } = await import('../src/runtime-config.js');
  assert.equal(typeof getInitialQuality, 'function');
  assert.equal(getInitialQuality({width:390,coarsePointer:true}).value, 'medium');
  assert.equal(getInitialQuality({width:1280,coarsePointer:false}).value, 'high');
  assert.equal(getInitialQuality({width:390,coarsePointer:false}).value, 'high');
});
