import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const module=await import('../src/cloud-texture-pool.js').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});
function setup(){
  assert.equal(typeof module.createCloudTexturePool,'function');
  let resolve,loads=0;const pending=new Promise(done=>{resolve=done;});
  const base=Array.from({length:8},()=>new THREE.Texture());
  const extra=Array.from({length:56},()=>new THREE.Texture());
  const applied=[];
  const pool=module.createCloudTexturePool({defaultMaps:base,loadAdditional:()=>{loads++;return pending;},apply:maps=>applied.push(maps)});
  return {pool,base,extra,applied,resolve,get loads(){return loads;}};
}
test('额外云图按需只加载一次，少中多切换复用64种云形',async()=>{
  const f=setup();f.pool.select(false);assert.equal(f.loads,0);
  const pending=f.pool.select(true);f.pool.select(true);assert.equal(f.loads,1);
  f.resolve(f.extra);await pending;
  assert.equal(f.applied.at(-1).length,64);
  f.pool.select(false);assert.equal(f.applied.at(-1),f.base);
  await f.pool.select(true);assert.equal(f.loads,1);assert.equal(f.applied.at(-1).length,64);
  f.pool.dispose();[...f.base,...f.extra].forEach(map=>map.dispose());
});
test('加载中切回默认，迟到的全部云图不能覆盖当前选择',async()=>{
  const f=setup(),pending=f.pool.select(true);f.pool.select(false);
  f.resolve(f.extra);await pending;
  assert.equal(f.applied.at(-1),f.base);
  f.pool.dispose();[...f.base,...f.extra].forEach(map=>map.dispose());
});
test('退出后的迟到云图释放一次，不再交给已销毁的场景',async()=>{
  const f=setup(),counts=new Map();
  f.extra.forEach(map=>map.addEventListener('dispose',()=>counts.set(map,(counts.get(map)??0)+1)));
  const pending=f.pool.select(true);f.pool.dispose();f.resolve(f.extra);await pending;
  assert.equal(f.applied.length,0);
  assert.ok(f.extra.every(map=>counts.get(map)===1));
  f.base.forEach(map=>map.dispose());
});
