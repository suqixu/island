import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleTyphoonWave, sampleTyphoonBreaker } from '../src/typhoon-waves.js';
import { createOcean } from '../src/ocean.js';
import { createOceanSpray } from '../src/ocean-spray.js';

test('台风浪组成向风传播的高浪组，普通天气不引入额外位移', () => {
  let peak = 0, trough = 0;
  for (let t = 0; t < 40; t += .05) {
    const h = sampleTyphoonWave(80, 30, t, [1, 0], 30, 1, 1);
    peak = Math.max(peak, h); trough = Math.min(trough, h);
    assert.equal(sampleTyphoonWave(80, 30, t, [1, 0], 30, 1, 0), 0);
  }
  assert.ok(peak > 9 && peak < 15, `主浪高 ${peak}`);
  assert.ok(trough < -1);
  let movingError = 0, stationaryError = 0;
  for (let t = 0; t < 40; t += .1) {
    const h = sampleTyphoonWave(80, 30, t, [1, 0], 30, 1, 1);
    movingError += (sampleTyphoonWave(92, 30, t + 1, [1, 0], 30, 1, 1) - h) ** 2;
    stationaryError += (sampleTyphoonWave(80, 30, t + 1, [1, 0], 30, 1, 1) - h) ** 2;
  }
  assert.ok(movingError < stationaryError * .25, '主浪向风推进，交叉风浪保留独立速度');
});

test('台风海面有独立交叉风浪，浅水浪高受水深约束且不形成等距水墙', () => {
  let crossingError=0, energy=0, largestStep=0, previous=null;
  for(let t=0;t<40;t+=.05) {
    const h=sampleTyphoonWave(80,30,t,[1,0],30,1,1);
    crossingError+=(sampleTyphoonWave(92,30,t+1,[1,0],30,1,1)-h)**2;
    energy+=h*h;
    if(previous!==null)largestStep=Math.max(largestStep,Math.abs(h-previous));previous=h;
    for(const depth of [0,.5,2,4]) {
      const shallow=sampleTyphoonWave(80,30,t,[1,0],depth,1,1);
      assert.ok(Math.abs(shallow)<=depth*.72+1e-8,'破浪后不能继续把整片浅海抬成水墙');
    }
  }
  assert.ok(crossingError>energy*.003,'不能只有一列刚性平移的浪脊');
  assert.ok(largestStep<2,'浪形变化须连续');
});

test('浅岸破浪逐渐衰减，泻湖遮浪，强度可连续过渡', () => {
  for (let t = 0; t < 20; t += .2) {
    const open = sampleTyphoonWave(80, 30, t, [1, 0], 30, 1, 1);
    const lagoon = sampleTyphoonWave(80, 30, t, [1, 0], 30, .28, 1);
    assert.ok(Math.abs(lagoon) <= Math.abs(open) * .29 + 1e-8);
    assert.ok(Math.abs(sampleTyphoonWave(80, 30, t, [1, 0], 0, 1, 1)) < 1.8);
    assert.equal(sampleTyphoonWave(80, 30, t, [1, 0], 30, 1, .5), open * .5);
  }
});

test('同一浪峰仅局部破碎，浪谷不铺白沫，破碎后留下渐散的尾沫', () => {
  let gaps=0,broken=0,wakes=0;
  for(let z=-180;z<=180;z+=3) {
    let crest,crestTime=0,peak=-Infinity;
    for(let t=0;t<10;t+=.04) {
      const value=sampleTyphoonWave(80,z,t,[1,0],30,1,1);
      if(value>peak) {peak=value;crestTime=t;}
    }
    crest=sampleTyphoonBreaker(80,z,crestTime-.25,[1,0],30,1,1);
    if(crest.breaking>.1)broken++;else gaps++;
    const after=sampleTyphoonBreaker(80,z,crestTime+.6,[1,0],30,1,1);
    if(after.foam>.03 && after.breaking<crest.breaking)wakes++;
  }
  assert.ok(gaps>25 && broken>15,'浪脊必须有大段断口与不规则破碎段');
  assert.ok(wakes>10,'浪峰通过后保留断续的尾沫');
  const calm=sampleTyphoonBreaker(0,0,2,[1,0],20,1,0);
  assert.equal(calm.foam,0);assert.equal(calm.breaking,0);
});

