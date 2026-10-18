import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAtmosphere} from '../src/atmosphere.js';
import {createOcean} from '../src/ocean.js';
import {createSimulation,getEnvironment,advanceSimulation} from '../src/simulation.js';

const lunar=await import('../src/lunar-eclipse.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
const night={daylight:0,hour:22,dayIndex:3,moonIllumination:1,moonAltitude:.45,moonLight:1,
  moon:[-.6,.5,-.7],cloudiness:.12,skyCloudCover:.15,fog:0,rain:0,storm:0};

test('地影从一侧扫到另一侧，经历偏食、血红色全食和复圆，亮度连续且不全黑',()=>{
  assert.ok(lunar?.getLunarEclipseState);
  const start=lunar.getLunarEclipseState(0),middle=lunar.getLunarEclipseState(.5),end=lunar.getLunarEclipseState(1);
  assert.equal(start.coverage,0);assert.equal(end.coverage,0);assert.equal(middle.coverage,1);
  assert.equal(start.lightFactor,1);assert.equal(end.lightFactor,1);
  assert.ok(middle.lightFactor>.01&&middle.lightFactor<.12);
  assert.ok(lunar.getLunarEclipseState(.25).coverage>0&&lunar.getLunarEclipseState(.25).coverage<1);
  for(const phase of [.45,.5,.55])assert.equal(lunar.getLunarEclipseState(phase).totality,1);
  let previous=start;
  for(let i=1;i<=1000;i++){
    const current=lunar.getLunarEclipseState(i/1000);
    assert.ok(current.shadowCenter[0]>previous.shadowCenter[0]);
    assert.ok(Math.abs(current.lightFactor-previous.lightFactor)<.015);
    previous=current;
  }
  assert.equal(lunar.getLunarEclipseState().active,false);
});

test('默认月食只累计晴朗满月夜的等待，首次出现时间随机',()=>{
  assert.ok(lunar?.createLunarEclipse);
  const starts=[];
  for(const sample of [0,.99]){
    const event=lunar.createLunarEclipse({random:()=>sample});
    for(const env of [{...night,daylight:1},{...night,moonIllumination:.5},
      {...night,moonAltitude:-.1},{...night,cloudiness:1,storm:1}]){
      for(let i=0;i<180;i++)assert.equal(event.update(1,env).active,false);
    }
    let clock=0;
    for(;clock<180;clock++)if(event.update(1,night).active)break;
    assert.ok(clock<180);starts.push(clock);
  }
  assert.ok(starts[1]-starts[0]>60);
});

test('即时月食完整播放约96秒，跨午夜不重复，关闭和重置即时生效',()=>{
  assert.ok(lunar?.createLunarEclipse);
  const event=lunar.createLunarEclipse({random:()=>.9});event.setMode('instant');
  assert.equal(event.update(0,{...night,daylight:1}).active,false);
  assert.equal(event.update(0,{...night,moonIllumination:.5}).active,false);
  assert.equal(event.update(0,{...night,cloudiness:.9}).active,true);
  let state;
  for(let i=0;i<48;i++)state=event.update(1,night);
  assert.equal(state.totality,1);
  for(let i=0;i<48;i++)state=event.update(1,night);
  assert.equal(state.active,false);
  for(let i=0;i<120;i++)assert.equal(event.update(1,{...night,dayIndex:4,hour:1}).active,false);
  event.reset();assert.equal(event.update(0,night).active,true);
  event.setMode('off');assert.equal(event.update(1,night).active,false);
  event.setMode('default');assert.equal(event.update(1,night).active,false);
});

test('白昼或月相变化中断月食后，随机模式重新等待而不补播旧进度',()=>{
  assert.ok(lunar?.createLunarEclipse);
  const event=lunar.createLunarEclipse({random:()=>0});
  for(let i=0;i<46;i++)event.update(1,night);
  assert.equal(event.update(1,night).active,true);
  assert.equal(event.update(1,{...night,daylight:1}).active,false);
  for(let i=0;i<120;i++)assert.equal(event.update(1,night).active,false);
});

test('月食期间暂停月相推进，16倍速也不把满月变成凸月，结束后恢复',()=>{
  const simulation=createSimulation({hour:22,speed:16,holdSunClock:true,holdMoonClock:true,autoWeather:false,autoSeason:false});
  const initial=simulation.lunarDay;
  advanceSimulation(simulation,96);
  assert.equal(simulation.hour,22);assert.equal(simulation.lunarDay,initial);
  simulation.holdMoonClock=false;simulation.holdSunClock=false;advanceSimulation(simulation,1);
  assert.ok(simulation.lunarDay>initial);assert.notEqual(simulation.hour,22);
});

test('正式月面、海水和岛屿照明共用月食衰减，复圆后恢复且月盘不透明消失',()=>{
  assert.ok(lunar?.getLunarEclipseEnvironment);
  const original={document:globalThis.document,width:globalThis.innerWidth,height:globalThis.innerHeight};
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(obj,key)=>obj[key]??(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>context})};globalThis.innerWidth=1200;globalThis.innerHeight=750;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,1.6,.5,65000);camera.position.set(160,68,200);camera.lookAt(0,15,0);camera.updateMatrixWorld();
  let atmosphere,ocean;
  try{
    atmosphere=createAtmosphere(scene,{moonMap:new THREE.Texture()});ocean=createOcean(scene);
    const base={...getEnvironment(createSimulation({hour:22})),cloudiness:.12,skyCloudCover:.15};
    atmosphere.update(0,base,camera);ocean.update(0,base);
    const normal=atmosphere.sunLight.intensity,waterLight=ocean.mesh.material.uniforms.uMoonLight.value;
    const sea=ocean.mesh.material.uniforms;
    const palette=[atmosphere.hemisphereLight.color,atmosphere.hemisphereLight.groundColor,atmosphere.sunLight.color,
      scene.getObjectByName('moon-bounce-fill').color,sea.uShallowColor.value,sea.uDeepColor.value,sea.uHorizonColor.value,sea.uZenithColor.value];
    const normalPalette=palette.map(color=>color.toArray());
    const moon=scene.getObjectByName('phase-moon'),opacity=moon.material.uniforms.uOpacity.value;
    const eclipse=lunar.getLunarEclipseState(.5),env=lunar.getLunarEclipseEnvironment(base,eclipse);
    assert.equal(base.daylight,env.daylight);assert.ok(base.moonLight>env.moonLight);
    atmosphere.update(1,env,camera);ocean.update(1,env);
    assert.equal(moon.material.uniforms.uLunarEclipseActive.value,1);
    assert.deepEqual(moon.material.uniforms.uEarthShadow.value.toArray(),eclipse.shadowCenter);
    assert.equal(moon.material.uniforms.uOpacity.value,opacity);
    assert.ok(atmosphere.sunLight.intensity>0,'红月保留能照到岛屿的红色照明');
    for(const color of palette)assert.ok(color.r>color.b*2&&color.r>color.g*2,'红月同时染红岛屿光照、浅海、深海与反射天色');
    assert.ok(ocean.mesh.material.uniforms.uMoonLight.value<waterLight*.12);
    assert.ok(ocean.mesh.material.uniforms.uMoonTint.value.r>ocean.mesh.material.uniforms.uMoonTint.value.b*2);
    atmosphere.update(2,base,camera);ocean.update(2,base);
    assert.equal(moon.material.uniforms.uLunarEclipseActive.value,0);
    assert.ok(atmosphere.sunLight.intensity>normal*.99);
    assert.equal(ocean.mesh.material.uniforms.uMoonLight.value,waterLight);
    assert.deepEqual(ocean.mesh.material.uniforms.uMoonTint.value.toArray(),[1,1,1]);
    assert.deepEqual(palette.map(color=>color.toArray()),normalPalette,'复圆或关闭后海岛和海面恢复原色');
  }finally{atmosphere?.dispose();ocean?.dispose();globalThis.document=original.document;globalThis.innerWidth=original.width;globalThis.innerHeight=original.height;}
});

