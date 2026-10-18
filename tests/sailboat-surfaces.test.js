import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSailboats} from '../src/models/sailboats.js';
const surfaces=await import('../src/sailboat-surfaces.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
const bundle=()=>Object.fromEntries(['cloth','wood'].map(kind=>[kind,{albedo:new THREE.Texture(),relief:new THREE.Texture()}]));
const all=b=>Object.values(b).flatMap(Object.values);
const released=b=>{const counts=new Map();for(const texture of all(b)){counts.set(texture,0);texture.addEventListener('dispose',()=>counts.set(texture,counts.get(texture)+1));}return()=>[...counts.values()];};
const parts=boats=>{const meshes=[];boats.group.traverse(o=>{if(o.isMesh)meshes.push(o);});return meshes;};

// A missing shared binding, replacement disposal, or late attachment must fail.
test('全船帆布与木材共享两套贴图，补全UV，保留原色与网格数量且替换退出恰好释放一次',()=>{
 const boats=createSailboats(new THREE.Scene(),{heightAt:()=>-30,seed:42}),first=bundle(),second=bundle(),a=released(first),b=released(second);
 try{
  const meshes=parts(boats),colors=meshes.map(o=>o.material.color.clone()),count=meshes.length;
  assert.equal(typeof boats.setSurfaceMaps,'function','船应接管共享贴图的生命周期');boats.setSurfaceMaps(first);boats.setSurfaceMaps(first);
  const cloth=meshes.filter(o=>o.name.includes('帆')&&!o.name.includes('桁')&&!o.name.includes('骨')&&!o.name.includes('桅与'));
  assert.ok(cloth.length>0);
  for(let i=0;i<meshes.length;i++){
   const mesh=meshes[i],kind=cloth.includes(mesh)?'cloth':'wood';
   assert.equal(mesh.material.map,first[kind].albedo);assert.equal(mesh.material.bumpMap,first[kind].relief);
   assert.ok(mesh.geometry.attributes.uv?.array.every(Number.isFinite),`${mesh.name}需要可用UV`);
   assert.deepEqual(mesh.material.color,colors[i],'贴图不得覆盖原涂装颜色');
  }
  assert.equal(parts(boats).length,count);assert.deepEqual(a(),[0,0,0,0]);
  boats.setSurfaceMaps(second);assert.deepEqual(a(),[1,1,1,1]);boats.dispose();boats.dispose();assert.deepEqual(b(),[1,1,1,1]);
  const late=bundle(),freed=released(late);boats.setSurfaceMaps(late);boats.setSurfaceMaps(late);assert.deepEqual(freed(),[1,1,1,1]);
 }finally{boats.dispose();}
});

test('图集左右材料分离且中性化保留白帆和深色涂装，凹凸为线性单通道',()=>{
 assert.equal(typeof surfaces?.createSailboatSurfaceMaps,'function');
 const rgba=new Uint8Array([20,20,20,255,240,240,240,255,40,40,40,255,200,200,200,255]);
 const maps=surfaces.createSailboatSurfaceMaps(rgba,4,1);
 try{
  assert.equal(maps.cloth.albedo.image.width,2);assert.equal(maps.wood.albedo.image.width,2);
  assert.ok(maps.cloth.albedo.image.data[0]>=220,'白帆不能被深色原图染脏');
  assert.ok(maps.wood.albedo.image.data[0]>=175,'木纹只适度调制原有涂装');
  assert.ok(maps.cloth.albedo.image.data[0]<maps.cloth.albedo.image.data[4]);
  assert.ok(maps.wood.albedo.image.data[0]<maps.wood.albedo.image.data[4]);
  for(const kind of ['cloth','wood']){assert.equal(maps[kind].albedo.colorSpace,THREE.SRGBColorSpace);assert.equal(maps[kind].relief.format,THREE.RedFormat);assert.equal(maps[kind].relief.colorSpace,THREE.NoColorSpace);}
 }finally{surfaces.disposeSailboatSurfaceMaps(maps);}
});

test('可选图集四秒超时和取消都回退，晚到源贴图只释放一次且不派生',async()=>{
 assert.equal(typeof surfaces?.loadSailboatSurfaces,'function');
 let finish,timeout;const atlas=new THREE.Texture();let freed=0;atlas.addEventListener('dispose',()=>freed++);
 const pending=surfaces.loadSailboatSurfaces({loadTexture:()=>new Promise(resolve=>finish=resolve),schedule:(callback,ms)=>{assert.equal(ms,4000);timeout=callback;return 1;},cancel:()=>{}});
 await Promise.resolve();timeout();assert.equal(await pending,null);finish(atlas);await new Promise(resolve=>setImmediate(resolve));assert.equal(freed,1);
 const controller=new AbortController();controller.abort();let calls=0;assert.equal(await surfaces.loadSailboatSurfaces({signal:controller.signal,loadTexture:()=>{calls++;return atlas;}}),null);assert.equal(calls,0);
});

test('首帧后的显式加载不阻塞建船，退出取消并释放晚到套件',async()=>{
 let resolve,calls=0;const boats=createSailboats(new THREE.Scene(),{heightAt:()=>-30,loadSurfaces:()=>{calls++;return new Promise(done=>resolve=done);}});
 assert.equal(calls,0,'创建模型时不得开始网络或canvas工作');assert.equal(typeof boats.loadSurfaces,'function');
 const pending=boats.loadSurfaces();assert.equal(calls,1);assert.equal(boats.loadSurfaces(),pending,'并发调用不能重复下载');
 const maps=bundle(),freed=released(maps);boats.dispose();resolve(maps);assert.equal(await pending,false);assert.deepEqual(freed(),[1,1,1,1]);
});

test('成功图集释放源图并只生成两套共享数据贴图，解析失败也释放源图',async()=>{
 assert.equal(typeof surfaces?.loadSailboatSurfaces,'function');
 const source=new THREE.DataTexture(new Uint8Array([0,0,0,255,255,255,255,255,80,80,80,255,180,180,180,255]),4,1);
 let freed=0;source.addEventListener('dispose',()=>freed++);
 const maps=await surfaces.loadSailboatSurfaces({loadTexture:async()=>source});
 assert.ok(maps?.cloth.albedo?.isDataTexture);assert.ok(maps?.wood.relief?.isDataTexture);assert.equal(freed,1);
 const count=released(maps);surfaces.disposeSailboatSurfaceMaps(maps);surfaces.disposeSailboatSurfaceMaps(maps);assert.deepEqual(count(),[1,1,1,1]);
 const broken=new THREE.Texture();let brokenFreed=0;broken.addEventListener('dispose',()=>brokenFreed++);
 assert.equal(await surfaces.loadSailboatSurfaces({loadTexture:async()=>broken}),null);assert.equal(brokenFreed,1);
});

test('外部取消阻止挂载晚到套件，保留已经接管的贴图直到船退出',async()=>{
 let finish,receivedSignal;const controller=new AbortController();
 const boats=createSailboats(new THREE.Scene(),{loadSurfaces:({signal})=>{receivedSignal=signal;return new Promise(resolve=>finish=resolve);}});
 const current=bundle(),oldFreed=released(current),late=bundle(),lateFreed=released(late);
 boats.setSurfaceMaps(current);const pending=boats.loadSurfaces({signal:controller.signal});controller.abort();
 assert.equal(receivedSignal.aborted,true);finish(late);assert.equal(await pending,false);assert.deepEqual(lateFreed(),[1,1,1,1]);assert.deepEqual(oldFreed(),[0,0,0,0]);
 for(const mesh of parts(boats))assert.ok(all(current).includes(mesh.material.map),'取消不能把晚到资源贴回船上');
 boats.dispose();assert.deepEqual(oldFreed(),[1,1,1,1]);
});
