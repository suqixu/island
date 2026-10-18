import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createForestVisibility } from '../src/forest-visibility.js';

function forest() {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.setAttribute('aPlantRoot', new THREE.InstancedBufferAttribute(new Float32Array([-50, 0, -10, 50, 0, -10, -49, 0, -10, 49, 0, -10]), 3));
  geometry.setAttribute('aPlantHeight', new THREE.InstancedBufferAttribute(new Float32Array([3, 4, 5, 6]), 1));
  const material = new THREE.MeshStandardMaterial(), uniform = { value: 10 };
  material.onBeforeCompile = shader => { shader.uniforms.uTime = uniform; };
  material.customProgramCacheKey = () => 'forest-test';
  const source = new THREE.InstancedMesh(geometry, material, 4); source.name = '阔叶冠层-1';
  for (const [index, x] of [-50, 50, -49, 49].entries()) {
    source.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 2, -10));
    source.setColorAt(index, new THREE.Color(index / 4, .5, .8));
  }
  source.customDepthMaterial = new THREE.MeshDepthMaterial(); source.castShadow = source.receiveShadow = true;
  group.add(source);
  return { group, source, material, uniform };
}

const chunksOf = source => source.children.filter(child => child.userData.forestVisibility);

test('空间块省去镜头外实例，原森林索引与变换保持原样', () => {
  const { group, source } = forest(), matrices = source.instanceMatrix.array.slice();
  const visibility = createForestVisibility(group); visibility.update();
  const chunks = chunksOf(source); assert.equal(chunks.length, 2);
  assert.equal(source.material.visible, false);
  assert.deepEqual(source.instanceMatrix.array, matrices); assert.equal(source.count, 4);
  group.updateMatrixWorld(true);
  const camera = new THREE.OrthographicCamera(40, 60, 10, -10, .1, 100); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
  const submitted = chunks.filter(chunk => frustum.intersectsObject(chunk)).reduce((sum, chunk) => sum + chunk.count, 0);
  assert.equal(submitted, 2, '只提交右侧两棵树，不能按跨岛大球提交全部');
  visibility.dispose();
});

test('各画质仅保留原始count前缀，实例根属性和颜色按原index对应', () => {
  const { group, source } = forest(), visibility = createForestVisibility(group);
  for (const count of [2, 3, 4]) {
    source.count = count; visibility.update();
    const indices = chunksOf(source).flatMap(chunk => Array.from(chunk.userData.originalIndices).slice(0, chunk.count)).sort();
    assert.deepEqual(indices, Array.from({ length: count }, (_, index) => index));
    for (const chunk of chunksOf(source)) for (let at = 0; at < chunk.count; at++) {
      const original = chunk.userData.originalIndices[at];
      assert.equal(chunk.geometry.attributes.aPlantHeight.getX(at), [3, 4, 5, 6][original]);
      assert.equal(chunk.geometry.attributes.aPlantRoot.getX(at), [-50, 50, -49, 49][original]);
      assert.equal(chunk.instanceColor.getX(at), original / 4);
    }
  }
  const right = chunksOf(source).find(chunk => chunk.userData.originalIndices[0] === 1);
  const colors = right.instanceColor;
  source.setColorAt(1, new THREE.Color(.2, .3, .4)); source.instanceColor.needsUpdate = true; visibility.update();
  assert.ok(Math.abs(right.instanceColor.getX(0) - .2) < 1e-6);
  assert.equal(right.instanceColor, colors, '季节换色复用GPU属性，不能遗留旧颜色缓冲');
  source.geometry.attributes.aPlantHeight.setX(1, 9); source.geometry.attributes.aPlantHeight.needsUpdate = true;
  visibility.update(); assert.equal(right.geometry.attributes.aPlantHeight.getX(0), 9);
  visibility.dispose();
});

test('LOD与冬季drawRange同步，静态顶点共享且恢复LOD时复用几何', () => {
  const { group, source } = forest(), near = source.geometry, visibility = createForestVisibility(group);
  visibility.update(); const chunks = chunksOf(source), originalChunkGeometry = chunks[0].geometry;
  assert.equal(originalChunkGeometry.attributes.position, near.attributes.position);
  const far = near.clone(); far.setDrawRange(3, 9); source.geometry = far; visibility.update();
  assert.equal(chunks[0].geometry.attributes.position, far.attributes.position);
  assert.deepEqual(chunks[0].geometry.drawRange, { start: 3, count: 9 });
  far.setDrawRange(0, 6); visibility.update(); assert.equal(chunks[0].geometry.drawRange.count, 6);
  source.geometry = near; visibility.update(); assert.equal(chunks[0].geometry, originalChunkGeometry);
  visibility.dispose();
});