test('非活动和关闭月食无环境染色，偏食不提前血红，深全食才缓慢出现红月与暗红天空',()=>{
  const inactive=lunar.getLunarEclipseEnvironment(night);
  assert.equal(inactive.lunarSkyTintStrength,0);assert.equal(inactive.lunarHaloFactor,1);assert.equal(inactive.lunarBloodStrength,0);
  const partial=lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(.25));
  assert.equal(partial.lunarBloodStrength,0);assert.equal(partial.lunarSkyTintStrength,0);
  assert.ok(partial.moonLightTint[2]>.9,'偏食不提前染红海面照明');
  const entries=[.34,.38,.42,.46,.5].map(phase=>lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(phase)));
  assert.ok(entries[4].lunarBloodStrength>.9);assert.ok(entries[4].lunarSkyTintStrength>.8);
  for(let i=1;i<entries.length;i++)assert.ok(entries[i].lunarBloodStrength>=entries[i-1].lunarBloodStrength);
  assert.ok(entries[1].lunarBloodStrength<entries[4].lunarBloodStrength*.8,'刚进入全食时不能直接跳成满强度红月');
  const daylight=lunar.getLunarEclipseEnvironment({...night,daylight:1},lunar.getLunarEclipseState(.5));
  assert.equal(daylight.lunarSkyTintStrength,0,'艺术染红效果不能影响白天');
  const restored=lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(1));
  assert.equal(restored.lunarSkyTintStrength,0);assert.equal(restored.lunarHaloFactor,1);assert.equal(restored.moonLight,night.moonLight);
});

