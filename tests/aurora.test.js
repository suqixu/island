import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNightSky} from '../src/night-sky.js';

const module = await import('../src/aurora.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
});
const clear={season:'winter',weather:'sunny',daylight:0,cloudiness:.12,skyCloudCover:0,fog:0};
function camera(){const view=new THREE.PerspectiveCamera(46,1.6,.5,7000);view.position.set(160,68,200);view.lookAt(0,15,0);view.updateMatrixWorld();return view;}
function create(options){assert.ok(module?.createAurora,'应提供独立的程序极光渲染器');return module.createAurora(options);}
function advance(aurora,view,seconds,env=clear,start=0){for(let t=start;t<=start+seconds;t+=.1)aurora.update(t,env,view);}

// 删除默认随机等待、把非晴夜计入调度或漏掉冬季限制都会使此测试失败。
test('默认极光仅在冬季晴夜随机等待后出现，不累计其他季节或白天的等待',()=>{
  const aurora=create({random:()=>0}),view=camera();
  try{
    aurora.update(0,clear,view);assert.equal(aurora.group.visible,false);
    advance(aurora,view,100,{...clear,season:'summer'},.1);assert.equal(aurora.group.visible,false);
    advance(aurora,view,100,{...clear,daylight:1},101);assert.equal(aurora.group.visible,false);
    advance(aurora,view,1,clear,202);assert.equal(aurora.group.visible,false);
    advance(aurora,view,50,clear,204);assert.equal(aurora.group.visible,true);
  }finally{aurora.dispose();}
});

test('默认极光随机间隔影响首次出现时间，结束后按新间隔再出现',()=>{
  const times=[];
  for(const sample of [0,1]){
    const aurora=create({random:()=>sample}),view=camera();let time=0;
    try{
      for(;time<180;time+=.1){aurora.update(time,clear,view);if(aurora.group.visible)break;}
      assert.ok(time<180);times.push(time);
      let ended=false,resumed=false;
      for(let i=0;i<5000;i++){time+=.1;aurora.update(time,clear,view);if(!aurora.group.visible)ended=true;else if(ended){resumed=true;break;}}
      assert.ok(ended&&resumed,'默认模式应结束本次光幕并继续随机调度');
    }finally{aurora.dispose();}
  }
  assert.ok(times[1]>times[0]+30,'不同随机样本应产生不同等待间隔');
});

test('即时极光首帧可见，关闭立即隐藏且停止触发，默认模式重新等待',()=>{
  const aurora=create({random:()=>0}),view=camera();
  try{
    aurora.setMode('instant');aurora.update(0,clear,view);assert.ok(aurora.group.visible);
    const curtain=aurora.group.getObjectByName('aurora-curtains');assert.ok(curtain.material.uniforms.uOpacity.value>.1);
    aurora.setMode('off');assert.equal(aurora.group.visible,false);
    advance(aurora,view,200,clear,.1);assert.equal(aurora.group.visible,false);
    aurora.setMode('default');advance(aurora,view,1,clear,202);assert.equal(aurora.group.visible,false);
    advance(aurora,view,50,clear,204);assert.equal(aurora.group.visible,true);
  }finally{aurora.dispose();}
});

test('即时模式仍受冬季、晴天和昼夜限制，云雾会连续削弱可见强度',()=>{
  const aurora=create({random:()=>0}),view=camera();
  try{
    aurora.setMode('instant');aurora.update(0,clear,view);
    const u=aurora.group.getObjectByName('aurora-curtains').material.uniforms,full=u.uOpacity.value;
    aurora.update(.1,{...clear,cloudiness:.5,fog:.3},view);assert.ok(u.uOpacity.value>0&&u.uOpacity.value<full*.8);
    for(const env of [{season:'spring'},{season:'summer'},{season:'autumn'},{daylight:1},{weather:'rain'},{weather:'snow'},{cloudiness:1},{fog:1}]){
      aurora.update(.2,{...clear,...env},view);assert.equal(aurora.group.visible,false,JSON.stringify(env));
    }
    aurora.update(.3,clear,view);assert.ok(aurora.group.visible,'晴夜恢复后即时模式无需等待');
  }finally{aurora.dispose();}
});

