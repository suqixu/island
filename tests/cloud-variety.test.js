import test from 'node:test';
import assert from 'node:assert/strict';
import * as cloud from '../src/cloud-texture.js';

test('云形抽取在用完素材前不重复，不改变原素材顺序，并随随机序列变化', () => {
  assert.equal(typeof cloud.shuffleCloudMaps, 'function');
  const maps = Array.from({ length: 64 }, (_, id) => ({ id }));
  const first = cloud.shuffleCloudMaps(maps, () => 0);
  const second = cloud.shuffleCloudMaps(maps, () => .73);
  assert.equal(new Set(first).size, 64);
  assert.deepEqual(maps.map(map => map.id), Array.from({ length: 64 }, (_, id) => id));
  assert.notDeepEqual(first, second);
  assert.deepEqual(cloud.shuffleCloudMaps([maps[0]], () => .5), [maps[0]]);
});
