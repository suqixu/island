import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const framing = await import('../src/sun-framing.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});

function api() {
  assert.ok(framing, '应提供太阳构图与统一可见度接口');
  return framing;
}

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

const viewports = [[1280, 900], [1280, 720], [390, 844], [634, 768], [640, 480]];
const views = {
  island: { position: [160, 68, 200], target: [0, 15, 0] },
  beach: { position: [96, 15, 111], target: [8, 5, 20] },
  dock: { position: [40, 12, 128], target: [5, 5, 60] },
  aerial: { position: [90, 230, 115], target: [0, 0, 0] },
};

function cameraFor(width, height, view = 'island') {
  const camera = new THREE.PerspectiveCamera(width < 760 ? 54 : 46, width / height, .5, 7000);
  const { position, target } = views[view];
  camera.position.fromArray(position);
  if (view === 'island' && width < 760) camera.position.multiplyScalar(1.48);
  camera.lookAt(...target);
  return camera;
}

function physical(height = .8) {
  return new THREE.Vector3(Math.sqrt(1 - height * height), height, 0);
}

function screenPoint(camera, direction, width, height) {
  const point = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 1900).project(camera);
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2, ndc: point };
}

// Two independent horizontal world rays determine the horizon line, including roll.
function horizonY(camera, width, height, screenX) {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const azimuth = Math.atan2(forward.x, forward.z);
  const points = [-.24, .24].map(offset =>
    screenPoint(camera, new THREE.Vector3(Math.sin(azimuth + offset), 0, Math.cos(azimuth + offset)), width, height));
  return points[0].y + (screenX - points[0].x) * (points[1].y - points[0].y) / (points[1].x - points[0].x);
}

function projectedDiameter(camera, direction, angularRadius, width, height) {
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const tangent = up.addScaledVector(direction, -up.dot(direction)).normalize();
  const edge = sign => direction.clone().multiplyScalar(Math.cos(angularRadius))
    .addScaledVector(tangent, sign * Math.sin(angularRadius));
  return Math.abs(screenPoint(camera, edge(1), width, height).y - screenPoint(camera, edge(-1), width, height).y);
}

test('太阳模块提供独立构图状态与天气可见度接口', () => {
  assert.equal(typeof api().getSunBackdropState, 'function');
  assert.equal(typeof api().getSunVisibility, 'function');
});

test('默认镜头在指定桌面、手机和小屏尺寸将日盘置于右上天空', () => {
  for (const [width, height] of viewports) {
    const camera = cameraFor(width, height);
    const state = api().getSunBackdropState(camera, width, height, physical());
    assert.equal(state.framed, true, `${width}×${height}默认视角应有足够天空`);
    near(state.direction.length(), 1);
    const projected = screenPoint(camera, state.direction, width, height);
    near(projected.ndc.x, .36);
    near(projected.y, Math.max(width < 760 ? 110 : height > 780 ? 122 : 104, height * .15));
    assert.ok(state.direction.y > 0, '构图太阳必须位于世界地平线上方');
    assert.ok(projected.ndc.z > -1 && projected.ndc.z < 1);
  }
});

test('海岸和码头镜头保留日盘的UI及真实地平线间隔', () => {
  for (const view of ['beach', 'dock']) {
    for (const [width, height] of viewports) {
      const camera = cameraFor(width, height, view);
      const state = api().getSunBackdropState(camera, width, height, physical());
      assert.equal(state.framed, true);
      const projected = screenPoint(camera, state.direction, width, height);
      const diameter = projectedDiameter(camera, state.direction, state.angularRadius, width, height);
      near(projected.ndc.x, .36);
      assert.ok(projected.y - diameter / 2 >= 78, '日盘顶部应避开UI');
      assert.ok(projected.y + diameter / 2 + 11.8 < horizonY(camera, width, height, projected.x));
    }
  }
});

