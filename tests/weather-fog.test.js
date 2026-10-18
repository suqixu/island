import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAtmosphere } from '../src/atmosphere.js';
import { createSimulation, getEnvironment } from '../src/simulation.js';

const coverage = (fog, depth) => 1 - Math.exp(-((fog.density * depth) ** 2));
const luminance = color => color.r * .2126 + color.g * .7152 + color.b * .0722;

function withAtmosphere(run) {
  const keys = ['document', 'innerWidth', 'innerHeight'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const context = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) }, innerWidth: 634, innerHeight: 768 });
  const scene = new THREE.Scene(), moonMap = new THREE.Texture();
  const camera = new THREE.PerspectiveCamera(54, 634 / 768, .5, 65000);
  camera.position.set(237, 101, 296);camera.lookAt(0, 15, 0);camera.updateMatrixWorld();
  // 天气形态在云纹理已就绪的场景验收；未就绪保持无云由 cloud-cover 测试覆盖。
  const atmosphere = createAtmosphere(scene, { moonMap, cloudMaps: Array.from({length:8},()=>new THREE.Texture()) });
  let time = 0;
  const update = weather => atmosphere.update(time += .05, getEnvironment(createSimulation({ hour: 12, weather, windSeed: 1 })), camera);
  try { run({ atmosphere, scene, camera, update }); }
  finally {
    atmosphere.dispose();moonMap.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);else delete globalThis[key];
    }
  }
}

test('影片暂停定位可立即清除上一段降雪，不在夏夜画面残留雪花',()=>{
  withAtmosphere(({atmosphere,scene,camera})=>{
    const snow=getEnvironment(createSimulation({weather:'snow',windSeed:42}));atmosphere.update(1,snow,camera);
    const layers=['近景大片雪','中景密雪','远景雪幕'].map(name=>scene.getObjectByName(name));assert.ok(layers.some(layer=>layer.visible));
    const clear={...getEnvironment(createSimulation({hour:22,weather:'sunny',seasonIndex:1,windSeed:42})),instantFilmFrame:true};atmosphere.update(1,clear,camera);assert.ok(layers.every(layer=>!layer.visible));
  });
});

test('长时间运行后切换暴风雪仍连续旋转雪晶，重复时间不推进粒子且低画质限量', () => {
  withAtmosphere(({atmosphere,scene,camera})=>{
    const snow=getEnvironment(createSimulation({weather:'snow',windSeed:42}));
    const blizzard=getEnvironment(createSimulation({weather:'blizzard',windSeed:42}));
    atmosphere.update(3600,snow,camera);
    const layers=['近景大片雪','中景密雪','远景雪幕'].map(name=>scene.getObjectByName(name));
    const before=layers.map(layer=>layer.material.uniforms.uRotation?.value);
    assert.ok(before.every(Number.isFinite),'雪晶旋转必须作为累计相位传给GPU');
    atmosphere.update(3600.05,blizzard,camera);
    layers.forEach((layer,i)=>{
      const rotation=layer.material.uniforms.uRotation.value;
      assert.ok(rotation>=before[i]&&rotation-before[i]<.06,'转角增量只由本帧时长决定');
    });
    const rotations=layers.map(layer=>layer.material.uniforms.uRotation.value);
    atmosphere.update(3600.05,blizzard,camera);
    layers.forEach((layer,i)=>assert.equal(layer.material.uniforms.uRotation.value,rotations[i]));
    atmosphere.setQuality('low');atmosphere.update(3600.10,blizzard,camera);
    assert.ok(layers.every(layer=>layer.geometry.drawRange.count<=layer.geometry.attributes.position.count*.5));
    assert.equal(atmosphere.lightningActive,false);
  });
});

test('三层雪花共享透明图集，替换基础纹理后正确释放且释放不重复', () => {
  withAtmosphere(({atmosphere,scene})=>{
    const atlas=new THREE.Texture();let released=0;
    atlas.addEventListener('dispose',()=>released++);
    atmosphere.setSnowTexture(atlas);
    for(const name of ['近景大片雪','中景密雪','远景雪幕']) {
      const uniforms=scene.getObjectByName(name).material.uniforms;
      assert.equal(uniforms.uTexture.value,atlas);assert.equal(uniforms.uSnowAtlas.value,1);
    }
    atmosphere.dispose();atmosphere.dispose();assert.equal(released,1);
  });
});

test('暴风雪阵风间歇恢复岛屿轮廓，白茫只在强阵风出现', () => {
  withAtmosphere(({atmosphere,scene,camera})=>{
    const env=getEnvironment(createSimulation({weather:'blizzard',hour:14}));
    atmosphere.update(0,{...env,gust:.55},camera);const calm=scene.fog.density;
    assert.ok(calm<.0023,'持续强风不能让雪幕一直白茫');
    atmosphere.update(.1,{...env,gust:1},camera);
    assert.ok(scene.fog.density>calm*1.7,'强阵风应产生短暂雪幕');
  });
});

test('雨、雾、雷暴切换保留全岛远景细节，海上远处仍有雾气', () => {
  withAtmosphere(({ scene, update }) => {
    update('sunny');
    for (const weather of ['rain', 'fog', 'storm', 'rain']) {
      for (let i = 0; i < 160; i++) {
        update(weather);
        assert.ok(coverage(scene.fog, 480) <= .65, `${weather}不能让全岛超过65%的色彩变成雾色`);
      }
      assert.ok(coverage(scene.fog, 100) < .05, '近景也保留清晰纹理');
      if (weather === 'fog') assert.ok(coverage(scene.fog, 1200) > .95, '保留远海浓雾氛围');
    }
  });
});

