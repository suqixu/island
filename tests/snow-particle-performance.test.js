import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createAtmosphere } from '../src/atmosphere.js';
import { loadSnowFlakes } from '../src/snow-texture.js';
import { createSimulation, getEnvironment } from '../src/simulation.js';

function withAtmosphere(run) {
  const keys = ['document', 'innerWidth', 'innerHeight'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const context = new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) }, innerWidth: 390, innerHeight: 844 });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(54, 390 / 844, .5, 65000);
  camera.position.set(237, 101, 296); camera.lookAt(0, 15, 0); camera.updateMatrixWorld();
  const atmosphere = createAtmosphere(scene, { moonMap: new THREE.Texture(), cloudMaps: [new THREE.Texture()] });
  const layers = ['近景大片雪', '中景密雪', '远景雪幕'].map(name => scene.getObjectByName(name));
  try { run({ atmosphere, camera, layers }); }
  finally {
    atmosphere.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

function evaluateScalar(shader, name, inputs) {
  const expression = shader.match(new RegExp(`float\\s+${name}\\s*=\\s*([^;]+);`))?.[1];
  assert.ok(expression, `缺少实际着色器表达式 ${name}`);
  const scope = { ...inputs, mix: (a, b, t) => a * (1 - t) + b * t };
  return Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
}

test('雪花仅加载离线512四宫格，保留mipmap、透明通道和单次释放', async () => {
  const original = THREE.TextureLoader.prototype.loadAsync;
  const map = new THREE.Texture(); let requested, released = 0;
  map.addEventListener('dispose', () => released++);
  THREE.TextureLoader.prototype.loadAsync = async url => { requested = url; return map; };
  try {
    assert.equal(await loadSnowFlakes(), map);
    assert.ok(requested.endsWith('/snowflake-atlas-runtime-512-v1.webp'), '运行时必须引用预缩小的派生图');
    assert.equal(map.generateMipmaps, true);
    assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(map.colorSpace, THREE.NoColorSpace);
    withAtmosphere(({ atmosphere, layers }) => {
      atmosphere.setSnowTexture(map);
      assert.ok(layers.every(layer => layer.material.uniforms.uTexture.value === map));
      atmosphere.dispose(); atmosphere.dispose();
      assert.equal(released, 1);
    });
  } finally { THREE.TextureLoader.prototype.loadAsync = original; }
});

test('离线派生图保留512尺寸、透明度及可核对的原图来源', async () => {
  const metadata = JSON.parse(await readFile(new URL('../prompts/textures/snowflake-atlas-runtime-v1.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL(`../${metadata.source.path}`, import.meta.url));
  const derived = await readFile(new URL(`../${metadata.derived.path}`, import.meta.url));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(source), metadata.source.sha256, '源图不得被缩放流程覆盖');
  assert.equal(hash(derived), metadata.derived.sha256);
  assert.equal(derived.length, metadata.derived.bytes);
  assert.ok(derived.length < source.length);
  assert.equal(derived.toString('ascii', 0, 4), 'RIFF');
  assert.equal(derived.toString('ascii', 8, 12), 'WEBP');
  const lossless = derived.indexOf(Buffer.from('VP8L'));
  assert.ok(lossless >= 12, '派生图必须使用无损WebP编码');
  assert.equal(derived[lossless + 8], 0x2f);
  const dimensions = derived.readUInt32LE(lossless + 9);
  assert.equal((dimensions & 0x3fff) + 1, 512);
  assert.equal(((dimensions >>> 14) & 0x3fff) + 1, 512);
  assert.equal((dimensions >>> 28) & 1, 1, '保留原透明通道');
});

test('雨雪旋转只在顶点求三角函数，雨丝倾角、雪晶相位和四宫格UV保持原含义', () => {
  withAtmosphere(({ atmosphere, layers }) => {
    const rain = atmosphere.group.children.find(object => object.isPoints && object.material.uniforms?.uSnow?.value === 0);
    for (const points of [rain, ...layers]) {
      const { vertexShader, fragmentShader } = points.material;
      assert.match(vertexShader, /uniform float uRainAngle\s*;/);
      assert.match(vertexShader, /varying vec2 vParticleRotation\s*;/);
      assert.match(fragmentShader, /varying vec2 vParticleRotation\s*;/);
      assert.ok(!/\b(?:sin|cos)\s*\(/.test(fragmentShader), '不能再逐片元计算同一粒子的旋转角');
      for (const uSnow of [0, 1]) for (const aPhase of [0, .7, Math.PI, 6.1]) for (const uRotation of [0, 1.2, 6]) {
        const inputs = { uRainAngle: -.3, aPhase, uRotation, uSnow };
        assert.equal(evaluateScalar(vertexShader, 'particleAngle', inputs), uSnow ? aPhase + uRotation : -.3);
      }
      assert.ok(vertexShader.includes('vSnowCell=vec2(mod(snowCell,2.0),floor(snowCell/2.0))'));
      assert.ok(fragmentShader.includes('(rainUv+vSnowCell)*.5'));
    }
  });
});

test('采样前只按整点透明度丢弃，UV边界保留一致采样以确保mipmap导数有效', () => {
  withAtmosphere(({ layers }) => {
    const shader = layers[0].material.fragmentShader, sample = shader.indexOf('texture2D(');
    const guards = [...shader.slice(0, sample).matchAll(/if\s*\((.*?)\)\s*discard\s*;/gs)].map(match => match[1]);
    assert.equal(guards.length, 1, '隐式LOD采样前只允许point内常量控制的透明度丢弃');
    assert.ok(!/rainUv|gl_PointCoord/.test(guards[0]), '不能在非一致UV控制流后计算隐式mipmap导数');
    const discard = inputs => guards.some(expression => {
      const values = { ...inputs };
      return Function(...Object.keys(values), `return (${expression});`)(...Object.values(values));
    });
    for (const uStrength of [0, .01, .012, .2, .78, 1]) for (const vOpacity of [0, .01, .3, 1]) {
      for (const rainUv of [[.5, .5], [0, 0], [1, 1], [-.00001, .5], [.5, 1.00001]]) {
        const inside = Number(rainUv.every(value => value >= 0 && value <= 1));
        const inputs = { uStrength, vOpacity, rainUv };
        assert.equal(discard(inputs), uStrength * vOpacity < .012);
        const actualInside = evaluateScalar(shader, 'inside', {
          rainUv: { x: rainUv[0], y: rainUv[1] }, step: (edge, value) => Number(value >= edge),
        });
        assert.equal(actualInside, inside, 'UV边界继续使用原来包含0与1的step遮罩');
        for (const alpha of [0, .01, .2, 1]) {
          const previous = alpha * inside * uStrength * vOpacity;
          if (discard(inputs)) assert.ok(previous < .012, '不能提前丢弃原来可见的雪花细节');
          else assert.equal(evaluateScalar(shader, 'alpha', { particleTexel: { a: alpha }, inside: actualInside, uStrength, vOpacity }), previous);
        }
      }
    }
  });
});

test('三层雪的数量、尺寸和GPU运动缓冲不变，动画及重复时刻不重传几何或纹理', () => {
  withAtmosphere(({ atmosphere, camera, layers }) => {
    assert.deepEqual(layers.map(layer => layer.geometry.attributes.position.count), [900, 2600, 2200]);
    assert.deepEqual(layers.map(layer => layer.material.uniforms.uSize.value), [7.6, 5.2, 3.3]);
    const versions = layers.map(layer => Object.values(layer.geometry.attributes).map(attribute => attribute.version));
    const snapshots = layers.map(layer => layer.geometry.attributes.position.array.slice());
    const snow = getEnvironment(createSimulation({ weather: 'snow', windSeed: 42 }));
    for (const time of [3600, 3600.05, 3600.1]) atmosphere.update(time, snow, camera);
    const rotation = layers.map(layer => layer.material.uniforms.uRotation.value);
    atmosphere.update(3600.1, snow, camera);
    layers.forEach((layer, i) => {
      assert.deepEqual(Object.values(layer.geometry.attributes).map(attribute => attribute.version), versions[i]);
      assert.deepEqual(layer.geometry.attributes.position.array, snapshots[i]);
      assert.equal(layer.material.uniforms.uRotation.value, rotation[i]);
      assert.ok(layer.material.vertexShader.includes('1.0, 34.0'), '雪花大小上限保持34像素');
    });
  });
});