test('重复时间戳不推动极光时钟、随机数或 GPU 资源，世界方位不随转头跳动',()=>{
  let draws=0;const aurora=create({random:()=>{draws++;return .4;}}),view=camera();
  try{
    aurora.setMode('instant');aurora.update(0,clear,view);aurora.update(.1,clear,view);
    const mesh=aurora.group.getObjectByName('aurora-curtains'),geometry=mesh.geometry,material=mesh.material;
    const array=geometry.attributes.position.array,uniforms=material.uniforms,time=uniforms.uTime.value,bearing=uniforms.uBearing.value,count=draws;
    for(let i=0;i<100;i++)aurora.update(.1,clear,view);
    assert.equal(uniforms.uTime.value,time);assert.equal(draws,count);assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(geometry.attributes.position.array,array);
    view.lookAt(-100,500,200);view.updateMatrixWorld();aurora.update(.2,clear,view);assert.equal(uniforms.uBearing.value,bearing);
    assert.ok(uniforms.uTime.value>time);assert.ok(array.every(Number.isFinite));
    aurora.setQuality('low');assert.ok(mesh.geometry.index.count<=3456,'低质量最多1152个三角形');
  }finally{aurora.dispose();}
});

test('释放极光只销毁一次资源，释放后的更新不会复活光幕',()=>{
  const aurora=create(),view=camera(),mesh=aurora.group.getObjectByName('aurora-curtains');let geometries=0,materials=0;
  mesh.geometry.addEventListener('dispose',()=>geometries++);mesh.material.addEventListener('dispose',()=>materials++);
  aurora.setMode('instant');aurora.update(0,clear,view);aurora.dispose();aurora.dispose();aurora.update(1,clear,view);
  assert.equal(geometries,1);assert.equal(materials,1);assert.equal(aurora.group.children.length,0);assert.equal(aurora.group.visible,false);
});

test('夜空接口可独立切换极光，关闭流星彗星不会影响极光，并随夜空一起释放',()=>{
  const night=createNightSky(),view=camera();
  try{
    assert.equal(typeof night.setAuroraMode,'function','夜空需暴露极光三态接口');
    night.setMeteorsVisible(false);night.setCometsVisible(false);night.setAuroraMode('instant');night.update(0,clear,view);
    assert.ok(night.group.getObjectByName('aurora').visible);night.setAuroraMode('off');assert.equal(night.group.getObjectByName('aurora').visible,false);
  }finally{night.dispose();}
});

test('即时预览将场景切为冬季晴天22点并清理待续昼夜与天气进度',()=>{
  assert.equal(typeof module?.prepareAuroraPreview,'function','即时预览应提供统一场景准备函数');
  const state={seasonIndex:1,seasonProgress:220,weather:'storm',weatherProgress:80,weatherDuration:100,weatherSeasonIndex:1,hour:12,moonNightEnding:{elapsed:1},holdSunClock:true,holdMoonClock:true,autoSeason:true,autoWeather:false};
  module.prepareAuroraPreview(state);
  assert.equal(state.seasonIndex,3);assert.equal(state.seasonProgress,0);assert.equal(state.weather,'sunny');assert.equal(state.hour,22);
  assert.equal(state.weatherProgress,0);assert.equal(state.weatherDuration,undefined);assert.equal(state.weatherSeasonIndex,3);
  assert.equal(state.moonNightEnding,null);assert.equal(state.holdSunClock,false);assert.equal(state.holdMoonClock,false);
  assert.equal(state.autoSeason,true);assert.equal(state.autoWeather,false,'保留用户的自然变化开关');
});

