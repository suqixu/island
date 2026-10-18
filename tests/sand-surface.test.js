import test from 'node:test';
import assert from 'node:assert/strict';
import { getSandRelief } from '../src/sand-surface.js';

const samples = options => Array.from({ length: 441 }, (_, i) =>
  getSandRelief((i % 21) * .17, Math.floor(i / 21) * .19, options));
const span = values => Math.max(...values) - Math.min(...values);

test('细沙保留厘米级柔软起伏和毫米微纹理，表面坡度没有尖锐碎石感', () => {
  const heights = samples({ grain: .5 });
  assert.ok(span(heights) > .035 && span(heights) < .09, '细沙要有可见但低矮的堆积起伏');
  let localVariation = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * .13, z = Math.floor(i / 20) * .17;
    localVariation += (getSandRelief(x + .3, z) - getSandRelief(x, z)) ** 2;
  }
  assert.ok(Math.sqrt(localVariation / 400) > .012, '三十厘米尺度也应有软沙堆变化，不能只有远处的大色块');
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * .13, z = Math.floor(i / 20) * .17, step = .0001;
    const dx = (getSandRelief(x + step, z) - getSandRelief(x - step, z)) / (step * 2);
    const dz = (getSandRelief(x, z + step) - getSandRelief(x, z - step)) / (step * 2);
    assert.ok(Math.hypot(dx, dz) < .3, '低沙纹必须柔和，不能产生尖锐凹坑');
    const grainHeight = getSandRelief(x, z, { grain: .9 }) - getSandRelief(x, z, { grain: .1 });
    assert.ok(grainHeight > .0005 && grainHeight < .002, '细颗粒的微法线保持毫米级');
  }
});

test('湿沙起伏显著压平，远看细纹按像素覆盖连续消退', () => {
  const dry = span(samples({ wetness: 0 })), wet = span(samples({ wetness: 1 }));
  assert.ok(wet < dry * .45, '水线附近湿沙应比干沙平滑');
  assert.ok(span(samples({ footprint: .5 })) < dry * .8, '看不清的小纹理不能继续产生亮暗噪声');
  assert.ok(samples({ footprint: 8, grain: .9 }).every(value => value === 0));
  let previous = getSandRelief(1.7, 2.9);
  for (let footprint = .005; footprint < 8; footprint += .005) {
    const value = getSandRelief(1.7, 2.9, { footprint });
    assert.ok(Math.abs(value - previous) < .002, '层级淡出必须连续，不能随缩放突然跳变');
    previous = value;
  }
});

test('小沙纹有不规则相位，平移一个近似沙纹间距后不会原样重复', () => {
  const first = samples({}), second = Array.from({ length: 441 }, (_, i) =>
    getSandRelief((i % 21) * .17 + .43, Math.floor(i / 21) * .19));
  const difference = Math.sqrt(first.reduce((sum, value, i) => sum + (value - second[i]) ** 2, 0) / first.length);
  assert.ok(difference > .003, '不能形成一排排等距平行刻线');
});
