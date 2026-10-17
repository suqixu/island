import test from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, shoreDistance } from '../src/terrain.js';

const lagoon = await import('../src/lagoon.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function api() { assert.ok(lagoon, '前方泻湖应提供共享地形和材质布局'); return lagoon; }
function point(u, v) {
  const { center, rotation } = api().LAGOON_LAYOUT, c = Math.cos(rotation), s = Math.sin(rotation);
  return [center[0] + c * u - s * v, center[1] + s * u + c * v];
}

test('前方泻湖是约45乘32米的真实浅水海床，湖床有温和起伏', () => {
  assert.ok(heightAt(50, 75) > -4 && heightAt(50, 75) < -1.5);
  const heights = [];
  for (let row = -3; row <= 3; row++) for (let col = -4; col <= 4; col++) {
    const u = col * 4, v = row * 3;
    if (Math.hypot(u / 25, v / 18) > .75) continue;
    const [x, z] = point(u, v), h = heightAt(x, z);
    assert.ok(h >= -4 && h < -1.3); heights.push(h);
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > .25);
  for (const [u, v] of [[21, 0], [-21, 0], [0, 15], [0, -15]]) {
    const [x, z] = point(u, v); assert.ok(heightAt(x, z) < -.3);
  }
});

test('细沙洲两臂露出水面且与原沙滩连岸，不形成孤立人造沙环', () => {
  const { isLagoonSandAt } = api();
  // Follow each curved arm's actual dry crest instead of assuming an ellipse.
  const targets = [0, Math.PI, -Math.PI / 2].map(angle => {
    let best, highest = -Infinity;
    for (let rho = .95; rho <= 1.24; rho += .002) {
      const candidate = point(Math.cos(angle) * 25 * rho, Math.sin(angle) * 18 * rho);
      const h = heightAt(...candidate);
      if (h > highest) { best = candidate; highest = h; }
    }
    return best;
  });
  for (const [x, z] of targets) {
    assert.ok(heightAt(x, z) > .3 && heightAt(x, z) < 1.5);
    assert.ok(isLagoonSandAt(x, z, shoreDistance(x, z)));
  }
  const step = .75, minX = 12, minZ = 40, width = 105, rows = 100;
  const land = new Uint8Array(width * rows), seen = new Uint8Array(land.length), queue = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < width; col++) {
    const x = minX + col * step, z = minZ + row * step, index = row * width + col;
    land[index] = heightAt(x, z) > .04 ? 1 : 0;
    if (land[index] && shoreDistance(x, z) > 5) { seen[index] = 1; queue.push(index); }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], col = index % width, row = Math.floor(index / width);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc, r = row + dr, next = r * width + c;
      if (c >= 0 && c < width && r >= 0 && r < rows && land[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
    }
  }
  for (const [x, z] of targets) {
    const col = Math.round((x - minX) / step), row = Math.round((z - minZ) / step);
    assert.equal(seen[row * width + col], 1, '沙洲必须沿连续干沙与原岛相连');
  }
});

test('沙臂实际曲线有温和不规则起伏，两侧坡肩宽度不同', () => {
  const { applyLagoonHeight } = api(), radii = [], widths = [];
  for (let sample = 0; sample < 72; sample++) {
    const angle = sample / 72 * Math.PI * 2;
    // A uniform submerged baseline isolates bank shape from the original island.
    let highest = -Infinity, peak = 0, first = Infinity, last = -Infinity;
    for (let rho = .8; rho <= 1.4; rho += .002) {
      const [x, z] = point(Math.cos(angle) * 25 * rho, Math.sin(angle) * 18 * rho);
      const h = applyLagoonHeight(x, z, -4, 0);
      if (h > highest) { highest = h; peak = rho; }
      if (h > -.5) { first = Math.min(first, rho); last = Math.max(last, rho); }
    }
    if (highest > .3) { radii.push(peak); widths.push(last - first); }
  }
  assert.ok(radii.length > 55, '保留完整弯曲沙臂和唯一海口');
  assert.ok(Math.max(...radii) - Math.min(...radii) > .10, '沙洲不可保持完美等半径椭圆');
  assert.ok(Math.max(...radii) - Math.min(...radii) < .25, '不规则起伏仍应温和');
  assert.ok(Math.max(...widths) - Math.min(...widths) > .04, '两侧沙臂不能保持相同坡肩宽度');
});