test('大气层即时极光重置旧雨雾过渡，切晴的首帧即可观察',async()=>{
  const {createAtmosphere}=await import('../src/atmosphere.js');
  const {createSimulation,getEnvironment}=await import('../src/simulation.js');
  const keys=['document','innerWidth','innerHeight'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]??(()=>{})});
  Object.assign(globalThis,{document:{createElement:()=>({getContext:()=>context})},innerWidth:1280,innerHeight:800});
  const scene=new THREE.Scene(),moonMap=new THREE.Texture(),view=camera(),atmosphere=createAtmosphere(scene,{moonMap});
  try{
    atmosphere.update(0,getEnvironment(createSimulation({weather:'storm',hour:12})),view);
    assert.equal(typeof atmosphere.setAuroraMode,'function','大气层需暴露极光三态接口');
    atmosphere.setAuroraMode('instant');
    atmosphere.update(.1,getEnvironment(createSimulation({seasonIndex:3,weather:'sunny',hour:22})),view);
    const aurora=atmosphere.group.getObjectByName('aurora');assert.ok(aurora.visible,'旧雷暴云雾不能阻挡即时预览');
    assert.ok(aurora.getObjectByName('aurora-curtains').material.uniforms.uOpacity.value>.1);
  }finally{
    atmosphere.dispose();moonMap.dispose();
    for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('四种极光形态按事件随机选择，共用原几何材质和单次双面绘制',()=>{
  const samples=[[.01,0],[.30,1],[.60,2],[.90,3]];
  for(const [sample,want]of samples){
    const aurora=create({random:()=>sample}),view=camera(),mesh=aurora.group.getObjectByName('aurora-curtains');
    const geometry=mesh.geometry,material=mesh.material;
    try{
      aurora.setMode('instant');aurora.update(0,clear,view);
      assert.equal(material.uniforms.uShape?.value,want,'随机形态需传到真实顶点/片元程序');
      const detail=[material.uniforms.uPalette?.value,material.uniforms.uFold?.value,material.uniforms.uRayDensity?.value];
      assert.ok(detail.every(Number.isFinite),'色彩、褶皱、光束密度需各有事件参数');
      for(let i=0;i<100;i++)aurora.update(i/10,clear,view);
      assert.equal(material.uniforms.uShape.value,want);assert.deepEqual([material.uniforms.uPalette.value,material.uniforms.uFold.value,material.uniforms.uRayDensity.value],detail);
      assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(material.forceSinglePass,true);
      assert.equal(aurora.group.children.filter(child=>child.isMesh).length,1);
    }finally{aurora.dispose();}
  }
});

test('形态和颜色褶皱在一轮内固定，下一自然事件重新随机且不分配GPU资源',()=>{
  let sample=.01;const aurora=create({random:()=>sample}),view=camera(),mesh=aurora.group.getObjectByName('aurora-curtains');
  const geometry=mesh.geometry,material=mesh.material,array=geometry.attributes.position.array;let time=0;
  try{
    for(;time<50;time+=.1){aurora.update(time,clear,view);if(aurora.group.visible)break;}
    assert.ok(aurora.group.visible);assert.equal(material.uniforms.uShape?.value,0);
    const first={palette:material.uniforms.uPalette.value,fold:material.uniforms.uFold.value,density:material.uniforms.uRayDensity.value};
    sample=.99;
    for(let i=0;i<100;i++){time+=.1;aurora.update(time,clear,view);assert.equal(material.uniforms.uShape.value,0);assert.equal(material.uniforms.uPalette.value,first.palette);}
    let ended=false,resumed=false;
    for(let i=0;i<5000;i++){
      time+=.1;aurora.update(time,clear,view);
      if(!aurora.group.visible)ended=true;else if(ended){resumed=true;break;}
    }
    assert.ok(resumed);assert.equal(material.uniforms.uShape.value,3);assert.notEqual(material.uniforms.uPalette.value,first.palette);assert.notEqual(material.uniforms.uFold.value,first.fold);assert.notEqual(material.uniforms.uRayDensity.value,first.density);
    assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);assert.equal(geometry.attributes.position.array,array);
  }finally{aurora.dispose();}
});

test('真实台风持续15秒后即时预览同步清空独立云量，首帧极光可见且种子保留',async()=>{
  const {createCloudCoverState,advanceCloudCover}=await import('../src/cloud-cover.js');
  const {createSimulation,getEnvironment}=await import('../src/simulation.js');
  const state=createSimulation({weather:'typhoon',seasonIndex:1,hour:12,elapsed:0}),cover=createCloudCoverState(42),seed=cover.seed;
  for(let frame=0;frame<=900;frame++){
    state.elapsed=frame/60;
    advanceCloudCover(cover,state.elapsed,getEnvironment(state));
  }
  assert.ok(cover.coverage>.9,'先复现长时间台风造成的独立浓云');
  module.prepareAuroraPreview(state,cover);
  const env={...getEnvironment(state),skyCloudCover:advanceCloudCover(cover,state.elapsed,getEnvironment(state)).coverage};
  assert.equal(cover.seed,seed);assert.equal(env.skyCloudCover,0);
  const aurora=create(),view=camera();
  try{aurora.setMode('instant');aurora.update(state.elapsed,env,view);assert.ok(aurora.group.visible);}
  finally{aurora.dispose();}
  assert.equal(advanceCloudCover(cover,state.elapsed+10,getEnvironment(state)).coverage,0,'预览应保留一段无云观察时间');
  let sawCloud=false;
  for(let second=1;second<400;second++)sawCloud||=advanceCloudCover(cover,state.elapsed+10+second,getEnvironment(state)).coverage>.5;
  assert.ok(sawCloud,'清空后仍继续自然云量轮换');
});
