import test from 'node:test';
import assert from 'node:assert/strict';

let cloud;
try { cloud = await import('../src/cloud-texture.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const make = (seed, kind = 'cumulus') => {
  assert.equal(typeof cloud?.createCloudTextureData, 'function');
  return cloud.createCloudTextureData(seed, { kind, width: 192, height: 144 });
};

test('积云贴图有透明边界、厚实核心，以及明亮云顶与冷色阴影', () => {
  const { data, width, height } = make(1701);
  let opaque = 0, translucent = 0, lit = 0, shaded = 0, cool = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, alpha = data[at + 3];
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) assert.equal(alpha, 0, '云不能露出矩形贴图边框');
    if (alpha > 240) {
      opaque++;
      if (data[at] > 225) lit++;
      if (data[at] < 170) shaded++;
      if (data[at + 2] > data[at] + 15) cool++;
    } else if (alpha > 15 && alpha < 220) translucent++;
  }
  assert.ok(opaque > width * height * .06, '云体不能整朵变成透明烟雾');
  assert.ok(translucent > 100, '边缘需要透光云丝');
  assert.ok(lit > 80 && shaded > 80 && cool > 80, '云内需要清楚的受光与遮蔽层次');
});

test('相同种子重现云形，不同种子与云类产生不同轮廓', () => {
  const first = make(1701);
  assert.deepEqual(first.data, make(1701).data);
  const alpha = texture => texture.data.filter((_, index) => index % 4 === 3);
  for (const [seed, kind] of [[4367, 'cumulus'], [1701, 'tower'], [1701, 'altocumulus'], [1701, 'cirrus']]) {
    assert.notDeepEqual(alpha(first), alpha(make(seed, kind)));
  }
});

test('高空碎云保留云隙，薄云比厚积云更透光', () => {
  const thick = make(2609), thin = make(2609, 'cirrus'), patches = make(9481, 'altocumulus');
  const mass = texture => texture.data.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0);
  assert.ok(mass(thin) < mass(thick) * .65);
  let islands = 0;
  for (let row = Math.floor(patches.height * .25); row < patches.height * .75; row++) {
    let count = 0, inside = false;
    for (let x = 0; x < patches.width; x++) {
      const occupied = patches.data[(row * patches.width + x) * 4 + 3] > 60;
      if (occupied && !inside) count++;
      inside = occupied;
    }
    islands = Math.max(islands, count);
  }
  assert.ok(islands >= 3, '高空云群应有多处蓝天缝隙，不能合成一个大色块');
});

test('厚积云中央连续充实，不能形成拱门与底座之间的空洞', () => {
  const { data, width, height } = make(1701);
  let transparent = 0, total = 0;
  for (let y = Math.round(height * .56); y < height * .67; y++) {
    for (let x = Math.round(width * .40); x < width * .60; x++) {
      if (data[(y * width + x) * 4 + 3] < 180) transparent++;
      total++;
    }
  }
  assert.ok(transparent / total < .1, `云体中央${Math.round(transparent / total * 100)}%为空洞`);
});
