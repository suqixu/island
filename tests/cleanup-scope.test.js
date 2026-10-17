import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const module = await import('../src/cleanup-scope.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function create(options) {
  assert.ok(module?.createCleanupScope, '启动异常与退出需要共用幂等清理作用域');
  return module.createCleanupScope(options);
}

test('启动异常和随后退出只清理一次，先停止监听和场景资源再释放上下文', () => {
  const scope = create(), calls = [], target = new EventTarget();
  scope.add(() => calls.push('context'));
  const geometry = new THREE.BufferGeometry();
  geometry.addEventListener('dispose', () => calls.push('geometry'));
  scope.add(() => geometry.dispose());
  scope.listen(target, 'frame', () => calls.push('frame'));
  target.dispatchEvent(new Event('frame'));
  scope.dispose(); scope.dispose();
  target.dispatchEvent(new Event('frame'));
  assert.deepEqual(calls, ['frame', 'geometry', 'context']);
});

test('异步纹理迟于失败到达时立即释放，已移交场景的纹理由场景恰好释放一次', async () => {
  const scope = create(), pending = create();
  const texture = new THREE.Texture(), late = new THREE.Texture();
  let released = 0, lateReleased = 0;
  texture.addEventListener('dispose', () => released++);
  late.addEventListener('dispose', () => lateReleased++);
  const transfer = scope.add(() => texture.dispose());
  scope.add(() => texture.dispose()); // The atmosphere now owns the texture.
  transfer(); scope.dispose(); scope.dispose();
  pending.dispose();
  await Promise.resolve().then(() => pending.add(() => late.dispose()));
  pending.dispose();
  assert.equal(released, 1);
  assert.equal(lateReleased, 1);
});

test('单个清理器抛错不能阻止其余资源和GPU上下文释放', () => {
  const errors = [], calls = [], failure = new Error('dispose failed');
  const scope = create({ onError: error => errors.push(error) });
  scope.add(() => calls.push('context'));
  scope.add(() => { throw failure; });
  scope.add(() => calls.push('scene'));
  scope.dispose(); scope.dispose();
  assert.deepEqual(calls, ['scene', 'context']);
  assert.deepEqual(errors, [failure]);
});

test('构建或异步编译失败自动清理已创建资源，并先保留原始错误', async () => {
  for (const asynchronous of [false, true]) {
    const calls = [], failure = new Error(asynchronous ? 'compile failed' : 'build failed');
    const scope = create({ onFailure: error => { assert.equal(error, failure); calls.push('error'); } });
    await scope.run(async () => {
      scope.add(() => calls.push('context'));
      scope.add(() => calls.push('scene'));
      if (asynchronous) await Promise.reject(failure);
      throw failure;
    });
    scope.dispose();
    assert.deepEqual(calls, ['error', 'scene', 'context']);
  }
});

test('初始化成功保留资源，首帧失败与后续退出共用一次清理', async () => {
  const calls = [], scope = create({ onFailure: () => calls.push('error') });
  await scope.run(async () => { scope.add(() => calls.push('context')); });
  assert.deepEqual(calls, []);
  scope.fail(new Error('first frame failed')); scope.dispose();
  assert.deepEqual(calls, ['error', 'context']);
});
