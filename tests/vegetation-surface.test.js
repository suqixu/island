import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const surface = await import('../src/vegetation-surface.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const api = () => { assert.ok(surface?.sampleVegetationSurface && surface?.attachVegetationSurface,
  '树皮和叶面需要独立且可复用的自然层次材质'); return surface; };

test('树皮纵裂沿树干延伸，横向细节更丰富且没有固定UV平铺', () => {
  const m = api(); let vertical = 0, horizontal = 0, low = Infinity, high = -Infinity;
  for (let i = 0; i < 160; i++) {
    const p = [i * .019 + .07, i * .035 + 2.1, .28];
    const a = m.sampleVegetationSurface('bark', p), up = m.sampleVegetationSurface('bark', [p[0], p[1] + .03, p[2]]);
    const side = m.sampleVegetationSurface('bark', [p[0] + .03, p[1], p[2]]);
    vertical += Math.abs(a.shade - up.shade); horizontal += Math.abs(a.shade - side.shade);
    low = Math.min(low, a.shade); high = Math.max(high, a.shade);
    assert.ok(a.relief >= -.03 && a.relief <= .03);
    assert.ok(a.tint.every(v => Number.isFinite(v) && v >= .5 && v <= 1.2));
  }
  assert.ok(horizontal > vertical * 2, `${horizontal} vs ${vertical}`);
  assert.ok(high - low > .20, `树皮颜色跨度 ${high - low}`);
  assert.notDeepEqual(m.sampleVegetationSurface('bark', [1, 2, 3]), m.sampleVegetationSurface('bark', [5, 2, 3]));
});

test('叶面有连续色块与细叶脉，绿色仍保留季节底色且幅度有界', () => {
  const m = api(); let min = Infinity, max = -Infinity, veins = 0;
  for (let i = 0; i < 250; i++) {
    const p = [i * .025, 7.1 + i * .002, 2.7];
    const a = m.sampleVegetationSurface('leaf', p), b = m.sampleVegetationSurface('leaf', [p[0] + .0001, p[1], p[2]]);
    min = Math.min(min, a.shade); max = Math.max(max, a.shade); veins += a.vein > .3 ? 1 : 0;
    assert.ok(a.tint.every(v => v >= .7 && v <= 1.2));
    assert.ok(Math.abs(a.shade - b.shade) < .004);
    assert.ok(Math.abs(a.relief) < .005);
  }
  assert.ok(max - min > .10 && veins > 2);
  for (const p of [[NaN, Infinity, -Infinity], null, [0, 0, 0]]) {
    assert.ok(m.sampleVegetationSurface('leaf', p).tint.every(Number.isFinite));
  }
});

test('材质接线保留已有运动/积雪hook，幂等且不创建纹理或帧更新资源', () => {
  const m = api(), material = new THREE.MeshStandardMaterial({ color: 0x708444, vertexColors: true });
  const shared = { value: 2 };
  let calls = 0;
  material.onBeforeCompile = shader => { calls++; shader.uniforms.uSnow = shared;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += 0.1;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uSnow);'); };
  material.customProgramCacheKey = () => 'existing-season-motion';
  const previousKey = material.customProgramCacheKey();
  assert.equal(m.attachVegetationSurface(material, { kind: 'leaf' }), material);
  const hook = material.onBeforeCompile, key = material.customProgramCacheKey();
  m.attachVegetationSurface(material, { kind: 'leaf' });
  assert.equal(material.onBeforeCompile, hook);
  assert.ok(key.startsWith(previousKey));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(calls, 1); assert.equal(shader.uniforms.uSnow, shared);
  assert.ok(shader.vertexShader.includes('transformed.x += 0.1;'));
  const snow = shader.fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uSnow);');
  const detail = shader.fragmentShader.indexOf('diffuseColor.rgb *= vegetationSurfaceTint;');
  assert.ok(detail >= 0 && detail < snow, '先渲染叶面，再积雪覆盖');
  assert.equal(material.map, null); assert.equal(material.bumpMap, null);
  assert.equal(Object.keys(shader.uniforms).length, 1);
  material.dispose();
});
