import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/ocean.js';

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
    assert.equal(await ocean.ready, false, '无浏览器图像解码环境时保留程序泡沫');
  } finally { ocean.dispose(); }
});
