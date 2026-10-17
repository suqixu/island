import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAtmosphere } from '../src/atmosphere.js';

test('天空海雾消费共享夜色，保留白天晚霞与月盘资源，并按真实时间推进', async t => {
  const previous = { document: globalThis.document, width: globalThis.innerWidth, height: globalThis.innerHeight };
  const context = new Proxy({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.innerWidth = 634; globalThis.innerHeight = 768;
  const scene = new THREE.Scene();
  const moonMap = new THREE.Texture();
  const atmosphere = createAtmosphere(scene, { moonMap });
  const camera = new THREE.PerspectiveCamera(54, 634 / 768, .5, 65000);
  camera.position.set(150, 24, 200); camera.lookAt(0, 65, 0); camera.updateMatrixWorld();
  const sky = atmosphere.group.children.find(object => object.isMesh && object.material.uniforms?.uHorizon);
  const moon = atmosphere.group.children.find(object => object.material?.uniforms?.uLightDirection);
  const environment = {
    hour: 22, weather: 'sunny', daylight: 0, cloudiness: .16, rain: 0, snow: 0, fog: 0, storm: 0,
    moonLight: .85, moonPhase: .5, moonIllumination: 1, moonVisibility: 1,
    sunDirection: new THREE.Vector3(-.8, -.6, -.3).normalize(),
    moonDirection: new THREE.Vector3(.5, .4, .7).normalize(), skyCloudCover: .25,
  };
  try {
    await t.test('夜间读取同一个共享色，不再另算不同的交界调色板', () => {
      const seaHorizon = Object.freeze({ night: 1, color: Object.freeze([.04, .075, .12]), weather: .2, cloudCover: .25 });
      atmosphere.update(3, Object.freeze({ ...environment, seaHorizon }), camera);
      const u = sky.material.uniforms;
      assert.ok(u.uSeaHorizonNight, '天空缺少共享海雾接线');
      assert.equal(u.uSeaHorizonNight.value, 1);
      assert.deepEqual(u.uSeaHorizonColor.value.toArray(), [.04, .075, .12]);
      assert.equal(u.uSeaHorizonWeather.value, .2);
      assert.equal(u.uSeaHorizonCloudCover.value, .25);
      assert.equal(u.uSeaHorizonTime.value, 3);
      assert.equal(sky.material.fog, false);
      assert.ok(moon.visible && moon.material.uniforms.uOpacity.value > .8);
    });
    await t.test('独立大气实例在新月也融合海天，白天和夕阳则关闭夜雾', () => {
      atmosphere.update(4, { ...environment, moonPhase: 0, moonIllumination: 0, moonLight: 0 }, camera);
      assert.equal(sky.material.uniforms.uSeaHorizonNight.value, 1);
      assert.equal(moon.visible, false);
      for (const [hour, daylight, sunHeight] of [[12, 1, 1], [17.8, .34, .052], [18.05, .21, -.013]]) {
        atmosphere.update(5, { ...environment, hour, daylight,
          sunDirection: new THREE.Vector3(Math.sqrt(1 - sunHeight * sunHeight), sunHeight, 0) }, camera);
        assert.equal(sky.material.uniforms.uSeaHorizonNight.value, 0, `${hour}点不可抹去日景或晚霞`);
      }
    });
    await t.test('暂停与天气变化只更新 uniform，不重建月盘、云纹理或天空', () => {
      const material = sky.material, geometry = sky.geometry;
      const color = material.uniforms.uSeaHorizonColor.value;
      const cloudMaps = atmosphere.group.children.filter(object => object.isSprite).map(object => object.material.map);
      const moonShader = moon.material.fragmentShader, moonSize = moon.scale.x;
      for (const time of [6, 16, 26]) atmosphere.update(time,
        { ...environment, running: false, speed: 8,
          seaHorizon: { night: 1, color: [.035, .06, .09], weather: .6, cloudCover: .8 } }, camera);
      assert.equal(material.uniforms.uSeaHorizonTime.value, 26);
      assert.equal(material.uniforms.uSeaHorizonColor.value, color);
      assert.equal(sky.geometry, geometry); assert.equal(sky.material, material);
      assert.deepEqual(atmosphere.group.children.filter(object => object.isSprite).map(object => object.material.map), cloudMaps);
      assert.equal(moon.material.fragmentShader, moonShader); assert.equal(moon.scale.x, moonSize);
      assert.ok(material.uniforms.uSeaHorizonColor.value.toArray().every(Number.isFinite));
    });
  } finally {
    atmosphere.dispose();
    globalThis.document = previous.document; globalThis.innerWidth = previous.width; globalThis.innerHeight = previous.height;
  }
  assert.equal(scene.children.length, 0);
});
