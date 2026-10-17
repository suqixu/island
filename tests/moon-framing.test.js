import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MOON_PHASES } from '../src/moon.js';
import { createSimulation, getEnvironment } from '../src/simulation.js';

const framing = await import('../src/moon-framing.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function api() {
  assert.ok(framing, '月亮背景构图模块应提供跟随镜头的世界方向');
  return framing.getMoonBackdropDirection;
}

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('月盘从海平线升起，午夜到达高处，黎明沿连续轨迹下降', () => {
  for (const [width, height] of [[634, 762], [1440, 900]]) {
    const camera = new THREE.PerspectiveCamera(54, width / height, .5, 65000);
    camera.position.set(160, 68, 200); camera.lookAt(0, 15, 0);
    const sample = hour => {
      const env = getEnvironment(createSimulation({ hour: hour % 24 }));
      const direction = framing.getMoonBackdropDirection(camera, width, env);
      const screen = camera.position.clone().addScaledVector(direction, 1900).project(camera);
      near(screen.x, width < 760 ? .38 : .24);
      return { direction, screen };
    };
    near(sample(18).direction.y, 0);
    near(sample(30).direction.y, 0);
    const heights = [18, 19, 21, 23, 24, 25, 27, 29, 30].map(hour => sample(hour).screen.y);
    for (let i = 1; i <= 4; i++) assert.ok(heights[i] > heights[i - 1]);
    for (let i = 5; i < heights.length; i++) assert.ok(heights[i] < heights[i - 1]);
    assert.ok(heights[4] - heights[0] > .15, '应有肉眼可见的升月弧度');
    near(sample(23.999).screen.y, sample(24.001).screen.y);
    assert.ok(sample(24).direction.y > 0);
    assert.ok(sample(31).direction.y < 0);
  }
});

test('同一月升时刻环绕旋转镜头不改变月亮的相对构图', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, .5, 65000);
  const env = getEnvironment(createSimulation({ hour: 21 }));
  let expected;
  for (let yaw = 0; yaw <= Math.PI * 2; yaw += Math.PI / 8) {
    camera.position.setFromSpherical(new THREE.Spherical(280, 1.35, yaw));
    camera.lookAt(0, 15, 0);
    const direction = framing.getMoonBackdropDirection(camera, 1440, env);
    const projected = camera.position.clone().addScaledVector(direction, 1900).project(camera);
    if (!expected) expected = projected;
    near(projected.x, expected.x); near(projected.y, expected.y);
    assert.ok(projected.x > -1 && projected.x < 1 && projected.y > -1 && projected.y < 1);
  }
});

function projectedMoon(camera, viewportWidth) {
  const getMoonBackdropDirection = api();
  const direction = getMoonBackdropDirection(camera, viewportWidth);
  assert.ok(direction.isVector3);
  near(direction.length(), 1);
  for (const value of direction.toArray()) assert.ok(Number.isFinite(value));
  const position = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 1900);
  camera.updateMatrixWorld();
  return position.project(camera);
}

function assertScreenPoint(projected, x, y, tolerance = 1e-9) {
  near(projected.x, x, tolerance);
  near(projected.y, y, tolerance);
  assert.ok(projected.x >= -1 && projected.x <= 1);
  assert.ok(projected.y >= -1 && projected.y <= 1);
  assert.ok(projected.z >= -1 && projected.z <= 1, '月亮应位于真实相机裁剪范围内');
}

test('初始海岛、海岸、码头、鸟瞰和赏月镜头都保留同一背景月亮位置', () => {
  const views = [
    { name: '初始海岛', position: [160, 68, 200], target: [0, 15, 0], fov: 46 },
    { name: '海岸', position: [96, 15, 111], target: [8, 5, 20], fov: 46 },
    { name: '码头', position: [40, 12, 128], target: [5, 5, 60], fov: 46 },
    { name: '鸟瞰', position: [90, 230, 115], target: [0, 0, 0], fov: 46 },
    { name: '赏月', position: [150, 24, 200], target: [0, 65, 0], fov: 66 },
  ];
  for (const view of views) {
    const camera = new THREE.PerspectiveCamera(view.fov, 1440 / 900, .5, 7000);
    camera.position.fromArray(view.position);
    camera.lookAt(...view.target);
    assertScreenPoint(projectedMoon(camera, 1440), .24, .52);
  }
});

