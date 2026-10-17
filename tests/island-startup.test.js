import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createIsland } from '../src/island.js';
import * as islandApi from '../src/island.js';

function geometryDigest(group, includeNewFlowers = true) {
  const hash = createHash('sha256');
  group.traverse(object => {
    if (!includeNewFlowers && object.userData.caveFlowerMeadow) return;
    hash.update(object.name);
    hash.update(JSON.stringify([object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.count]));
    for (const [name, attribute] of Object.entries(object.geometry?.attributes ?? {}).sort()) {
      hash.update(name);
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    for (const attribute of [object.geometry?.index, object.instanceMatrix, object.instanceColor]) {
      if (attribute) hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
  });
  return hash.digest('hex');
}

test('分阶段海岛保留现有全部顶点、索引、实例矩阵、颜色与数量，并在内部耗时循环中让步', async () => {
  assert.equal(typeof islandApi.createIslandAsync, 'function', '启动需要异步分段创建海岛');
  const original = createIsland(new THREE.Scene());
  const before = geometryDigest(original.group);
  // 洞道延长、转弯、内部遮蔽增强与洞内转角微光后的固定快照，防止同步与异步实现一起退化。
  // Newly requested flowers have separate placement/budget coverage; preserve every previous island object.
  assert.equal(geometryDigest(original.group, false), '0ee60796f617ace1e35c0916aea09689bceb28eeff82f106eb159c926605d3c6');
  const scene = new THREE.Scene(), stages = [], slices = [];
  let stage, clock = 0, paints = 0;
  const asynchronous = await islandApi.createIslandAsync(scene, {
    budgetMs: 8,
    now: () => clock++,
    onProgress: value => { stage = value; stages.push(value); },
    onSlice: value => slices.push(value),
    yieldToBrowser: async () => {
      paints++;
      // 场景从完整结果一次性发布，不让帧更新读到只生成一半的海岛。
      assert.equal(scene.children.length, 0);
    },
  });
  assert.deepEqual(asynchronous.group.userData.stats, original.group.userData.stats);
  assert.equal(geometryDigest(asynchronous.group), before);
  assert.equal(scene.children[0], asynchronous.group);
  for (const heavy of ['terrain', 'paths', 'forest', 'understory']) {
    assert.ok(slices.filter(slice => slice.stage === heavy).length > 2, `${heavy} 内部应多次让步`);
  }
  assert.ok(stages.includes('paths'));
  assert.ok(paints > stages.length);
  assert.equal(stage, 'birds');
  original.dispose();
  asynchronous.dispose();
});