test('偏食不显示额外光圈，红月月面保持明亮并仅留下少量窄边光',()=>{
  let previous=1;
  for(let i=0;i<=500;i++){
    const env=lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(i/1000));
    assert.ok(Number.isFinite(env.lunarHaloFactor));assert.ok(env.lunarHaloFactor<=previous+.000001);
    assert.ok(Math.abs(env.lunarHaloFactor-previous)<.02);previous=env.lunarHaloFactor;
    if(env.lunarEclipse.coverage<1){assert.equal(env.lunarRimStrength,0,'月面没有完全被遮挡时不能出现光圈');assert.equal(env.lunarCoronaStrength,0);}
  }
  assert.ok(previous>=.35&&previous<=.5);
  const full=lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(.5));
  assert.ok(full.lunarRimStrength>.1&&full.lunarRimStrength<=.2);assert.ok(full.lunarDiscExposure>=1.55);
  assert.ok(full.lunarGlowLight>.5,'红月发光独立于被遮挡后减弱的环境月光');
  const off=lunar.getLunarEclipseEnvironment(night);assert.equal(off.lunarHaloFactor,1);assert.equal(off.lunarRimStrength,0);assert.equal(off.lunarGlowLight,0);assert.equal(off.lunarCoronaStrength,0);
});

test('刚完全遮挡时先亮起红色边光，再平滑过渡为红月，复圆不重复闪环',()=>{
  const samples=Array.from({length:1001},(_,i)=>lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(i/1000)));
  const entry=samples.slice(0,500).find(env=>env.lunarCoronaStrength>.8);
  assert.ok(entry,'进入全食后先出现清晰的亮边');
  assert.equal(entry.lunarEclipse.coverage,1,'没有全部遮挡前不出现亮环');
  assert.equal(entry.lunarBloodStrength,0,'亮环先出现，随后才开始变红');
  assert.ok(samples[420].lunarBloodStrength>entry.lunarBloodStrength);
  assert.ok(samples[500].lunarBloodStrength>.99);
  assert.ok(samples[500].lunarRimStrength<entry.lunarRimStrength*.4);
  assert.equal(samples[500].lunarCoronaStrength,0,'红月完全显现后收起日冕');
  for(let i=501;i<1001;i++)assert.equal(samples[i].lunarCoronaStrength,0,'退出全食时不再闪一次日冕');
  for(let i=1;i<samples.length;i++){
    assert.ok(Math.abs(samples[i].lunarRimStrength-samples[i-1].lunarRimStrength)<.14,'亮环不能突然跳变');
    assert.ok(Math.abs(samples[i].lunarBloodStrength-samples[i-1].lunarBloodStrength)<.03,'红月应渐变显现');
  }
});

