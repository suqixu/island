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
  const atmosphere = createAtmosphere(scene, { moonMap });
  let time = 0;
  const update = weather => atmosphere.update(time += .05, getEnvironment(createSimulation({ hour: 12, weather, windSeed: 1 })), camera);
  try { run({ atmosphere, scene, update }); }
  finally {
    atmosphere.dispose();moonMap.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);else delete globalThis[key];
    }
  }
}

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