test('完整环岛旋转、俯仰和镜头滚转不会让月亮走出画面', () => {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, .5, 7000);
  camera.position.set(160, 68, 200);
  for (const pitch of [-1.3, -.5, 0, .7, 1.3]) {
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
      for (const roll of [0, .45, -1.2]) {
        camera.rotation.set(pitch, yaw, roll);
        assertScreenPoint(projectedMoon(camera, 1440), .24, .52);
      }
    }
  }
});

test('赏月环绕的允许俯仰范围内，完整月盘始终高于海面并保持背景位置', () => {
  const limits = framing.MOON_VIEW_POLAR_LIMITS;
  assert.ok(limits, '赏月视角需要保留天空的俯仰范围，避免屏幕固定的月盘被海水遮住');
  for (const [width, height] of [[320, 568], [634, 762], [1440, 900], [1920, 720]]) {
    const camera = new THREE.PerspectiveCamera(66, width / height, .5, 65000);
    for (const polar of [limits.min, (limits.min + limits.max) / 2, limits.max]) {
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
        camera.position.setFromSpherical(new THREE.Spherical(250, polar, yaw)).add(new THREE.Vector3(0, 65, 0));
        camera.lookAt(0, 65, 0);
        const direction = framing.getMoonBackdropDirection(camera, width);
        const center = camera.position.clone().addScaledVector(direction, 1900);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        const radius = framing.getMoonBackdropScale(camera, width, height, .5, direction) / 2;
        assert.ok(center.y - Math.abs(up.y) * radius > 0, '整个月盘不能落到不透明海水后面');
        assertScreenPoint(center.project(camera), width < 760 ? .38 : .24, width < 760 ? .46 : .52);
      }
    }
  }
});

test('不同桌面宽高比、视野和相机缩放都保持固定屏幕构图', () => {
  for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9]) {
    for (const fov of [30, 46, 66, 95]) {
      const camera = new THREE.PerspectiveCamera(fov, aspect, .5, 7000);
      camera.position.set(90, 230, 115);
      camera.lookAt(0, 0, 0);
      for (const zoom of [.75, 1, 1.8]) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        assertScreenPoint(projectedMoon(camera, 1440), .24, .52);
      }
    }
  }
});

test('手机构图在窄屏中固定于右上背景，七百六十像素使用桌面位置', () => {
  for (const [width, height] of [[320, 568], [390, 844], [759, 1100], [760, 1100], [1280, 800]]) {
    const camera = new THREE.PerspectiveCamera(width < 760 ? 54 : 46, width / height, .5, 7000);
    camera.position.set(236.8, 100.64, 296);
    camera.lookAt(0, 15, 0);
    const mobile = width < 760;
    assertScreenPoint(projectedMoon(camera, width), mobile ? .38 : .24, mobile ? .46 : .52);
  }
});

test('相机大幅平移后月亮仍位于相同屏幕位置且方向不依赖相机坐标', () => {
  const getMoonBackdropDirection = api();
  const camera = new THREE.PerspectiveCamera(66, 16 / 9, .5, 7000);
  camera.rotation.set(-.5, 1.2, .15);
  const initial = getMoonBackdropDirection(camera, 1440);
  for (const position of [[0, 0, 0], [160, 68, 200], [-8000, 5000, 12000], [1e7, -2e7, 3e7]]) {
    camera.position.fromArray(position);
    const direction = getMoonBackdropDirection(camera, 1440);
    near(direction.distanceTo(initial), 0);
    assertScreenPoint(projectedMoon(camera, 1440), .24, .52, 1e-8);
  }
});

test('相机置于旋转父节点中时仍使用世界朝向进行构图', () => {
  const parent = new THREE.Group();
  parent.position.set(1000, 50, -800);
  parent.rotation.set(.2, -1.1, .3);
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, .5, 7000);
  camera.position.set(160, 68, 200);
  camera.rotation.set(-.3, .9, -.2);
  parent.add(camera);
  assertScreenPoint(projectedMoon(camera, 1440), .24, .52);
});

test('每次返回独立方向向量，调用方修改结果不会污染后续构图或相机', () => {
  const getMoonBackdropDirection = api();
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, .5, 7000);
  camera.position.set(160, 68, 200);
  camera.lookAt(0, 15, 0);
  const position = camera.position.clone();
  const quaternion = camera.quaternion.toArray();
  const up = camera.up.clone();
  const first = getMoonBackdropDirection(camera, 1440);
  const second = getMoonBackdropDirection(camera, 1440);
  const expected = second.clone();
  assert.notEqual(first, second);
  first.set(0, 0, 0);
  assert.deepEqual(second, expected);
  assert.deepEqual(getMoonBackdropDirection(camera, 1440), expected);
  assert.deepEqual(camera.position, position);
  assert.deepEqual(camera.quaternion.toArray(), quaternion);
  assert.deepEqual(camera.up, up);
  assertScreenPoint(projectedMoon(camera, 1440), .24, .52);
});

