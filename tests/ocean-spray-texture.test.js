import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSprayAtlas } from '../src/ocean-spray-texture.js';
import { createOceanSpray } from '../src/ocean-spray.js';
import { createOcean } from '../src/ocean.js';

const settle = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };

test('浪花图集创建和读取启动就绪状态不下载，首次加载复用同一个完成结果', async () => {
  let calls = 0, complete;
  const atlas = createSprayAtlas({ loadImage: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  try {
    assert.equal(typeof atlas.load, 'function', '图集需要独立的按需入口');
    assert.equal(calls, 0);
    assert.equal(await atlas.ready, false, '未触发图集不能阻塞海面启动');
    assert.equal(atlas.uniforms.ready.value, 0);
    const first = atlas.load();
    assert.equal(atlas.load(), first);
    assert.equal(atlas.ready, first);
    await settle();
    assert.equal(calls, 1);
    const image = { width: 2, height: 2 };
    complete(image);
    assert.equal(await first, true);
    assert.equal(atlas.uniforms.map.value.image, image);
    assert.equal(atlas.uniforms.ready.value, 1);
    assert.equal(atlas.load(), first, '完成后仍不能重新请求');
    assert.equal(calls, 1);
  } finally { atlas.dispose(); }
});

test('图集失败保留程序化回退，后续台风不会重复下载', async () => {
  let calls = 0;
  const atlas = createSprayAtlas({ loadImage: async () => { calls++; throw new Error('图集离线'); } });
  try {
    assert.equal(typeof atlas.load, 'function');
    const first = atlas.load();
    assert.equal(await first, false);
    assert.equal(atlas.uniforms.ready.value, 0);
    assert.equal(atlas.load(), first);
    assert.equal(calls, 1);
  } finally { atlas.dispose(); }
});

test('退出前不启动请求，退出后的迟到图像不能重新上传或恢复图集', async () => {
  let cancelledCalls = 0;
  const cancelled = createSprayAtlas({ loadImage: async () => { cancelledCalls++; return {}; } });
  assert.equal(typeof cancelled.load, 'function');
  let released = 0;
  cancelled.uniforms.map.value.addEventListener('dispose', () => released++);
  const pending = cancelled.load(); cancelled.dispose(); cancelled.dispose();
  assert.equal(await pending, false);
  assert.equal(await cancelled.load(), false);
  assert.equal(cancelledCalls, 0, '退出后不应启动排队中的图片请求');
  assert.equal(released, 1);

  let complete, closed = 0;
  const late = createSprayAtlas({ loadImage: () => new Promise(resolve => { complete = resolve; }) });
  const loading = late.load(); await settle();
  const texture = late.uniforms.map.value, version = texture.version;
  late.dispose(); complete({ close() { closed++; } });
  assert.equal(await loading, false);
  assert.equal(late.uniforms.ready.value, 0);
  assert.equal(texture.version, version, '迟到图集不得提交新的GPU上传');
  assert.equal(texture.image, null);
  assert.equal(closed, 1, '可显式释放的迟到图像应立即释放');
});

async function withBrowserImageLoader(run) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const original = THREE.ImageLoader.prototype.loadAsync;
  let calls = 0, complete;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
  THREE.ImageLoader.prototype.loadAsync = function () {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  };
  try { await run({ get calls() { return calls; }, complete: image => complete(image) }); }
  finally {
    THREE.ImageLoader.prototype.loadAsync = original;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  }
}

test('喷浪只在实际台风强度超过阈值时请求图集，反复更新和天气切换只请求一次', async () => {
  await withBrowserImageLoader(async loader => {
    const spray = createOceanSpray(new THREE.Scene());
    try {
      assert.equal(loader.calls, 0, '创建浪花不能开始下载');
      assert.equal(await spray.ready, false);
      for (const typhoon of [0, .005, .01, 0]) spray.update(.05, 1, { typhoon, rain: 1, storm: 1 }, [1, 0]);
      await settle(); assert.equal(loader.calls, 0);
      spray.update(.05, 2, { typhoon: .0101 }, [1, 0]);
      const pending = spray.ready;
      spray.update(.5, 3, { typhoon: 1 }, [1, 0]);
      spray.update(.5, 4, { typhoon: 0 }, [1, 0]);
      spray.update(.5, 5, { typhoon: 1 }, [1, 0]);
      await settle(); assert.equal(loader.calls, 1);
      assert.equal(spray.ready, pending);
      loader.complete({ width: 2, height: 2 });
      assert.equal(await pending, true);
      assert.equal(spray.points.material.uniforms.uSprayReady.value, 1);
      assert.ok(spray.points.material.fragmentShader.includes('float shape=vKind>1.5?sheet:mix(drop,mist,vKind)'),
        '下载前及失败时继续使用原程序化水片、水滴和水雾');
    } finally { spray.dispose(); }
  });
});

test('海面启动就绪不等待尚未发生的台风或浪花图片请求', async () => {
  await withBrowserImageLoader(async loader => {
    const ocean = createOcean(new THREE.Scene());
    try {
      assert.equal(loader.calls, 0);
      assert.equal(await ocean.ready, false);
      assert.equal(loader.calls, 0);
    } finally { ocean.dispose(); }
  });
});
