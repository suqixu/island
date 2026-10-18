import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import * as islandApi from '../src/models/island.js';

function geometryDigest(group) {
  const hash = createHash('sha256');
  group.traverse(object => {
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

// 固定基线只记录结构和整数索引，避免跨平台数学函数的末位差异影响快照。
// 浮点几何、变换和实例数据仍由同一运行环境下的完整摘要逐字节比较。
function structureDigest(group) {
  const hash = createHash('sha256');
  group.traverse(object => {
    if (object.userData.caveFlowerMeadow||object.name==='码头铺板积雪') return;
    hash.update(JSON.stringify([object.name, object.type, object.children.filter(child=>child.name!=='码头铺板积雪').length, object.count ?? null]));
    // 冬叶留存属性由独立测试守护，固定几何结构基线继续覆盖原有顶点与索引。
    for (const [name, attribute] of Object.entries(object.geometry?.attributes ?? {}).filter(([name])=>name!=='aWinterLeaf'&&name!=='aSnowNormal').sort()) {
      hash.update(JSON.stringify([name, attribute.array.constructor.name, attribute.itemSize, attribute.count, attribute.normalized]));
    }
    for (const attribute of [object.geometry?.index, object.instanceMatrix, object.instanceColor]) {
      hash.update(JSON.stringify(attribute ? [attribute.array.constructor.name, attribute.itemSize, attribute.count, attribute.normalized] : null));
    }
    const index = object.geometry?.index;
    if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength));
  });
  return hash.digest('hex');
}

test('分阶段海岛保留现有全部顶点、索引、实例矩阵、颜色与数量，并在内部耗时循环中让步', async () => {
  assert.equal(typeof islandApi.createIslandAsync, 'function', '启动需要异步分段创建海岛');
  const original = createIsland(new THREE.Scene());
  const before = geometryDigest(original.group);
  // 包含细沙岸坡、洞口精确裁切/封闭后缘和洞外纹理遮罩；保留码头纹理UV及叶片遮罩。
  // 低岸细沙不再重复覆盖浅色环路，保留内陆路径与其自然衔接权重。
  // 南峰局部14顶点修圆后，贴地石阶支撑面减少126个三角形；其余对象、索引与实例数量不变。
  // 固定结构快照继续防止同步与异步实现同时丢失模型。
  assert.equal(structureDigest(original.group), 'a89df96fc4d90e20c1ae76bcb327a94faf52cea45a5ea1503be2a55fa6574683');
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