function sizeApi() {
  assert.equal(typeof framing?.getMoonBackdropSize, 'function', '月亮构图应提供月相对应的像素尺寸');
  assert.equal(typeof framing?.getMoonBackdropScale, 'function', '月亮构图应提供实际月盘使用的世界尺寸');
  return framing;
}

const phaseForIllumination = illumination => Math.acos(1 - illumination * 2) / (Math.PI * 2);

test('仅满月预设保留大月面，另外七种月相按接近太阳的自然比例显示', () => {
  const { getMoonBackdropSize } = sizeApi();
  for (const [width, height, natural, full] of [[1440, 900, 36, 135], [390, 844, 23.4, 78], [320, 568, 22, 64]]) {
    for (const preset of MOON_PHASES) {
      near(getMoonBackdropSize(width, height, preset.phase), preset.phase === .5 ? full : natural);
    }
  }
});

test('自动月相只在亮面99%至99.95%的满月窗口连续放大，盈亏对称', () => {
  const { getMoonBackdropSize } = sizeApi();
  const sizes = [[.98, 36], [.99, 36], [.99475, 85.5], [.9995, 135], [1, 135]];
  for (const [illumination, diameter] of sizes) {
    const phase = phaseForIllumination(illumination);
    near(getMoonBackdropSize(1440, 900, phase), diameter);
    near(getMoonBackdropSize(1440, 900, 1 - phase), diameter);
  }
  for (const illumination of [.99, .9995]) {
    const phase = phaseForIllumination(illumination);
    for (const boundary of [phase, 1 - phase]) {
      const before = getMoonBackdropSize(1440, 900, boundary - 1e-7);
      const after = getMoonBackdropSize(1440, 900, boundary + 1e-7);
      assert.ok(Math.abs(after - before) < .001, '满月窗口边界不可跳变');
    }
  }
  let previous = 36;
  for (let step = 0; step <= 100; step++) {
    const diameter = getMoonBackdropSize(1440, 900, phaseForIllumination(.99 + step * .000095));
    assert.ok(diameter >= previous - 1e-9 && diameter <= 135 + 1e-9);
    previous = diameter;
  }
});

function projectedDiameter(camera, width, height, phase) {
  const { getMoonBackdropScale } = sizeApi();
  const direction = framing.getMoonBackdropDirection(camera, width);
  const center = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 1900);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const halfScale = getMoonBackdropScale(camera, width, height, phase, direction) * .5;
  const top = center.clone().addScaledVector(up, halfScale).project(camera);
  const bottom = center.clone().addScaledVector(up, -halfScale).project(camera);
  return (top.y - bottom.y) * height * .5;
}

test('普通月相在桌面手机、视野和镜头缩放变化后仍保持22至36像素的实际直径', () => {
  for (const [width, height, expected] of [[320, 568, 22], [390, 844, 23.4], [759, 1100, 36],
    [760, 1100, 36], [900, 900, 36], [1200, 900, 36], [1600, 900, 36], [2100, 900, 36]]) {
    for (const fov of [30, 46, 66, 95]) {
      const camera = new THREE.PerspectiveCamera(fov, width / height, .5, 7000);
      camera.position.set(160, 68, 200);
      camera.rotation.set(-.35, .7, .12);
      for (const zoom of [.75, 1, 1.8]) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        for (const phase of [.125, .375, .625, .875]) near(projectedDiameter(camera, width, height, phase), expected, 1e-7);
      }
    }
  }
});

test('满月保留原尺寸公式，自动过渡的世界尺寸也连续', () => {
  const { getMoonBackdropScale } = sizeApi();
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const camera = new THREE.PerspectiveCamera(66, width / height, .5, 7000);
    camera.zoom = 1.8;
    camera.updateProjectionMatrix();
    const expected = Math.min(width * .2, height * .15) * 3800
      * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2)) / height;
    near(getMoonBackdropScale(camera, width, height, .5), expected);
    for (const illumination of [.99, .9995]) {
      const phase = phaseForIllumination(illumination);
      for (const boundary of [phase, 1 - phase]) assert.ok(Math.abs(
        getMoonBackdropScale(camera, width, height, boundary - 1e-7)
        - getMoonBackdropScale(camera, width, height, boundary + 1e-7)) < .001);
    }
  }
});