test('泻湖内有平滑遮浪，外海和十米海口保持完全开放', () => {
  const { getLagoonShelter, mouthDirection } = { ...api(), ...api().LAGOON_LAYOUT };
  assert.equal(typeof getLagoonShelter, 'function');
  assert.equal(getLagoonShelter(50, 75), 1);
  for (const [x, z] of [[0, 90], [150, 150], [-150, 130], [90, 110]]) assert.equal(getLagoonShelter(x, z), 0);
  for (const cross of [-5, 0, 5]) for (let distance = 12; distance <= 42; distance += .5) {
    const [du, dv] = mouthDirection, [x, z] = point(du * distance - dv * cross, dv * distance + du * cross);
    assert.equal(getLagoonShelter(x, z), 0, '通海口不能被虚拟遮浪封住');
  }
  for (let x = 12; x <= 88; x += .9) for (let z = 41; z <= 109; z += .9) {
    const shelter = getLagoonShelter(x, z);
    assert.ok(Number.isFinite(shelter) && shelter >= 0 && shelter <= 1);
    assert.ok(Math.abs(getLagoonShelter(x + .0001, z) - getLagoonShelter(x - .0001, z)) < .002);
    assert.ok(Math.abs(getLagoonShelter(x, z + .0001) - getLagoonShelter(x, z - .0001)) < .002);
  }
  assert.equal(getLagoonShelter(NaN, 75), 0);
});

test('泻湖海口与外海保持真实连续水道，宽度可通过约十米而非封闭水池', () => {
  const { mouthDirection } = api().LAGOON_LAYOUT;
  const [du, dv] = mouthDirection;
  for (const cross of [-4, 0, 4]) for (let distance = 0; distance <= 42; distance += .5) {
    const [x, z] = point(du * distance - dv * cross, dv * distance + du * cross);
    assert.ok(heightAt(x, z) < -.3, `海口在${distance}米不可被沙洲堵住`);
  }
});

test('融合后的湖床、沙洲及边缘有限且连续，内侧陆路不淹水', () => {
  const { getLagoonMask } = api();
  for (let u = -40; u <= 40; u += 1) for (let v = -28; v <= 30; v += 1) {
    const [x, z] = point(u, v), h = heightAt(x, z), shore = shoreDistance(x, z);
    assert.ok(Number.isFinite(h));
    const mask = getLagoonMask(x, z, shore); assert.ok(mask >= 0 && mask <= 1);
    if (shore >= 4) assert.equal(mask, 0);
    if (mask > .99 && shore < 0) {
      assert.ok(Math.abs(heightAt(x + .0001, z) - heightAt(x - .0001, z)) < .002);
      assert.ok(Math.abs(heightAt(x, z + .0001) - heightAt(x, z - .0001)) < .002);
    }
  }
});

test('三峰、山洞附近、南码头海口以及远海深水高度保持原值', () => {
  const baseline = [
    [-17, -9, 49.55089804412717], [16, -22, 42.68954310536332], [11, 19, 34.92471100823656],
    [0, 60, 4.261364752285711], [0, 75, .15280923213681208], [0, 90, -2.311871012231592], [0, 100, -5.7643804212028895],
    [150, 150, -21.850428073533568], [-150, 130, -20.803660427063015], [30, 36, 13.537588331287257], [34, 41, 8.926415609998916],
  ];
  // 不同平台的 exp/pow 等数学函数可能有末位差异，允许十亿分之一米误差。
  for (const [x, z, h] of baseline) {
    const actual = heightAt(x, z);
    assert.ok(Math.abs(actual - h) <= 1e-9, `(${x}, ${z}) 高度应接近 ${h}，实际为 ${actual}`);
  }
});