test('俯瞰天空不足时返回物理方向，绝不将日盘贴在海面', () => {
  const input = new THREE.Vector3(4, 3, 2);
  const initial = input.clone();
  for (const [width, height] of viewports) {
    const camera = cameraFor(width, height, 'aerial');
    const state = api().getSunBackdropState(camera, width, height, input);
    assert.equal(state.framed, false);
    near(state.direction.distanceTo(input.clone().normalize()), 0);
    assert.notEqual(state.direction, input);
    assert.ok(state.angularRadius > 0 && Number.isFinite(state.angularRadius));
  }
  assert.deepEqual(input, initial);
});

test('地平线距顶部过近和垂直俯视时均安全回退', () => {
  const camera = new THREE.PerspectiveCamera(46, 1280 / 720, .5, 7000);
  const tilt = Math.atan((1 - 2 * 100 / 720) * Math.tan(THREE.MathUtils.degToRad(46) / 2));
  camera.lookAt(0, -Math.sin(tilt), -Math.cos(tilt));
  assert.equal(api().getSunBackdropState(camera, 1280, 720, physical()).framed, false);
  camera.lookAt(0, -1, 0);
  assert.equal(api().getSunBackdropState(camera, 1280, 720, physical()).framed, false);
});

test('日出日落的太阳中心连续穿越太阳所在x的真实地平线', () => {
  const camera = cameraFor(1280, 900);
  const states = [.3, .25, .2, .1, .02, 0, -.02].map(height =>
    api().getSunBackdropState(camera, 1280, 900, physical(height)));
  const points = states.map(state => screenPoint(camera, state.direction, 1280, 900));
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].y >= points[i - 1].y - 1e-8);
    assert.ok(states[i].framed);
  }
  assert.ok(points[5].y - points[0].y > 40, '低太阳应明显靠近真实地平线');
  near(points[5].y, horizonY(camera, 1280, 900, points[5].x));
  near(states[5].direction.y, 0);
  assert.ok(points[4].y < points[5].y && states[4].direction.y > 0);
  assert.ok(points[6].y > points[5].y && states[6].direction.y < 0);
});

test('日出前及落日后中心在地平线下时，盘面上缘可露出并最终沉入', () => {
  const camera = cameraFor(1280, 900);
  const getState = height => api().getSunBackdropState(camera, 1280, 900, physical(height));
  const partial = getState(-.006);
  const sunken = getState(-.04);
  const upperEdgeY = state => Math.sin(Math.asin(state.direction.y) + state.angularRadius);
  assert.equal(partial.framed, true);
  assert.equal(sunken.framed, true);
  assert.ok(partial.direction.y < 0, '中心应处于地平线之下');
  assert.ok(upperEdgeY(partial) > 0, '刚升起或刚落下仍可显示露出的上缘');
  assert.ok(upperEdgeY(sunken) < 0, '继续下沉后整个盘面均应位于地平线下');
});

test('日盘实际投影直径符合22至36像素限制，并适应FOV与缩放', () => {
  for (const [width, height] of viewports) {
    for (const fov of [30, 46, 75]) {
      for (const zoom of [.7, 1, 1.6]) {
        const camera = cameraFor(width, height, 'beach');
        camera.fov = fov;
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        const state = api().getSunBackdropState(camera, width, height, physical());
        assert.equal(state.framed, true);
        const expected = THREE.MathUtils.clamp(Math.min(width * .06, height * .04), 22, 36);
        near(projectedDiameter(camera, state.direction, state.angularRadius, width, height), expected, .2);
      }
    }
  }
});

test('镜头滚转时在太阳所在水平坐标检查地平线，而非画面中心', () => {
  for (const roll of [-.45, -.2, .2, .45]) {
    const camera = cameraFor(1280, 900, 'beach');
    camera.rotateZ(roll);
    const state = api().getSunBackdropState(camera, 1280, 900, physical(0));
    assert.equal(state.framed, true);
    const projected = screenPoint(camera, state.direction, 1280, 900);
    near(projected.y, horizonY(camera, 1280, 900, projected.x));
    near(state.direction.y, 0);
  }
});

