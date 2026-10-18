import test from 'node:test';
import assert from 'node:assert/strict';
import * as cloud from '../src/cloud-texture.js';
import * as THREE from 'three';
import {existsSync} from 'node:fs';

test('可逐张加载八张图集，每张保留八种共享来源的云形', async t => {
  const requests = [];
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async url => {
    requests.push(url);
    return new THREE.Texture({width: 1774, height: 887});
  });
  const kinds = ['cumulus', 'cumulus', 'tower', 'cumulus', 'altocumulus', 'cirrus', 'cumulus', 'altocumulus'];
  for (let sheet = 0; sheet < 8; sheet++) {
    const before = requests.length;
    const maps = await cloud.loadCloudTextures({atlas: sheet + 1,random: () => 0});
    assert.equal(requests.length - before, 1, '指定单张时不能预加载其他图集');
    assert.ok(requests.at(-1).endsWith(`/cloud-atlas-v${sheet + 1}.webp`));
    assert.ok(existsSync(new URL(requests.at(-1))), '随机选中的发布素材必须存在');
    assert.equal(maps.length, 8);
    assert.equal(new Set(maps.map(map => map.source)).size, 1, '八个裁切必须共享同一图像来源');
    maps.forEach((map, cell) => {
      assert.equal(map.userData.cloudId, sheet * 8 + cell);
      assert.equal(map.userData.cloudKind, kinds[cell]);
      assert.equal(map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(map.generateMipmaps, false);
      assert.deepEqual(map.repeat.toArray(), [.248, .496]);
      assert.deepEqual(map.offset.toArray(), [(cell % 4) * .25 + .001, cell < 4 ? .502 : .002]);
      map.dispose();
    });
  }
});

test('指定图集加载失败后重试同一张，仍失败则返回空结果保持无云', async t => {
  const requests = [];
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async url => {
    requests.push(url);
    throw new Error('模拟图集不可用');
  });
  t.mock.method(console, 'warn', () => {});
  const maps = await cloud.loadCloudTextures({atlas:8,random: () => .92});
  assert.equal(maps, undefined);
  assert.ok(requests.length >= 2, '加载失败需要重试');
  assert.ok(requests.every(url => url.endsWith('/cloud-atlas-v8.webp')), '重试不能额外加载其他图集');
});

test('默认只加载v1，启用全部时仅补充七张图集，合并后包含64种云形',async t=>{
  const requests=[];
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{
    requests.push(url);return new THREE.Texture({width:1774,height:887});
  });
  const base=await cloud.loadCloudTextures({random:()=>.99});
  assert.equal(requests.length,1);assert.ok(requests[0].endsWith('/cloud-atlas-v1.webp'));
  const additions=await cloud.loadCloudTextures({atlas:'additional'});
  assert.equal(requests.length,8);assert.equal(new Set(requests).size,8);
  const all=[...base,...additions];
  assert.equal(all.length,64);assert.equal(new Set(all.map(map=>map.userData.cloudId)).size,64);
  assert.equal(new Set(all.map(map=>map.source)).size,8);
  all.forEach(map=>map.dispose());
});

test('补充图集有单张失败时，已完成的同批纹理全部释放，不留下半组资源',async t=>{
  const completed=[];
  t.mock.method(THREE.TextureLoader.prototype,'loadAsync',async url=>{
    if(url.endsWith('/cloud-atlas-v5.webp'))throw new Error('模拟单张失败');
    const texture=new THREE.Texture(),entry={texture,disposed:0};
    texture.addEventListener('dispose',()=>entry.disposed++);completed.push(entry);return texture;
  });
  t.mock.method(console,'warn',()=>{});
  assert.equal(await cloud.loadCloudTextures({atlas:'additional'}),undefined);
  assert.ok(completed.length>=6);assert.ok(completed.every(entry=>entry.disposed===1));
});

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
