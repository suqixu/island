import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAtmosphere} from '../src/atmosphere.js';
const module=await import('../src/solar-eclipse.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
const day={daylight:1,sun:[.3,.8,.5],cloudiness:.12,skyCloudCover:.2,fog:0,rain:0,storm:0};

test('日食完整经历偏食、全食和复圆，亮度连续恢复且全食短暂停留',()=>{
  assert.ok(module?.getSolarEclipseState);
  const start=module.getSolarEclipseState(0),middle=module.getSolarEclipseState(.5),end=module.getSolarEclipseState(1);
  assert.equal(start.coverage,0);assert.equal(end.coverage,0);assert.equal(middle.coverage,1);
  assert.equal(start.lightFactor,1);assert.equal(end.lightFactor,1);assert.ok(middle.lightFactor<.04);
  assert.ok(module.getSolarEclipseState(.25).coverage>0&&module.getSolarEclipseState(.25).coverage<1);
  for(const phase of [.45,.5,.55])assert.ok(module.getSolarEclipseState(phase).totality>.9);
  let last=start;
  for(let i=1;i<=1000;i++){
    const state=module.getSolarEclipseState(i/1000);
    assert.ok(Math.abs(state.lightFactor-last.lightFactor)<.025);
    assert.ok(Number.isFinite(state.offset)&&state.coverage>=0&&state.coverage<=1);last=state;
  }
});

test('默认日食在晴朗白天随机出现，夜晚与恶劣天气不累计等待',()=>{
  assert.ok(module?.createSolarEclipse);const first=[];
  for(const sample of [0,.99]){
    const eclipse=module.createSolarEclipse({random:()=>sample});let clock=0;
    for(const env of [{...day,daylight:0,sun:[0,-1,0]},{...day,cloudiness:1,storm:1}]){
      for(let i=0;i<200;i++)assert.equal(eclipse.update(1,env).active,false);
    }
    for(;clock<150;clock++)if(eclipse.update(1,day).active)break;
    first.push(clock);
  }
  assert.ok(first[1]-first[0]>60,'首次等待应每次随机，不重复固定周期');
});

test('日食三态可即时触发、立即关闭和恢复随机，完整过程约48秒',()=>{
  const eclipse=module.createSolarEclipse({random:()=>.9});
  eclipse.setMode('instant');let state=eclipse.update(0,day);assert.equal(state.active,true);
  for(let i=0;i<24;i++)state=eclipse.update(1,day);
  assert.ok(state.coverage>.99&&state.lightFactor<.04);
  for(let i=0;i<24;i++)state=eclipse.update(1,day);
  assert.equal(state.active,false);assert.equal(state.lightFactor,1);
  eclipse.update(.1,day);eclipse.setMode('off');state=eclipse.update(.1,day);
  assert.equal(state.active,false);assert.equal(state.lightFactor,1);
  eclipse.setMode('default');assert.equal(eclipse.update(1,day).active,false);
});

test('随机日食被夜晚打断后重新等待，不在下一晴日补播',()=>{
  const eclipse=module.createSolarEclipse({random:()=>0});let state;
  for(let i=0;i<31;i++)state=eclipse.update(1,day);assert.ok(state.active);
  eclipse.update(1,{...day,daylight:0,sun:[0,-1,0]});
  for(let i=0;i<120;i++)assert.equal(eclipse.update(1,day).active,false);
});

test('即时日食在阴天也立即启动过程，可见度仍由天气遮挡决定',()=>{
  const eclipse=module.createSolarEclipse({random:()=>.9});eclipse.setMode('instant');
  assert.ok(eclipse.update(0,{...day,cloudiness:.86}).active);
});

test('落日时段不随机启动日食，避免日食与晚霞重叠',()=>{
  const eclipse=module.createSolarEclipse({random:()=>0});
  for(let i=0;i<200;i++)assert.equal(eclipse.update(1,{...day,hour:17,sun:[.8,.35,.5]}).active,false);
});

test('完整日食自然推进时每日最多一次，跨日、手动切换和拖动重置后可重看',()=>{
  const eclipse=module.createSolarEclipse({random:()=>0});eclipse.setMode('instant');
  eclipse.update(0,{...day,dayIndex:7});
  for(let i=0;i<48;i++)eclipse.update(1,{...day,dayIndex:7});
  for(let i=0;i<120;i++)assert.equal(eclipse.update(1,{...day,dayIndex:7}).active,false,'当日结束后不能接着再播');
  eclipse.update(1,{...day,dayIndex:7,daylight:0,sun:[0,-1,0]});
  assert.equal(eclipse.update(1,{...day,dayIndex:7}).active,false);
  assert.ok(eclipse.update(1,{...day,dayIndex:8}).active,'进入新的模拟日后允许再次出现');
  for(let i=0;i<48;i++)eclipse.update(1,{...day,dayIndex:8});
  eclipse.setMode('off');eclipse.setMode('instant');
  assert.ok(eclipse.update(0,{...day,dayIndex:8}).active,'手动切图标可以重置');
  for(let i=0;i<48;i++)eclipse.update(1,{...day,dayIndex:8});
  eclipse.reset();assert.ok(eclipse.update(0,{...day,dayIndex:8}).active,'手动拖时间可以重置');
});

test('正式大气消费日食遮挡与日冕参数，全食降低照明但保留真实日盘可见度',()=>{
  const original={document:globalThis.document,width:globalThis.innerWidth,height:globalThis.innerHeight};
  const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(obj,key)=>obj[key]??(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>context})};globalThis.innerWidth=1200;globalThis.innerHeight=750;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,1.6,.5,65000);camera.position.set(160,68,200);camera.lookAt(0,15,0);camera.updateMatrixWorld();
  let atmosphere;
  try{
    atmosphere=createAtmosphere(scene,{moonMap:new THREE.Texture()});
    atmosphere.update(0,{...day,hour:12,moonLight:0,moonVisibility:0},camera);
    const normal=atmosphere.sunLight.intensity,sky=atmosphere.group.children.find(obj=>obj.material?.uniforms?.uZenith),u=sky.material.uniforms;
    const eclipse=module.getSolarEclipseState(.5);
    atmosphere.update(1,{...day,hour:12,moonLight:0,moonVisibility:0,solarDaylight:1,daylight:eclipse.lightFactor,eclipse},camera);
    assert.equal(u.uEclipseCoverage.value,1);assert.equal(u.uEclipseTotality.value,1);
    assert.ok(atmosphere.sunLight.intensity<normal*.05,'全食应降低岛屿与海面照明');
    assert.ok(u.uSunDiscVisibility.value>.9,'太阳不能被当作普通夜晚完全关闭，否则无法显示日冕');
    atmosphere.update(2,{...day,hour:12,moonLight:0,moonVisibility:0},camera);
    assert.equal(u.uEclipseCoverage.value,0);assert.equal(u.uEclipseTotality.value,0);
    assert.ok(atmosphere.sunLight.intensity>normal*.95);
  }finally{atmosphere?.dispose();globalThis.document=original.document;globalThis.innerWidth=original.width;globalThis.innerHeight=original.height;}
});
