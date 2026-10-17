import test from 'node:test';
import assert from 'node:assert/strict';
import { createBloomPass } from '../src/bloom.js';

test('Bloom 全屏滤镜不分配深度附件，缩放后仍可释放全部颜色目标', () => {
  const bloom = createBloomPass(800, 600);
  const targets = [bloom.renderTargetBright,
    ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical];
  const released = new Set();
  for (const target of targets) target.addEventListener('dispose', () => released.add(target));
  try {
    assert.equal(targets.length, 11);
    for (const target of targets) assert.equal(target.depthBuffer, false,
      `${target.texture.name} 仅过滤颜色，不需要深度缓冲`);
    bloom.setSize(1600, 900);
    assert.deepEqual([bloom.renderTargetBright.width, bloom.renderTargetBright.height], [800, 450]);
    for (const target of targets) assert.equal(target.depthBuffer, false,
      '调整渲染尺寸不能重新引入深度附件');
  } finally {
    released.clear();
    bloom.dispose();
    // The caller already owns this upstream material's separate cleanup.
    bloom.materialHighPassFilter.dispose();
    assert.equal(released.size, targets.length, '所有颜色目标仍由 Bloom 的 dispose 释放');
  }
});
