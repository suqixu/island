import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIsland } from '../src/models/island.js';
import { createLighthouse } from '../src/models/lighthouse.js';
import { createRestPavilion } from '../src/models/rest-pavilion.js';

const surfaces = await import('../src/structure-surfaces.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const pixels = { width: 4, height: 2, data: Uint8Array.from([
  255,0,0,255, 255,0,0,255, 80,70,60,255, 160,150,140,255,
  255,0,0,255, 255,0,0,255, 120,110,100,255, 200,190,180,255,
]) };
const compile = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};

test('码头只裁一次图集右半木纹，颜色和单通道凹凸分别有独立纹理', () => {
  assert.equal(typeof surfaces.createStructureSurfaceMaps, 'function');
  const maps = surfaces.createStructureSurfaceMaps(pixels, { rightHalf: true });
  assert.equal(maps.albedo.image.width, 2); assert.equal(maps.albedo.image.height, 2);
  assert.deepEqual([...maps.albedo.image.data], [80,70,60,255,160,150,140,255,120,110,100,255,200,190,180,255]);
  assert.equal(maps.relief.format, THREE.RedFormat);
  assert.equal(maps.relief.image.data.length, 4);
  assert.ok(maps.relief.image.data[1] > maps.relief.image.data[0]);
  assert.notEqual(maps.albedo, maps.relief);
  assert.equal(maps.albedo.colorSpace, THREE.SRGBColorSpace);
  for (const map of Object.values(maps)) map.dispose();
});

test('码头和灯塔替换、重复设置与退出后晚到的纹理均恰好释放一次，灯光造型不变', () => {
  const island = createIsland(new THREE.Scene());
  const tower = createLighthouse(new THREE.Scene(), { heightAt: () => 12, position: { x: 0, z: 0 } });
  const first = { albedo: new THREE.Texture(), relief: new THREE.Texture() };
  const replacement = { albedo: new THREE.Texture(), relief: new THREE.Texture() };
  const nextDock = { albedo: new THREE.Texture(), relief: new THREE.Texture() };
  const late = { albedo: new THREE.Texture(), relief: new THREE.Texture() };
  const released = new Map();
  for (const map of [...Object.values(first), ...Object.values(replacement), ...Object.values(nextDock), ...Object.values(late)]) {
    released.set(map, 0); map.addEventListener('dispose', () => released.set(map, released.get(map) + 1));
  }
  const countMeshes = group => { let count = 0; group.traverse(object => { if (object.isMesh) count++; }); return count; };
  try {
    assert.equal(typeof island.setDockMaps, 'function');
    assert.equal(typeof tower.setSurfaceMaps, 'function');
    const before = [countMeshes(island.group), countMeshes(tower.group)];
    const dockShaders = ['独立木铺板', '水下木桩'].map(name => compile(island.group.getObjectByName(name).material));
    const towerShader = compile(tower.group.getObjectByName('灯塔旧石灰塔身').material);
    island.setDockMaps(first); island.setDockMaps(first);
    tower.setSurfaceMaps(replacement); tower.setSurfaceMaps(replacement);
    for (const shader of dockShaders) {
      assert.equal(shader.uniforms.uStructureAlbedo.value, first.albedo);
      assert.equal(shader.uniforms.uStructureRelief.value, first.relief);
    }
    assert.equal(towerShader.uniforms.uStructureAlbedo.value, replacement.albedo);
    assert.deepEqual([countMeshes(island.group), countMeshes(tower.group)], before);
    island.setDockMaps(nextDock);
    assert.equal(released.get(first.albedo), 1); assert.equal(released.get(first.relief), 1);
    for (const shader of dockShaders) assert.equal(shader.uniforms.uStructureAlbedo.value, nextDock.albedo);
    island.setDockMaps({ albedo: null, relief: null });
    tower.update(10, { daylight: 0 });
    const strength = tower.group.getObjectByName('灯塔灯室暖灯').intensity;
    tower.setQuality('low'); tower.update(10, { daylight: 0 });
    assert.equal(tower.group.getObjectByName('灯塔灯室暖灯').intensity, strength);
    island.dispose(); tower.dispose(); island.dispose(); tower.dispose();
    island.setDockMaps(late); island.setDockMaps(late);
    for (const [map, count] of released) assert.equal(count, 1, map.uuid);
  } finally { island.dispose(); tower.dispose(); }
});