test('拍岸破碎能量随浅岸与迎风条件变化，泻湖抑制强喷溅', () => {
  let open=0,sheltered=0,deep=0;
  for(let z=-60;z<=60;z+=5)for(let t=0;t<20;t+=.05) {
    open+=sampleTyphoonBreaker(-62,z,t,[1,0],2,1,1).impact;
    sheltered+=sampleTyphoonBreaker(-62,z,t,[1,0],2,.28,1).impact;
    deep+=sampleTyphoonBreaker(-62,z,t,[1,0],30,1,1).impact;
  }
  assert.ok(open>1);assert.ok(sheltered<open*.2);assert.equal(deep,0);
});

test('台风切换保留连续相位，喷溅按画质限量且释放幂等', () => {
  const scene = new THREE.Group();
  const ocean = createOcean(scene, { heightAt: (x, z) => (60 - Math.hypot(x, z)) * .4 });
  ocean.update(0, { typhoon: 0, windSpeed: 7 });
  ocean.update(.1, { typhoon: 1, windSpeed: 55 });
  const uniforms = ocean.mesh.material.uniforms;
  assert.ok(uniforms.uTyphoon.value > 0 && uniforms.uTyphoon.value < .3);
  assert.ok(uniforms.uWaveTime.value < .25);
  ocean.setQuality('low');
  const spray = scene.getObjectByName('拍岸浪花');
  assert.ok(spray.geometry.drawRange.count <= 400);
  ocean.dispose(); ocean.dispose();
  assert.equal(scene.children.length, 0);
});

test('浪峰到岸才产生飞沫，迎风岸喷溅随后回落消散', () => {
  const scene = new THREE.Group();
  const spray = createOceanSpray(scene, { heightAt: (x, z) => (60 - Math.hypot(x, z)) * .4 });
  spray.update(.1, 0, { typhoon: 0 }, [1, 0]);
  assert.equal(scene.children.length, 0);
  let maximum = 0;
  for (let frame = 0; frame < 300; frame++) {
    spray.update(.05, frame * .05, { typhoon: 1, daylight: 1 }, [1, 0]);
    const a = spray.points.geometry.attributes.aAlpha.array;
    maximum = Math.max(maximum, a.filter(value => value > 0).length);
  }
  assert.ok(maximum > 50 && maximum <= 1600, '拍岸时有受池容量限制的活跃水花');
  spray.update(4.5, 19.5, { typhoon: 0 }, [1, 0]);
  assert.equal(spray.points.visible, false, '天气恢复后旧水花消散');
  spray.dispose();
});

test('拍岸喷溅同时包含破碎水片、水滴和水雾，向外展开且有明显高度', () => {
  const spray=createOceanSpray(new THREE.Group(),{heightAt:(x,z)=>(60-Math.hypot(x,z))*.4});
  let drops=0,mist=0,sheets=0,high=0,rebound=0,along=0;
  for(let frame=0;frame<500;frame++) {
    spray.update(.04,frame*.08,{typhoon:1,daylight:1},[1,0]);
    const attributes=spray.points.geometry.attributes;
    assert.ok(attributes.aKind,'水滴和水雾需要独立的形态与寿命');
    for(let i=0;i<1600;i++) if(attributes.aAlpha.array[i]>.05) {
      if(attributes.aKind.array[i]<.5)drops++;else if(attributes.aKind.array[i]<1.5)mist++;else sheets++;
      high=Math.max(high,attributes.position.array[i*3+1]);
      if(attributes.aVelocity.array[i*3]<-1)rebound++;
      if(Math.abs(attributes.aVelocity.array[i*3+2])>3)along++;
    }
  }
  assert.ok(drops>100 && mist>100 && sheets>100);assert.ok(high>12 && high<50);
  assert.ok(rebound>50 && along>50,'水花须沿岸散开并向海反弹，不能全部随风同向飘');
  spray.dispose();
});

test('16倍低帧率的大时间步仍保留出生时间分散的拍岸水花', () => {
  const spray = createOceanSpray(new THREE.Group(), { heightAt: (x, z) => (60 - Math.hypot(x, z)) * .4 });
  let visible = 0;
  for (let i = 0; i < 80; i++) {
    spray.update(2.4, i * 5, { typhoon: 1 }, [1, 0]);
    visible += Number(spray.points.visible);
    for (const value of spray.points.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
  }
  assert.ok(visible > 20, '不能在每帧出生后立即把所有水花寿命用尽');
  spray.dispose();
});
