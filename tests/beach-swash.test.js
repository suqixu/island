import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {heightAt,coastRadius,shoreDistance} from '../src/terrain.js';
import {getLagoonMask} from '../src/lagoon.js';
import {createOcean} from '../src/ocean.js';
import {sampleCameraWaterHeight} from '../src/ocean-height.js';
const beach=await import('../src/beach-swash.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});

test('细沙岸坡平缓连续，水线两侧不再有近二十厘米台阶',()=>{
  for(let i=0;i<32;i++){
    const angle=i/32*Math.PI*2,radius=coastRadius(angle),c=Math.cos(angle),s=Math.sin(angle);
    const ellipse=Math.hypot(c*1.025,s*.975);
    const point=d=>[c*(radius-d)/ellipse,s*(radius-d)/ellipse];
    const center=point(0);
    if(getLagoonMask(...center,shoreDistance(...center))>0)continue;
    assert.ok(Math.abs(heightAt(...point(.001))-heightAt(...point(-.001)))<.005);
    assert.ok(heightAt(...point(3))>.2&&heightAt(...point(3))<.5);
    assert.ok(heightAt(...point(-3))<0&&heightAt(...point(-3))>-.5);
  }
});

test('薄水层随浪涌上再退去，湿沙比水头稍晚退，深水不被整体抬高',()=>{
  assert.ok(beach?.getBeachSwash);
  let lowest=Infinity,highest=-Infinity,lagged=false;
  for(let i=0;i<200;i++){
    const t=i*.1,state=beach.getBeachSwash(20,70,t);
    lowest=Math.min(lowest,state.height);highest=Math.max(highest,state.height);
    assert.ok(state.height>=0&&state.height<.5);
    if(state.wetLevel>state.height+.15)lagged=true;
    assert.equal(beach.getBeachSwash(20,70,t,{depth:8}).height,0);
    assert.ok(beach.getBeachSwash(20,70,t,{exposure:.28}).height<=state.height);
  }
  assert.ok(highest-lowest>.25);assert.ok(lagged,'退水后应留下湿沙而不是同时变干');
});

test('近岸相机水位包含薄涌浪，进入岛内的镜头不会把岛内当成水面',()=>{
  const weather={wind:.2,storm:0,swell:.3,gust:.1,typhoon:0};
  let maximum=0;
  for(let t=0;t<12;t+=.2)maximum=Math.max(maximum,sampleCameraWaterHeight(20,70,t,t,0,0,1,weather,1));
  assert.ok(maximum>.25,'不能仅按静止海平面计算相机水位');
  assert.equal(sampleCameraWaterHeight(0,0,2,2,0,0,1,weather,0),0);
});

test('浅滩高度纹理保留厘米级水深，反复更新不重传，退出释放一次',()=>{
  const ocean=createOcean(new THREE.Scene(),{heightAt:(x,z)=>x*.011+z*.004});
  try{
    const map=ocean.mesh.material.uniforms.uTerrainHeight?.value;
    assert.ok(map?.isDataTexture,'低精度海床颜色通道不足以表现薄水层');
    assert.equal(map.type,THREE.HalfFloatType);
    const {data,width,height}=map.image;
    for(const [x,z] of [[127,128],[130,128],[125,126]]){
      const wx=(x/(width-1)-.5)*480,wz=(z/(height-1)-.5)*480;
      assert.ok(Math.abs(THREE.DataUtils.fromHalfFloat(data[z*width+x])-(wx*.011+wz*.004))<.002);
    }
    const version=map.version;for(let t=0;t<5;t++)ocean.update(t,{daylight:1,wind:.2});
    assert.equal(map.version,version);
    let releases=0;map.addEventListener('dispose',()=>releases++);ocean.dispose();ocean.dispose();assert.equal(releases,1);
  }finally{ocean.dispose();}
});
