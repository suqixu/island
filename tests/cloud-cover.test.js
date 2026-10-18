import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, advanceSimulation, getEnvironment } from '../src/simulation.js';
import * as THREE from 'three';
import { createAtmosphere } from '../src/atmosphere.js';

const clouds = await import('../src/cloud-cover.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => {
  assert.ok(clouds?.createCloudCoverState && clouds?.advanceCloudCover,
    '视觉云量应提供可复现的真实时间状态接口');
  return clouds;
};
const sunny = { weather: 'sunny', cloudiness: .12, rain: 0, snow: 0, fog: 0, storm: 0 };

test('相同种子重现整段云量，不同种子改变起伏且不改实际天气', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  const states = [42, 42, 77].map(createCloudCoverState), values = [[], [], []];
  const env = { ...sunny }, original = structuredClone(env);
  for (let frame = 0; frame <= 2400; frame++) for (let index = 0; index < states.length; index++) {
    values[index].push(advanceCloudCover(states[index], frame / 4, env).coverage);
  }
  assert.deepEqual(values[0], values[1]);
  assert.ok(values[0].some((value, index) => Math.abs(value - values[2][index]) > .25));
  assert.deepEqual(env, original);
});

test('晴天有至少十秒近乎无云及大片云，长短阶段平滑变化', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  for (const seed of [0, 42, 77, 2718]) {
    const state = createCloudCoverState(seed);
    let clear = 0, busy = 0, longestClear = 0, longestBusy = 0, previous = null;
    for (let frame = 0; frame <= 4800; frame++) {
      const value = advanceCloudCover(state, frame / 4, sunny).coverage;
      assert.ok(value >= 0 && value <= 1);
      if (previous !== null) assert.ok(Math.abs(value - previous) < .055);
      clear = value < .025 ? clear + .25 : 0;
      busy = value > .88 ? busy + .25 : 0;
      longestClear = Math.max(longestClear, clear); longestBusy = Math.max(longestBusy, busy);
      previous = value;
    }
    assert.ok(longestClear >= 10, `种子${seed}晴空持续${longestClear}秒`);
    assert.ok(longestBusy >= 10, `种子${seed}大片云持续${longestBusy}秒`);
  }
});

test('阴雨雷雪维持浓云最低量，雾天可淡，晴天不会被固定cloudiness强制留云', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  for (const [weather, minimum] of [['cloudy', .7], ['rain', .8], ['storm', .94], ['snow', .74]]) {
    const state = createCloudCoverState(42);
    for (let second = 0; second <= 240; second++) {
      assert.ok(advanceCloudCover(state, second, { weather }).coverage >= minimum);
    }
  }
  const state = createCloudCoverState(42); let minimum = 1;
  for (let second = 0; second <= 300; second++) minimum = Math.min(minimum,
    advanceCloudCover(state, second, { weather: 'fog', cloudiness: .52, fog: .9 }).coverage);
  assert.ok(minimum < .4);
});

test('天气切换只缓慢改变云量，重复时间不会让浓云突然出现', () => {
  const { createCloudCoverState, advanceCloudCover } = api(), state = createCloudCoverState(2718);
  let previous = advanceCloudCover(state, 0, sunny).coverage;
  for (let frame = 1; frame <= 7200; frame++) {
    const time = frame / 60, env = time < 20 || time >= 70 ? sunny : { weather: 'storm', storm: 1 };
    const current = advanceCloudCover(state, time, env).coverage;
    assert.ok(Math.abs(current - previous) < .025, `t=${time}云量不能跳变`);
    assert.equal(advanceCloudCover(state, time, env).coverage, current);
    previous = current;
  }
});

