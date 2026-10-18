import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let foam;
try { foam = await import('../src/ocean-foam.js'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('泡沫遮罩读取实际透明度，忽略透明区域残留的黑白RGB，不生成不透明方块', () => {
  assert.equal(typeof foam?.extractFoamMask, 'function');
  const rgba = new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 64,
    20, 80, 180, 128, 255, 255, 255, 255]);
  assert.deepEqual(foam.extractFoamMask({ data: rgba, width: 2, height: 2 }),
    new Uint8Array([0, 64, 128, 255]));
  assert.throws(() => foam.extractFoamMask({ data: rgba, width: 3, height: 2 }), RangeError);
});

test('海面复用一张有限尺寸的单通道泡沫纹理，逐帧更新不重新上传并在退出时释放一次', async () => {
  const ocean = createOcean(new THREE.Scene());
  try {
    const map = ocean.mesh.material.uniforms.uFoamMap?.value;
    assert.ok(map?.isDataTexture, '海面材质必须实际使用泡沫遮罩');
    assert.equal(map.format, THREE.RedFormat);
    assert.equal(map.image.data.length, map.image.width * map.image.height);
    assert.ok(map.image.data.byteLength <= 512 * 512, '基础纹理限于256KiB');
    assert.equal(map.generateMipmaps, true, '远景泡沫需要mipmap防止碎点闪烁');
    const initialVersion = map.version;
    for (let time = 0; time <= 10; time++) ocean.update(time, { daylight: 1, wind: .3 });
    assert.equal(ocean.mesh.material.uniforms.uFoamMap.value, map);
    assert.equal(map.version, initialVersion, '动画只能改变采样坐标，不能逐帧重传贴图');
    let textureReleases = 0, geometryReleases = 0;
    map.addEventListener('dispose', () => textureReleases++);
    ocean.mesh.geometry.addEventListener('dispose', () => geometryReleases++);
    ocean.dispose(); ocean.dispose();
    assert.equal(textureReleases, 1);
    assert.equal(geometryReleases, 1);
    assert.equal(await ocean.ready, false, '本地模块没有可请求的HTTP资源时保留程序泡沫');
  } finally { ocean.dispose(); }
});

test('预烘焙R8文件直接填充现有海面纹理，无需图像解码或画布', async () => {
  const pixels = new Uint8Array(512 * 512);
  pixels.set([0, 64, 128, 255]);
  let requested;
  const resource = foam.createOceanFoamTexture({
    fetchMask: async (url, { signal }) => { requested = { url, signal }; return { ok: true, arrayBuffer: async () => pixels.buffer }; },
  });
  try {
    const initialVersion = resource.texture.version;
    assert.equal(await resource.ready, true, '二进制遮罩不应依赖document/createImageBitmap');
    assert.ok(requested.url.endsWith('/ocean-foam-mask-v1.bin'));
    assert.equal(requested.signal.aborted, false);
    assert.deepEqual(resource.texture.image.data, pixels);
    assert.equal(resource.texture.version, initialVersion + 1, '完成加载后只触发一次上传');
  } finally { resource.dispose(); }
});

test('遮罩请求失败、响应失败及长度非法时保留初始纹理', async () => {
  const loads = [
    async () => { throw new Error('离线'); },
    async () => ({ ok: false, arrayBuffer: async () => { throw new Error('失败响应不应读正文'); } }),
    async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
    async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(512 * 512 + 1) }),
  ];
  for (const fetchMask of loads) {
    const resource = foam.createOceanFoamTexture({ fetchMask });
    try {
      const initialVersion = resource.texture.version;
      assert.equal(await resource.ready, false);
      assert.equal(resource.texture.version, initialVersion);
      assert.equal(resource.texture.image.data.some(value => value !== 0), false);
    } finally { resource.dispose(); }
  }
});

test('释放会取消请求，忽略晚到的正文并且只释放一次纹理', async () => {
  let finishBody, requestSignal;
  const resource = foam.createOceanFoamTexture({
    fetchMask: async (_url, { signal }) => {
      requestSignal = signal;
      return { ok: true, arrayBuffer: () => new Promise(resolve => { finishBody = resolve; }) };
    },
  });
  await Promise.resolve();
  assert.equal(typeof finishBody, 'function', '正文读取已经启动');
  let releases = 0;
  resource.texture.addEventListener('dispose', () => releases++);
  const initialVersion = resource.texture.version;
  resource.dispose(); resource.dispose();
  assert.equal(requestSignal.aborted, true);
  finishBody(new Uint8Array(512 * 512).fill(255).buffer);
  assert.equal(await resource.ready, false);
  assert.equal(resource.texture.version, initialVersion);
  assert.equal(resource.texture.image.data.some(value => value !== 0), false);
  assert.equal(releases, 1);
});

test('外部取消覆盖请求中和请求前两种状态', async () => {
  const controller = new AbortController();
  let requestSignal, finishResponse;
  const resource = foam.createOceanFoamTexture({ signal: controller.signal,
    fetchMask: (_url, { signal }) => { requestSignal = signal; return new Promise(resolve => { finishResponse = resolve; }); },
  });
  controller.abort(new Error('场景初始化取消'));
  assert.equal(requestSignal?.aborted, true);
  finishResponse({ ok: true, arrayBuffer: async () => new Uint8Array(512 * 512).fill(255).buffer });
  assert.equal(await resource.ready, false);
  assert.equal(resource.texture.image.data.some(value => value !== 0), false);
  resource.dispose();
  const cancelled = foam.createOceanFoamTexture({ signal: controller.signal,
    fetchMask: () => { throw new Error('预先取消时不应启动请求'); },
  });
  assert.equal(await cancelled.ready, false);
  cancelled.dispose();
});

test('发布的遮罩保留原Chrome流程的512×512个R8字节与透明度层次', async () => {
  const bytes = await readFile(new URL('../src/assets/textures/water/ocean-foam-mask-v1.bin', import.meta.url));
  assert.equal(bytes.length, 512 * 512);
  assert.ok(bytes.includes(0) && bytes.some(value => value > 240));
  assert.ok(bytes.some(value => value > 0 && value < 255), '边缘保留连续透明度');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '70a12fd51d284bbb0b639bc4f434c9fb05fbf878b0aae36d837585de78362f96');
});
