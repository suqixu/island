import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createForestCanopy } from '../src/forest-canopy.js';
import { attachSnowSurface } from '../src/snow-surface.js';

const winter = await import('../src/winter-foliage.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

test('冬态标记按整片叶子保持一致，稳定分布且不改变树冠生成随机流', () => {
  const first = createForestCanopy(1922), again = createForestCanopy(1922);
  try {
    const marks = first.leaves.attributes.aWinterLeaf;
    assert.ok(marks, '阔叶需要整片共享的冬态标记');
    assert.equal(marks.count, first.leaves.attributes.position.count);
    assert.deepEqual(marks.array, again.leaves.attributes.aWinterLeaf.array);
    const leaves = [];
    for (let start = 0; start < marks.count; start += 8) {
      const value = marks.getX(start);
      assert.ok(value >= 0 && value < 1);
      for (let vertex = start; vertex < start + 8; vertex++) assert.equal(marks.getX(vertex), value);
      leaves.push(value);
    }
    const retained = leaves.filter(value => value < .12).length / leaves.length;
    assert.ok(retained > .07 && retained < .17, `严冬只保留少量完整枯叶，实际 ${retained}`);
    for (let bucket = 0; bucket < 10; bucket++) {
      assert.ok(leaves.filter(value => Math.floor(value * 10) === bucket).length > 15, '脱叶顺序应分散在整株树冠');
    }
    assert.deepEqual(first.leaves.attributes.position.array, again.leaves.attributes.position.array);
  } finally {
    for (const model of [first, again]) { model.leaves.dispose(); model.branches.dispose(); }
  }
});


function compile(material, kind = 'standard') {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[kind].vertexShader,
    fragmentShader: THREE.ShaderLib[kind].fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('冬态保持原材质回调与共享 uniform，雪色在枯叶色之后覆盖', () => {
  assert.equal(typeof winter?.attachWinterFoliage, 'function');
  const uniform = { value: .7 }, material = new THREE.MeshStandardMaterial();
  let calls = 0;
  material.onBeforeCompile = () => { calls++; };
  material.customProgramCacheKey = () => 'existing-wind-leaf';
  winter.attachWinterFoliage(material, uniform, { sparse: true });
  winter.attachWinterFoliage(material, uniform, { sparse: true });
  attachSnowSurface(material, { value: .7 });
  const shader = compile(material);
  assert.equal(calls, 1);
  assert.equal(shader.uniforms.uFoliageWinter, uniform);
  assert.match(material.customProgramCacheKey(), /existing-wind-leaf.*winter-foliage.*snow-surface/);
  assert.match(shader.vertexShader, /attribute float aWinterLeaf/);
  assert.match(shader.fragmentShader, /vWinterLeaf.*discard/);
  assert.ok(shader.fragmentShader.indexOf('vec3 winterDryColor') < shader.fragmentShader.indexOf('vec3 snowColor'),
    '积雪应覆盖冬态褐色，不被染成枯黄色');
  material.dispose();
});

test('树冠深度材质使用相同落叶阈值，普通椰叶只褪绿而不剔除', () => {
  assert.equal(typeof winter?.attachWinterFoliage, 'function');
  const uniform = { value: 1 }, leaf = new THREE.MeshStandardMaterial(), depth = new THREE.MeshDepthMaterial();
  winter.attachWinterFoliage(leaf, uniform, { sparse: true });
  winter.attachWinterFoliage(depth, uniform, { sparse: true, depth: true });
  const visibleShader = compile(leaf), depthShader = compile(depth, 'depth');
  const expression = /if \(vWinterLeaf[^\n]+discard;/;
  assert.equal(depthShader.fragmentShader.match(expression)?.[0], visibleShader.fragmentShader.match(expression)?.[0]);
  assert.ok(depthShader.fragmentShader.match(expression), '落叶必须同时消除阴影');
  assert.equal(depthShader.uniforms.uFoliageWinter, uniform);
  assert.doesNotMatch(depthShader.fragmentShader, /winterDryColor/);
  const palm = new THREE.MeshStandardMaterial();
  winter.attachWinterFoliage(palm, uniform);
  const palmShader = compile(palm);
  assert.doesNotMatch(palmShader.vertexShader, /aWinterLeaf/);
  assert.doesNotMatch(palmShader.fragmentShader, /discard;/);
  assert.match(palmShader.fragmentShader, /winterDryColor/);
  for (const material of [leaf, depth, palm]) material.dispose();
});