test('风动边界保守扩张，块保留风雪编译器、深度阴影与后加载材质参数', () => {
  const { group, source, uniform, material } = forest(), visibility = createForestVisibility(group);
  visibility.update(); const chunk = chunksOf(source)[0];
  assert.equal(chunk.frustumCulled, true); assert.equal(chunk.castShadow, true);
  assert.equal(chunk.customDepthMaterial, source.customDepthMaterial);
  assert.equal(chunk.material.onBeforeCompile, material.onBeforeCompile);
  const shader = { uniforms: {} }; chunk.material.onBeforeCompile(shader); assert.equal(shader.uniforms.uTime, uniform);
  const staticBounds = chunk.boundingSphere.clone(); chunk.computeBoundingSphere();
  assert.ok(staticBounds.radius >= chunk.boundingSphere.radius + 2.99);
  material.roughness = .27; material.color.setRGB(.1, .2, .3); visibility.update();
  assert.equal(chunk.material.roughness, .27); assert.equal(chunk.material.color.g, .2);
  assert.equal(chunk.material.visible, true); assert.equal(material.visible, false);
  visibility.dispose();
});

test('释放解除共享顶点引用后再销毁自有资源，恢复源材质且可重复释放', () => {
  const { group, source, material } = forest(), visibility = createForestVisibility(group);
  visibility.update(); const chunks = chunksOf(source), position = source.geometry.attributes.position;
  let originalDisposed = 0, chunkDisposed = 0;
  source.geometry.addEventListener('dispose', () => originalDisposed++);
  material.addEventListener('dispose', () => originalDisposed++);
  source.addEventListener('dispose', () => originalDisposed++);
  for (const chunk of chunks) chunk.geometry.addEventListener('dispose', event => {
    chunkDisposed++;
    assert.equal(event.target.index, null);
    assert.equal(event.target.attributes.position, undefined, '不能让渲染器删除共享GPU顶点缓冲');
  });
  visibility.dispose(); visibility.dispose(); visibility.update();
  assert.equal(originalDisposed, 0); assert.equal(chunkDisposed, 2);
  assert.equal(source.material, material); assert.equal(material.visible, true);
  assert.equal(source.geometry.attributes.position, position); assert.equal(chunksOf(source).length, 0);
});

test('宽视角保持原批次，近景裁减明显才启用空间块', () => {
  const { group, source } = forest(), visibility = createForestVisibility(group);
  const camera = new THREE.OrthographicCamera(-100, 100, 15, -15, .1, 100);
  visibility.update(camera);
  assert.equal(source.material.visible, true, '全森林可见时避免将两块变成额外绘制调用');
  assert.ok(chunksOf(source).every(chunk => !chunk.material.visible));
  assert.ok(chunksOf(source).every(chunk => !chunk.visible), '原批次恢复投影后，块直接跳过渲染器的几何更新');
  camera.left = 40; camera.right = 60; camera.updateProjectionMatrix(); visibility.update(camera);
  assert.equal(source.material.visible, false);
  assert.ok(chunksOf(source).every(chunk => chunk.material.visible));
  assert.ok(chunksOf(source).every(chunk => chunk.visible));
  visibility.dispose();
});

test('裁减比例处于阈值附近时沿用先前批次模式', () => {
  const { group, source } = forest();
  source.removeFromParent();
  const expanded = new THREE.InstancedMesh(source.geometry, source.material, 20); expanded.name = source.name;
  const positions = [...Array(9).fill(-50), ...Array(8).fill(0), ...Array(3).fill(50)];
  expanded.geometry.deleteAttribute('aPlantRoot'); expanded.geometry.deleteAttribute('aPlantHeight');
  positions.forEach((x, index) => expanded.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 0, -10)));
  group.add(expanded); const visibility = createForestVisibility(group);
  const camera = new THREE.OrthographicCamera(-100, 100, 15, -15, .1, 100);
  visibility.update(camera); assert.equal(visibility.stats.chunked, false);
  camera.left = -5; camera.right = 55; camera.updateProjectionMatrix(); visibility.update(camera);
  assert.equal(visibility.stats.chunked, false, '保留55%时不从原批次进入分块');
  camera.right = 5; camera.updateProjectionMatrix(); visibility.update(camera);
  assert.equal(visibility.stats.chunked, true, '只保留40%时允许分块');
  camera.right = 55; camera.updateProjectionMatrix(); visibility.update(camera);
  assert.equal(visibility.stats.chunked, true, '重新保留55%时不在临界角反复切换');
  visibility.dispose();
});
