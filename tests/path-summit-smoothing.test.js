import test from 'node:test';
import assert from 'node:assert/strict';
import { getIslandPathLayout, TERRAIN_GRID } from '../src/path-layout.js';

test('南峰亭旁的峰顶有连续肩坡，固定网格对角线不再切出孤立尖锥', () => {
  const layout = getIslandPathLayout(), sample = layout.heightAtRendered;
  const peak = { x: 12.109375, z: 18.1640625 }, step = TERRAIN_GRID.step;
  const top = sample(peak.x, peak.z);
  const shoulder = [[step, 0], [-step, 0], [0, step], [0, -step]]
    .reduce((sum, [dx, dz]) => sum + sample(peak.x + dx, peak.z + dz) / 4, 0);
  assert.ok(top - shoulder <= 1.05, `一格邻域的孤峰凸起应受限，实际 ${top - shoulder}m`);
  const end = sample(peak.x + step, peak.z + step);
  const middle = sample(peak.x + step / 2, peak.z + step / 2);
  assert.ok((top + end) / 2 - middle <= .95,
    `通向亭前平台的原有斜脊不能被对角网格切成深凹，实际 ${(top + end) / 2 - middle}m`);
});

test('修圆南峰只容许小幅削顶，亭前锚点与既有切填上限保持', () => {
  const layout = getIslandPathLayout();
  const top = layout.heightAtRendered(12.109375, 18.1640625);
  assert.ok(top <= 36.29368166188865 && top >= 36.29368166188865 - .55);
  assert.ok(top >= layout.heightAtRendered(13.3203125, 19.375), '修圆后峰高仍不低于亭前平台');
  assert.ok(Math.abs(layout.heightAtRendered(13.3203125, 19.375) - 35.785044774398465) < 1e-6);
  assert.ok(layout.terrainStats.maxCut <= 2.000001 && layout.terrainStats.maxFill <= 2.000001);
});

test('南峰局部重投影不能沿相连步道改变范围外的地形和另两座峰', () => {
  const sample = getIslandPathLayout().heightAtRendered;
  // 修整前实际测得的路网高度；不冻结局部以外顶点时，误差会沿路传播至数十米外。
  for (const [x, z, expected] of [
    [8.4765625, 15.7421875, 32.72179802823248],
    [-1.2109375, 20.5859375, 24.767457076057813],
    [2.421875, 19.375, 28.920554293191454],
    [0, 21.796875, 26.74222278463323],
    [-16.953125, -6.0546875, 50.07010171135244],
    [13.3203125, -23.0078125, 45.5132190642844],
  ]) assert.ok(Math.abs(sample(x, z) - expected) < 1e-6, `${x},${z} 超出局部肩坡，必须保持原高`);
});