test('旋转父节点、相机平移与返回值修改不会污染相机或物理太阳输入', () => {
  const parent = new THREE.Group();
  parent.position.set(1000, 20, -600);
  parent.rotation.set(.04, 1.1, -.12);
  const camera = cameraFor(1280, 900, 'beach');
  parent.add(camera);
  const input = physical();
  const original = input.clone();
  const position = camera.position.clone();
  const quaternion = camera.quaternion.toArray();
  const first = api().getSunBackdropState(camera, 1280, 900, input);
  assert.equal(first.framed, true);
  near(screenPoint(camera, first.direction, 1280, 900).ndc.x, .36);
  const second = api().getSunBackdropState(camera, 1280, 900, input);
  assert.notEqual(first.direction, second.direction);
  first.direction.set(0, 0, 0);
  assert.ok(second.direction.length() > .999);
  camera.position.add(new THREE.Vector3(3000, -1200, 900));
  const translated = api().getSunBackdropState(camera, 1280, 900, input);
  near(translated.direction.distanceTo(second.direction), 0);
  assert.deepEqual(input, original);
  assert.deepEqual(camera.quaternion.toArray(), quaternion);
  camera.position.copy(position);
});

test('夜晚、无日光时太阳盘可见度为零，晴日接近完全可见', () => {
  const { getSunVisibility } = api();
  assert.equal(getSunVisibility({ sunHeight: -.5 }), 0);
  assert.equal(getSunVisibility({ sunHeight: -.035 }), 0);
  assert.equal(getSunVisibility({ sunHeight: .8, daylight: 0 }), 0);
  const clear = getSunVisibility({ sunHeight: .8, cloudiness: .12 });
  assert.ok(clear >= .95 && clear <= 1);
});

test('黎明日光余量允许橙色日盘显现，夜间仍关闭全部太阳光', () => {
  const { getSunVisibility } = api();
  assert.ok(getSunVisibility({ sunHeight: -.006, daylight: .24, cloudiness: .12 }) > .1);
  assert.ok(getSunVisibility({ sunHeight: .02, daylight: .24, cloudiness: .12 }) > .55);
  assert.equal(getSunVisibility({ sunHeight: -.04, daylight: .24 }), 0);
  assert.equal(getSunVisibility({ sunHeight: -.5, daylight: 0 }), 0);
});

test('阴云、浓雾、雨雪和雷暴显著遮蔽太阳，所有结果限制在0至1', () => {
  const { getSunVisibility } = api();
  const clear = getSunVisibility({ sunHeight: .8, cloudiness: .12 });
  assert.ok(getSunVisibility({ sunHeight: .8, cloudiness: .86 }) < .01);
  for (const weather of [{ fog: .8 }, { rain: .8 }, { snow: .8 }, { storm: .8 }]) {
    const visibility = getSunVisibility({ sunHeight: .8, ...weather });
    assert.ok(visibility >= 0 && visibility < clear * .1);
  }
  const storm = getSunVisibility({ sunHeight: .8, cloudiness: .96, rain: .8, fog: .45, storm: .9 });
  assert.ok(storm < .001);
  assert.equal(getSunVisibility({ sunHeight: .8, daylight: 2, cloudiness: -2 }), 1);
});

test('日出日落可见度随实际太阳高度连续单调变化，边缘过渡柔和', () => {
  const { getSunVisibility } = api();
  const values = Array.from({ length: 97 }, (_, i) => getSunVisibility({ sunHeight: -.035 + i * .001 }));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] >= values[i - 1]);
    assert.ok(values[i] - values[i - 1] < .017);
  }
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 1);
  assert.ok(values[1] - values[0] < values[55] - values[54]);
  assert.ok(values.at(-1) - values.at(-2) < values[55] - values[54]);
});
