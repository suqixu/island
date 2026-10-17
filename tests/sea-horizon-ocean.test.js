import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';

test('16倍速海浪在30帧画面中推进完整相位，普通倍率仍沿用原动画速度', () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    const env = { windSpeed: 6, wind: .2, animationRate: 16 };
    ocean.update(0, env);
    for (let frame = 1; frame <= 30; frame++) ocean.update(frame * 16 / 30, env);
    const uniforms = ocean.mesh.material.uniforms;
    assert.ok(Math.abs(uniforms.uWaveTime.value - 14.88) < 1e-8);
    ocean.update(16 + 1 / 30, { ...env, animationRate: 1 });
    assert.ok(Math.abs(uniforms.uWaveTime.value - 14.911) < 1e-8);
  } finally { ocean.dispose(); }
});

test('海面真实材质读取夜间共享海天色、视觉云量与真实时间', () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    ocean.update(7, { daylight: 0, moonLight: 1, cloudiness: 0, storm: 0, fog: 0,
      rain: 0, snow: 0, skyCloudCover: .81 });
    const uniforms = ocean.mesh.material.uniforms;
    assert.ok(uniforms.uSeaHorizonNight, '共享夜间参数必须进入实际海面材质');
    assert.equal(uniforms.uSeaHorizonNight.value, 1);
    assert.equal(uniforms.uSeaHorizonTime.value, 7);
    assert.equal(uniforms.uSeaHorizonCloudCover.value, .81);
    assert.equal(uniforms.uSeaHorizonWeather.value, 0);
    const actual = uniforms.uSeaHorizonColor.value.toArray();
    // 独立按天空满月晴夜的 below/horizon 线性 RGB、y=0 的 .544066 混色计算。
    const expected = [.03016667, .06416008, .10786940];
    actual.forEach((component, index) => assert.ok(Math.abs(component - expected[index]) < 2e-6,
      '雾化终点使用天空真正低空色，不能再用海面更亮的蓝色目标'));
    assert.equal(uniforms.uCloudiness.value, 0, '视觉云量不能改变天气');
    assert.equal(uniforms.uWaterClarity.value, .18, '夜间近水原透明度不变');
    assert.equal(ocean.mesh.material.depthWrite, true);
  } finally { ocean.dispose(); }
});

test('海面优先使用同帧共享状态，暴雨夜色不再重复缩暗', () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    ocean.update(2, { daylight: 0, cloudiness: 1, fog: 1, storm: 1, skyCloudCover: 1,
      seaHorizon: { night: 1, color: [.0116, .0232, .0464], weather: .7, cloudCover: .2 } });
    const uniforms = ocean.mesh.material.uniforms;
    assert.ok(uniforms.uSeaHorizonColor, '共享色必须进入实际海面材质');
    assert.deepEqual(uniforms.uSeaHorizonColor.value.toArray(), [.0116, .0232, .0464]);
    assert.equal(uniforms.uSeaHorizonWeather.value, .7);
    assert.equal(uniforms.uSeaHorizonCloudCover.value, .2);
    assert.equal(uniforms.uStorm.value, 1, '共享雾色不改原天气控制');
    assert.equal(uniforms.uSkyCloudCover.value, 1, '共享雾色不改海面原云反射幅度');
  } finally { ocean.dispose(); }
});

test('无新增字段的白日旧调用仍保持晴天水色与日照', () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    ocean.update(3, {});
    const uniforms = ocean.mesh.material.uniforms;
    assert.ok(uniforms.uSeaHorizonNight, '旧调用通过helper默认关闭夜间融合');
    assert.equal(uniforms.uSeaHorizonNight.value, 0);
    assert.equal(uniforms.uDaylight.value, 1);
    assert.equal(uniforms.uShallowColor.value.getHexString(), '29b8ad');
    assert.equal(uniforms.uDeepColor.value.getHexString(), '075777');
    assert.equal(uniforms.uSunVisibility.value, 1);
    assert.equal(uniforms.uWaterClarity.value, 1);
    assert.ok(uniforms.uSeaHorizonColor.value.toArray().every(Number.isFinite));
  } finally { ocean.dispose(); }
});