test('真实大气偏食保持亮黄色且不加光圈，明亮红月仅保留少量边光，复圆后恢复',()=>{
  const original={document:globalThis.document,width:globalThis.innerWidth,height:globalThis.innerHeight};
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(obj,key)=>obj[key]??(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>context})};globalThis.innerWidth=1200;globalThis.innerHeight=750;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,1.6,.5,65000);camera.position.set(160,68,200);camera.lookAt(0,15,0);camera.updateMatrixWorld();let atmosphere;
  try{
    atmosphere=createAtmosphere(scene,{moonMap:new THREE.Texture()});
    const base={...getEnvironment(createSimulation({hour:22})),cloudiness:.12,skyCloudCover:.45};
    atmosphere.update(0,base,camera);
    const moon=scene.getObjectByName('phase-moon'),sky=atmosphere.group.children.find(object=>object.material?.uniforms?.uZenith),u=sky.material.uniforms;
    const normal={halo:u.uMoonStrength.value,zenith:u.uZenith.value.clone(),horizon:u.uHorizon.value.clone(),fog:scene.fog.color.clone(),tint:moon.material.uniforms.uTint.value.clone()};
    const normalDiscScale=moon.scale.x/moon.material.uniforms.uDiscUvScale.value;
    atmosphere.update(.1,lunar.getLunarEclipseEnvironment(base,lunar.getLunarEclipseState(.25)),camera);
    const tint=moon.material.uniforms.uTint.value;
    assert.deepEqual(tint.toArray(),normal.tint.toArray(),'偏食保留正常的暖黄月色');
    assert.ok(moon.material.uniforms.uDiscExposure?.value>=1.55,'月食亮部保持明亮');
    assert.equal(moon.material.uniforms.uLunarRimStrength?.value,0,'偏食期间不显示额外边缘光圈');
    assert.equal(moon.material.uniforms.uLunarBloodStrength?.value,0);
    atmosphere.update(.15,lunar.getLunarEclipseEnvironment(base,lunar.getLunarEclipseState(.39)),camera);
    assert.ok(moon.material.uniforms.uLunarCoronaStrength.value>.8,'完全遮挡后先出现与日食相同的日冕');
    assert.ok(Math.abs(moon.scale.x/moon.material.uniforms.uDiscUvScale.value-normalDiscScale)<1e-7,'日冕扩大绘制区域时不能放大月面');
    atmosphere.update(.2,lunar.getLunarEclipseEnvironment(base,lunar.getLunarEclipseState(.5)),camera);
    assert.ok(u.uMoonStrength.value>normal.halo*.15&&u.uMoonStrength.value<normal.halo,'全食保留可见柔光，但不照亮整片天空');
    assert.ok(moon.material.uniforms.uDiscExposure.value>=1.55);
    assert.ok(moon.material.uniforms.uLunarRimStrength.value>.1&&moon.material.uniforms.uLunarRimStrength.value<=.2);
    assert.equal(moon.material.uniforms.uLunarCoronaStrength.value,0,'红月完全显现后日冕消退');
    for(const color of [u.uZenith.value,u.uHorizon.value,u.uBelow.value,scene.fog.color,u.uSeaHorizonColor.value])assert.ok(color.r>color.b*1.3,'全食的天空、低空、远海和雾应呈暗红');
    const cloud=atmosphere.group.children.find(object=>object.isSprite&&object.userData.drift);assert.ok(cloud.material.color.r>cloud.material.color.b*1.3);
    atmosphere.update(.3,base,camera);
    assert.deepEqual(u.uZenith.value.toArray(),normal.zenith.toArray());assert.deepEqual(u.uHorizon.value.toArray(),normal.horizon.toArray());assert.deepEqual(scene.fog.color.toArray(),normal.fog.toArray());assert.equal(u.uMoonStrength.value,normal.halo);assert.equal(moon.material.uniforms.uDiscExposure.value,1.55);assert.equal(moon.material.uniforms.uLunarRimStrength.value,0);assert.deepEqual(moon.material.uniforms.uTint.value.toArray(),normal.tint.toArray());
  }finally{atmosphere?.dispose();globalThis.document=original.document;globalThis.innerWidth=original.width;globalThis.innerHeight=original.height;}
});


test('血月共享海天低空色仅在夜间改变，返回新状态而不污染常规海天色',()=>{
  const input={night:1,color:[.01,.02,.03],weather:.2,cloudCover:.3},original=structuredClone(input);
  const env=lunar.getLunarEclipseEnvironment(night,lunar.getLunarEclipseState(.5));
  const tinted=lunar.getLunarEclipseSeaHorizon(env,input);
  assert.ok(tinted.color[0]>tinted.color[2]*2);assert.deepEqual(input,original);
  assert.equal(tinted.weather,input.weather);assert.equal(tinted.cloudCover,input.cloudCover);
  assert.deepEqual(lunar.getLunarEclipseSeaHorizon(lunar.getLunarEclipseEnvironment(night),input),original);
  assert.deepEqual(lunar.getLunarEclipseSeaHorizon({...env,daylight:1},input),original);
});