test('雷暴雾色随阴暗天空变暗，不把岛屿远景染成晴天亮白色', () => {
  withAtmosphere(({ scene, update }) => {
    update('sunny');const clear = luminance(scene.fog.color);
    for (let i = 0; i < 160; i++) update('storm');
    assert.ok(luminance(scene.fog.color) < clear * .75);
    for (let i = 0; i < 160; i++) update('sunny');
    assert.ok(Math.abs(luminance(scene.fog.color) - clear) < .001, '放晴后恢复原晴天雾色');
  });
});

test('台风雨雾呈暗蓝灰色，远景保留岛屿对比并在退出台风后恢复', () => {
  withAtmosphere(({scene,update})=>{
    update('sunny');const clearColor=scene.fog.color.clone(),clearDensity=scene.fog.density;
    for(let i=0;i<400;i++)update('typhoon');
    assert.ok(luminance(scene.fog.color)<.12,'低压乌云下不能继续使用明亮的晴天雾色');
    assert.ok(scene.fog.color.b>scene.fog.color.r,'雨雾应保留天空的冷色');
    assert.ok(coverage(scene.fog,480)<.35,'全岛视角不能由雾色主导');
    assert.ok(coverage(scene.fog,700)<.55,'拉远后也应保留至少一半地形对比');
    assert.ok(coverage(scene.fog,1800)>.95,'远海仍然被雨雾遮蔽');
    for(let i=0;i<240;i++)update('sunny');
    for(const channel of ['r','g','b'])assert.ok(Math.abs(scene.fog.color[channel]-clearColor[channel])<.001);
    assert.ok(Math.abs(scene.fog.density-clearDensity)<1e-5);
  });
});

test('台风把乌云压低、加密横向雨幕，同时保留近岸能见度，放晴后雨幕恢复', () => {
  let storm;
  const sample = (atmosphere, scene) => {
    const rain = atmosphere.group.children.find(object => object.isPoints && object.material.uniforms?.uSnow?.value === 0);
    const cloud = atmosphere.group.children.find(object => object.isSprite && object.userData.origin);
    return { rain, cloud, wind: rain.material.uniforms.uWind.value.length(),
      density: rain.geometry.drawRange.count, height: cloud.position.y, color: luminance(cloud.material.color) };
  };
  withAtmosphere(({ atmosphere, scene, update }) => {
    update('storm'); storm = sample(atmosphere, scene);
  });
  withAtmosphere(({ atmosphere, scene, update }) => {
    update('typhoon'); const typhoon = sample(atmosphere, scene);
    assert.ok(typhoon.wind > storm.wind * 2.5, '强风必须推动雨滴形成斜向暴雨');
    assert.ok(Math.abs(typhoon.rain.material.uniforms.uRainAngle.value) > .04, '雨滴纹理应在屏幕上随风倾斜');
    assert.ok(typhoon.density > storm.density * 1.4, '台风雨幕要更密集');
    assert.ok(typhoon.height < storm.height * .8, '乌云应压低到海岛上方');
    assert.ok(typhoon.color < storm.color * .75, '台风乌云应比雷暴更沉重');
    assert.ok(coverage(scene.fog, 480) <= .65);
    for (let i = 0; i < 160; i++) update('sunny');
    assert.equal(typhoon.rain.visible, false);
    assert.equal(typhoon.rain.geometry.drawRange.count, 2600);
    assert.ok(Math.abs(typhoon.rain.material.uniforms.uRainAngle.value) < .001);
  });
});

test('切换台风只改变雨滴后续速度，不按累计时长把整片雨幕瞬移', () => {
  withAtmosphere(({ atmosphere, update }) => {
    for (let i = 0; i < 1000; i++) update('storm');
    const rain = atmosphere.group.children.find(object => object.isPoints && object.material.uniforms?.uSnow?.value === 0);
    const before = rain.material.uniforms.uDrift.value.clone();
    update('typhoon');
    const after = rain.material.uniforms.uDrift.value;
    const wrapped = value => Math.atan2(Math.sin(value * Math.PI / 120), Math.cos(value * Math.PI / 120)) * 120 / Math.PI;
    assert.ok(Math.hypot(wrapped(after.x - before.x), wrapped(after.y - before.y)) < 7,
      '一次50ms更新的横移必须服从风速上限');
  });
});

test('台风云幕随时间堆厚压低，连续遮蔽晴空间隙，放晴后消退', () => {
  withAtmosphere(({atmosphere,update})=>{
    update('sunny');
    const sky=atmosphere.group.children.find(object=>object.isMesh&&object.material.uniforms?.uTyphoonCloudBuild);
    assert.ok(sky,'台风需要连续的厚云底幕，不能只有分散云团');
    const cloud=atmosphere.group.children.find(object=>object.isSprite&&object.userData.origin);
    for(let i=0;i<20;i++)update('typhoon');
    const early=sky.material.uniforms.uTyphoonCloudBuild.value,earlyHeight=cloud.position.y,earlyWidth=cloud.scale.x;
    for(let i=0;i<380;i++)update('typhoon');
    assert.ok(sky.material.uniforms.uTyphoonCloudBuild.value>early+.6,'云幕应逐渐积压，不能切天气时一次性盖满');
    assert.ok(cloud.position.y<earlyHeight*.85,'厚云底继续压低');
    assert.ok(cloud.scale.x>earlyWidth*1.3,'相邻云团逐渐叠合');
    assert.ok(sky.material.uniforms.uTyphoonCloudDrift.value.length()>1,'底幕随强风推进');
    for(let i=0;i<320;i++)update('sunny');
    assert.ok(sky.material.uniforms.uTyphoonCloudStrength.value<.001);
    assert.ok(sky.material.uniforms.uTyphoonCloudBuild.value<.03);
  });
});