test('结构贴图每次等待上限四秒，重试一次后保留原程序材质', async () => {
  const tasks = new Map(), delays = [];
  let id = 0, attempts = 0;
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const pending = surfaces.loadLighthouseSurfaces({
    readPixels: () => { attempts++; return new Promise(() => {}); },
    schedule(callback, delay) { delays.push(delay); tasks.set(++id, callback); return id; },
    cancel(token) { tasks.delete(token); },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await settle();
    const callbacks = [...tasks.values()]; tasks.clear(); callbacks.forEach(callback => callback());
  }
  assert.deepEqual(await pending, { albedo: null, relief: null });
  assert.deepEqual(delays, [4000, 4000]); assert.equal(attempts, 2);
  assert.equal(tasks.size, 0);
});

test('结构贴图取消后迟到的颜色和凹凸不重新接入，两个加载器不会共享纹理对象', async () => {
  assert.equal(typeof surfaces.loadDockSurfaces, 'function');
  const first = await surfaces.loadDockSurfaces({ readPixels: async () => pixels });
  const second = await surfaces.loadLighthouseSurfaces({ readPixels: async () => pixels });
  assert.notEqual(first.albedo, second.albedo); assert.notEqual(first.relief, second.relief);
  for (const map of [...Object.values(first), ...Object.values(second)]) map.dispose();
  let finish, disposals = 0;
  const controller = new AbortController(), previous = THREE.Texture.prototype.dispose;
  THREE.Texture.prototype.dispose = function () { disposals++; return previous.call(this); };
  try {
    const pending = surfaces.loadDockSurfaces({ signal: controller.signal, readPixels: () => new Promise(resolve => { finish = resolve; }) });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    controller.abort();
    assert.deepEqual(await pending, { albedo: null, relief: null });
    finish(pixels);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(disposals, 2);
  } finally { THREE.Texture.prototype.dispose = previous; }
});

test('灯塔入口石阶与山路共用石阶贴图和着色方式，由海岛统一释放纹理', () => {
  const island = createIsland(new THREE.Scene());
  const tower = createLighthouse(new THREE.Scene(), { heightAt: () => 12, position: {x:0,z:0}, approach:{x:5,y:12.038,z:0} });
  const stone = new THREE.Texture(); let released = 0;
  stone.addEventListener('dispose', () => released++);
  try {
    const steps = tower.group.children.filter(object => object.name.startsWith('灯塔入口石阶 '));
    assert.ok(steps.length > 0, '检查真实入口踏步');
    const mountain = island.group.getObjectByName('山径天然石阶').material;
    const step = steps[0].material, pathShader = compile(mountain), stepShader = compile(step);
    const meshCount = tower.group.children.length;
    island.setCoastalMaps({stone}); tower.setStepMap(stone); tower.setStepMap(stone);
    assert.equal(pathShader.uniforms.uStepMap.value, stepShader.uniforms.uStepMap.value);
    assert.equal(stepShader.uniforms.uStepMap.value, stone);
    assert.equal(step.customProgramCacheKey(), mountain.customProgramCacheKey());
    assert.ok(steps.every(mesh => mesh.material === step), '踏面、立面和侧面共用同一材质');
    assert.equal(tower.group.getObjectByName('灯塔贴坡石基').material, step);
    tower.update(10, {rain:.8,season:'winter'});
    assert.equal(stepShader.uniforms.uLandWetness.value, .8);
    assert.equal(stepShader.uniforms.uPathSnow.value, .85);
    assert.equal(tower.group.children.length, meshCount);
    tower.setStepMap(null); assert.equal(stepShader.uniforms.uStepMapEnabled.value, 0);
    assert.equal(released, 0, '暂时禁用纹理也不能销毁海岛仍在使用的共享资源');
    tower.setStepMap(stone); tower.dispose(); tower.setStepMap(stone);
    assert.equal(released, 0);
    island.dispose(); assert.equal(released, 1);
  } finally { tower.dispose(); island.dispose(); }
});

test('两座亭子共用借用木纹和瓦面，保留朱红木漆且单独移除不会销毁共享资源', () => {
  const first=createRestPavilion(new THREE.Scene(),{heightAt:()=>12,position:{x:0,z:0}});
  const second=createRestPavilion(new THREE.Scene(),{heightAt:()=>12,position:{x:10,z:0}});
  const owner=surfaces.createStructureSurfaceState(),wood=surfaces.createStructureSurfaceMaps(pixels),roof=surfaces.createStructureSurfaceMaps(pixels);
  let released=0;for(const map of [...Object.values(wood),...Object.values(roof)])map.addEventListener('dispose',()=>released++);
  owner.setMaps(roof);
  try {
    const names=['山亭旧木柱','山亭木梁与斜撑','山亭架空木台地板','山亭弧瓦屋顶','山亭瓦垄与屋脊'];
    const shaders=[first,second].map(pavilion=>names.map(name=>compile(pavilion.group.getObjectByName(name).material)));
    const original=first.group.getObjectByName(names[0]).material.color.clone(),count=first.group.children.length;
    for(const pavilion of [first,second])pavilion.setSurfaceMaps({wood,roof});
    for(const group of shaders)for(let i=0;i<group.length;i++)assert.equal(group[i].uniforms.uStructureAlbedo.value,i<3?wood.albedo:roof.albedo);
    assert.ok(first.group.getObjectByName(names[0]).material.color.equals(original),'贴图不能覆盖朱红漆的基色');
    assert.equal(first.group.children.length,count,'纹理不新增模型');
    first.setSurfaceMaps({wood:null});assert.equal(shaders[0][0].uniforms.uStructureEnabled.value,0);
    assert.equal(shaders[1][0].uniforms.uStructureEnabled.value,1);assert.equal(released,0);
    first.setSurfaceMaps({wood});
    first.dispose();first.setSurfaceMaps({wood,roof});assert.equal(released,0);
    assert.equal(shaders[1][0].uniforms.uStructureEnabled.value,1);
    second.dispose();assert.equal(released,0);
    owner.dispose();assert.equal(released,2);for(const map of Object.values(wood))map.dispose();assert.equal(released,4);
  } finally {first.dispose();second.dispose();owner.dispose();}
});