test('暂停昼夜、改小时和倍速不影响相同真实时间的随机云量', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  const paused = createSimulation({ running: false, hour: 14.5, windSeed: 27, autoWeather: false });
  const fast = createSimulation({ running: true, hour: 14.5, speed: 4, windSeed: 27, autoWeather: false });
  const a = createCloudCoverState(9329), b = createCloudCoverState(9329);
  for (let frame = 0; frame < 14400; frame++) {
    advanceSimulation(paused, 1 / 60); advanceSimulation(fast, 1 / 60);
    if (frame === 300) paused.hour = 23;
    assert.equal(advanceCloudCover(a, paused.elapsed, getEnvironment(paused)).coverage,
      advanceCloudCover(b, fast.elapsed, getEnvironment(fast)).coverage);
  }
});

test('异常种子、环境与时间保持有限，倒退或重复时间不倒退云量', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  for (const seed of [NaN, Infinity, -.17, 0, 2147483646]) {
    const state = createCloudCoverState(seed);
    let previous = advanceCloudCover(state, 10, sunny).coverage;
    for (const time of [NaN, Infinity, -100, 0, 10]) {
      const value = advanceCloudCover(state, time, { cloudiness: NaN, storm: Infinity, snow: -5 }).coverage;
      assert.equal(value, previous); assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      previous = value;
    }
    const value = advanceCloudCover(state, 11, null).coverage;
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

test('未知天气名称采用晴天云量，不得从对象继承属性污染后续状态', () => {
  const { createCloudCoverState, advanceCloudCover } = api();
  for (const weather of ['unknown', 'toString', 'constructor', '__proto__']) {
    const state = createCloudCoverState(42), clear = createCloudCoverState(42);
    assert.equal(advanceCloudCover(state, 0, { weather }).coverage,
      advanceCloudCover(clear, 0, sunny).coverage);
    for (let second = 1; second <= 200; second++) assert.equal(
      advanceCloudCover(state, second, sunny).coverage, advanceCloudCover(clear, second, sunny).coverage);
  }
});

test('真实大气在零云量完全消隐，即使火烧云时也不会凭空造云，满量明显增多', () => {
  const originalDocument = globalThis.document;
  const originalWidth = globalThis.innerWidth, originalHeight = globalThis.innerHeight;
  const context = new Proxy({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.innerWidth = 634; globalThis.innerHeight = 768;
  const scene = new THREE.Scene(); let atmosphere;
  try {
    atmosphere = createAtmosphere(scene, { moonMap: new THREE.Texture(), cloudMaps: Array.from({length:8},()=>new THREE.Texture()) });
    const camera = new THREE.PerspectiveCamera(54, 634 / 768, .5, 65000);
    camera.position.set(160 * 1.48, 68 * 1.48, 200 * 1.48); camera.lookAt(0, 15, 0);
    const sprites = atmosphere.group.children.filter(item => item.isSprite && item.userData.drift);
    assert.equal(sprites.length, 78);
    const state = createSimulation({ running: false, hour: 14.5, windSeed: 27 });
    const environment = cover => {
      const env = getEnvironment(state); env.sunDirection = new THREE.Vector3(...env.sun).normalize();
      return { ...env, skyCloudCover: cover };
    };
    atmosphere.update(0, environment(0), camera);
    assert.ok(sprites.every(sprite => !sprite.visible && sprite.material.opacity === 0));
    atmosphere.update(1 / 60, environment(1), camera);
    const full = sprites.filter(sprite => sprite.visible).length;
    assert.ok(full >= 60);
    atmosphere.update(2 / 60, environment(.25), camera);
    assert.ok(sprites.filter(sprite => sprite.visible).length < full * .55);
    state.hour = 17.8;
    atmosphere.update(3 / 60, environment(0), camera);
    assert.ok(sprites.every(sprite => !sprite.visible && sprite.material.opacity === 0));
    assert.ok(sprites.some(sprite => sprite.material.userData.sunsetUniforms.uCloudSunsetStrength.value > .5));
  } finally {
    atmosphere?.dispose(); globalThis.document = originalDocument;
    globalThis.innerWidth = originalWidth; globalThis.innerHeight = originalHeight;
  }
  assert.equal(scene.children.length, 0);
});

test('真实大气切回默认后，退出仍释放全部已接收云图且每张只释放一次',()=>{
  const originalDocument=globalThis.document,originalWidth=globalThis.innerWidth,originalHeight=globalThis.innerHeight;
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})},
    {get:(target,key)=>target[key]??(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  globalThis.innerWidth=634;globalThis.innerHeight=768;
  const maps=Array.from({length:64},()=>new THREE.Texture()),counts=new Map();
  maps.forEach(map=>map.addEventListener('dispose',()=>counts.set(map,(counts.get(map)??0)+1)));
  let atmosphere;
  try{
    atmosphere=createAtmosphere(new THREE.Scene(),{cloudMaps:maps.slice(0,8)});
    const sprites=atmosphere.group.children.filter(item=>item.isSprite&&item.userData.drift);
    atmosphere.setCloudMaps(maps);
    assert.equal(new Set(sprites.map(sprite=>sprite.material.map)).size,64);
    atmosphere.setCloudMaps();
    assert.equal(new Set(sprites.map(sprite=>sprite.material.map)).size,8);
    atmosphere.dispose();atmosphere.dispose();
    assert.ok(maps.every(map=>counts.get(map)===1));
  }finally{
    atmosphere?.dispose();globalThis.document=originalDocument;globalThis.innerWidth=originalWidth;globalThis.innerHeight=originalHeight;
  }
});

test('没有加载完成的云图时保持天空无云，收到纹理后才出现云，清空后不能回退程序云',()=>{
  const originalDocument=globalThis.document,originalWidth=globalThis.innerWidth,originalHeight=globalThis.innerHeight;
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})},
    {get:(target,key)=>target[key]??(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  globalThis.innerWidth=634;globalThis.innerHeight=768;
  let atmosphere;
  try {
    atmosphere=createAtmosphere(new THREE.Scene());
    const sprites=atmosphere.group.children.filter(item=>item.isSprite&&item.userData.drift);
    const camera=new THREE.PerspectiveCamera(54,1,.5,65000);camera.position.set(160,68,200);camera.lookAt(0,15,0);
    const env={...getEnvironment(createSimulation({hour:12,weather:'sunny'})),skyCloudCover:1};
    assert.ok(sprites.every(sprite=>!sprite.visible&&sprite.material.map===null),'第一帧之前也不能显示替代云图');
    atmosphere.update(0,env,camera);
    assert.ok(sprites.every(sprite=>!sprite.visible&&sprite.material.opacity===0));
    const maps=Array.from({length:8},()=>new THREE.Texture());atmosphere.setCloudMaps(maps);atmosphere.update(.1,env,camera);
    assert.ok(sprites.some(sprite=>sprite.visible));assert.ok(sprites.every(sprite=>maps.includes(sprite.material.map)));
    atmosphere.setCloudMaps(null);
    assert.ok(sprites.every(sprite=>!sprite.visible),'切换加载时应立即隐藏');
    atmosphere.update(.2,env,camera);
    assert.ok(sprites.every(sprite=>!sprite.visible&&sprite.material.map===null));
    const sky=atmosphere.group.children.find(object=>object.material?.uniforms?.uTyphoonCloudStrength);
    for(let step=3;step<60;step++)atmosphere.update(step/10,{...env,weather:'typhoon',typhoon:1,storm:1},camera);
    assert.equal(sky.material.uniforms.uTyphoonCloudStrength.value,0,'没有纹理时也不能显示程序风暴云顶');
    atmosphere.setCloudMaps(maps);atmosphere.update(6,{...env,weather:'typhoon',typhoon:1,storm:1},camera);
    assert.ok(sky.material.uniforms.uTyphoonCloudStrength.value>0,'纹理就绪后风暴云顶应恢复');
  } finally {atmosphere?.dispose();globalThis.document=originalDocument;globalThis.innerWidth=originalWidth;globalThis.innerHeight=originalHeight;}
});
