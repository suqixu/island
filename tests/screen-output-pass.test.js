import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createBloomPass } from '../src/bloom.js';

const module = await import('../src/screen-output-pass.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

test('末端屏幕输出跨帧、缩放和Bloom开关始终复用一个场景目标', () => {
  assert.ok(module?.createScreenOutputPass, '末端输出不应轮换并分配闲置的HDR场景目标');
  const bound = new Set(), draws = [];
  let target = null;
  // Record the real passes' renderer boundary, without allocating a GL context.
  const renderer = {
    getPixelRatio: () => 1.7,
    getSize: vector => vector.set(800, 600),
    getRenderTarget: () => target,
    setRenderTarget(value) { target = value; if (value) bound.add(value); },
    getClearColor: color => color.set(0), getClearAlpha: () => 1,
    setClearColor() {}, clear() {},
    render(object) { draws.push({ target, object }); },
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.04,
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const composer = new EffectComposer(renderer), bloom = createBloomPass(800, 600);
  const output = module.createScreenOutputPass();
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(output);
  const sceneTarget = composer.readBuffer, unusedTarget = composer.writeBuffer;
  try {
    for (const enabled of [true, false, true]) {
      bloom.enabled = enabled;
      composer.setSize(enabled ? 1000 : 800, 600);
      for (let frame = 0; frame < 3; frame++) {
        draws.length = 0;
        composer.render(.016);
        assert.equal(draws[0].object, scene);
        assert.equal(draws[0].target, sceneTarget);
        assert.equal(draws.at(-1).target, null, '最后一步始终输出到屏幕');
        assert.equal(output.uniforms.tDiffuse.value, sceneTarget.texture, '输出必须采样当前场景而非闲置目标');
        assert.equal(composer.readBuffer, sceneTarget);
      }
    }
    assert.equal(bound.has(unusedTarget), false, '备用目标从不绑定，Three无需为其分配GL附件');
  } finally {
    composer.passes.forEach(pass => pass.dispose());
    bloom.materialHighPassFilter.dispose(); composer.dispose();
  }
});
