import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createIslandCave} from '../src/models/island-cave.js';
import {createIsland} from '../src/models/island.js';

const surface=await import('../src/cave-surface.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
const maps=()=>Object.fromEntries(['albedo','relief','roughness'].map(name=>[name,new THREE.Texture()]));
const releases=bundle=>{const count={};for(const [name,map]of Object.entries(bundle)){count[name]=0;map.addEventListener('dispose',()=>count[name]++);}return count;};
const compile=material=>{const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);return shader;};

// 把新照片只贴到洞口、重复设置误释放、替换不更新已编译 shader 都会失败。
test('照片bundle共享给洞口、内壁、地面和碎石，重复设置不释放，替换同步已有shader且不重编译',()=>{
  const cave=createIslandCave(new THREE.Group()),first=maps(),second=maps(),a=releases(first),b=releases(second);
  try{
    assert.equal(typeof cave.setSurfaceMaps,'function','山洞应暴露照片材质入口');
    const meshes=['厚岩拱与裂隙洞口','天然岩洞内壁','洞穴坡口与地面','洞口岩块与地面碎石'].map(name=>cave.group.getObjectByName(name));
    const materials=[...new Set(meshes.map(mesh=>mesh.material))],shaders=materials.map(compile),versions=materials.map(material=>material.version);
    const depthColors=cave.group.getObjectByName('天然岩洞内壁').geometry.attributes.color.array.slice();
    cave.setSurfaceMaps(first);cave.setSurfaceMaps(first);
    for(const mesh of meshes){assert.equal(mesh.material.map,first.albedo);assert.equal(mesh.material.bumpMap,first.relief);assert.equal(mesh.material.roughnessMap,first.roughness);}
    for(const shader of shaders){assert.equal(shader.uniforms.caveRockRelief.value,first.relief);assert.equal(shader.uniforms.caveRockRoughness.value,first.roughness);assert.equal(shader.uniforms.cavePhotoEnabled.value,1);}
    assert.deepEqual(a,{albedo:0,relief:0,roughness:0});
    cave.setSurfaceMaps(second);assert.deepEqual(a,{albedo:1,relief:1,roughness:1});
    for(let i=0;i<materials.length;i++){assert.equal(materials[i].version,versions[i]);assert.equal(shaders[i].uniforms.caveRockRelief.value,second.relief);}
    assert.deepEqual(cave.group.getObjectByName('天然岩洞内壁').geometry.attributes.color.array,depthColors,'照片不能消除洞内原有深度遮光');
    cave.dispose();cave.dispose();assert.deepEqual(b,{albedo:1,relief:1,roughness:1});
    cave.setSurfaceMaps(second);assert.deepEqual(b,{albedo:1,relief:1,roughness:1});
    const late=maps(),lateCount=releases(late);cave.setSurfaceMaps(late);cave.setSurfaceMaps(late);assert.deepEqual(lateCount,{albedo:1,relief:1,roughness:1});
  }finally{cave.dispose();}
});

test('照片取消时回到程序纹理，部分替换和贴图别名只释放不再使用的资源一次',()=>{
  const cave=createIslandCave(new THREE.Group()),first=maps(),count=releases(first),mesh=cave.group.getObjectByName('天然岩洞内壁'),fallback=mesh.material.map;
  try{
    assert.equal(typeof cave.setSurfaceMaps,'function');cave.setSurfaceMaps(first);
    const replacement=new THREE.Texture();let freed=0;replacement.addEventListener('dispose',()=>freed++);
    cave.setSurfaceMaps({...first,albedo:replacement});assert.deepEqual(count,{albedo:1,relief:0,roughness:0});
    cave.setSurfaceMaps(null);assert.equal(mesh.material.map,fallback);assert.equal(freed,1);assert.deepEqual(count,{albedo:1,relief:1,roughness:1});
    const alias=new THREE.Texture();let aliases=0;alias.addEventListener('dispose',()=>aliases++);
    cave.setSurfaceMaps({albedo:alias,relief:alias,roughness:alias});cave.dispose();assert.equal(aliases,1);
  }finally{cave.dispose();}
});

test('岛屿转交山洞贴图并由洞生命周期接管，退出和晚到均恰好释放一次',()=>{
  const island=createIsland(new THREE.Scene()),bundle=maps(),count=releases(bundle);
  try{
    assert.equal(typeof island.setCaveMaps,'function');island.setCaveMaps(bundle);island.dispose();island.dispose();assert.deepEqual(count,{albedo:1,relief:1,roughness:1});
    const late=maps(),freed=releases(late);island.setCaveMaps(late);assert.deepEqual(freed,{albedo:1,relief:1,roughness:1});
  }finally{island.dispose();}
});

test('照片派生线性单通道凹凸与粗糙度，裂缝粗糙，局部暗湿区适度反光',()=>{
  assert.equal(typeof surface?.createCaveDetailMaps,'function');
  // 裂缝：[浅色, 深色, 浅色]；湿润片：邻域一致的中暗灰，不能把裂缝当镜面。
  const values=[180,20,180,180,20,180,70,70,70],rgba=new Uint8ClampedArray(values.flatMap(v=>[v,v,v,255]));
  const bundle=surface.createCaveDetailMaps(rgba,3,3);
  try{
    assert.equal(bundle.relief.format,THREE.RedFormat);assert.equal(bundle.roughness.format,THREE.RedFormat);
    assert.equal(bundle.relief.colorSpace,THREE.NoColorSpace);assert.equal(bundle.roughness.colorSpace,THREE.NoColorSpace);
    assert.ok(bundle.roughness.image.data[1]>bundle.roughness.image.data[7],'裂缝不能比湿润小片更光滑');
    assert.ok(bundle.roughness.image.data[7]>=140,'湿润小片仍应保持粗糙石材');
    assert.ok(bundle.relief.image.data[1]<bundle.relief.image.data[0]);
  }finally{surface.disposeCaveSurfaceMaps(bundle);}
});

test('可选照片加载超时回退并释放晚到结果，取消不挂载，成功图为SRGB且可平铺',async()=>{
  assert.equal(typeof surface?.loadCaveSurface,'function');
  let finish,timeout;const late=new THREE.Texture();let freed=0;late.addEventListener('dispose',()=>freed++);
  const pending=surface.loadCaveSurface({loadTexture:()=>new Promise(resolve=>finish=resolve),schedule:callback=>{timeout=callback;return 1;},cancel:()=>{}});
  await Promise.resolve();timeout();assert.equal(await pending,null);finish(late);await new Promise(resolve=>setImmediate(resolve));assert.equal(freed,1);
  const controller=new AbortController();controller.abort();let calls=0;
  assert.equal(await surface.loadCaveSurface({signal:controller.signal,loadTexture:()=>{calls++;return new THREE.Texture();}}),null);assert.equal(calls,0);
  const albedo=new THREE.Texture(),result=await surface.loadCaveSurface({loadTexture:async()=>albedo});
  assert.equal(result.albedo,albedo);assert.equal(albedo.colorSpace,THREE.SRGBColorSpace);assert.equal(albedo.wrapS,THREE.RepeatWrapping);surface.disposeCaveSurfaceMaps(result);
});

test('洞口外拱和前8外侧石块借用山体贴图，洞内地面保留洞图，替换及洞退出不释放借用资源',()=>{
  const cave=createIslandCave(new THREE.Group()),mountain=new THREE.Texture(),replacement=new THREE.Texture(),bundle=maps();let freed=0,nextFreed=0;
  mountain.addEventListener('dispose',()=>freed++);replacement.addEventListener('dispose',()=>nextFreed++);
  try{
    assert.equal(typeof cave.setMountainMap,'function');
    const portal=cave.group.getObjectByName('厚岩拱与裂隙洞口'),wall=cave.group.getObjectByName('天然岩洞内壁'),floor=cave.group.getObjectByName('洞穴坡口与地面'),rocks=cave.group.getObjectByName('洞口岩块与地面碎石');
    const shaders=[portal,wall,floor,rocks].map(mesh=>compile(mesh.material)),versions=[portal.material.version,floor.material.version];
    cave.setMountainMap(mountain);cave.setSurfaceMaps(bundle);
    for(const shader of shaders){assert.equal(shader.uniforms.caveMountainMap.value,mountain);assert.equal(shader.uniforms.caveMountainEnabled.value,1);}
    assert.ok(portal.geometry.attributes.aCaveExterior.array.some(value=>value===1));assert.ok(portal.geometry.attributes.aCaveExterior.array.some(value=>value===0),'拱口内部仍用洞图');
    assert.ok(wall.geometry.attributes.aCaveExterior.array.every(value=>value===0));assert.ok(floor.geometry.attributes.aCaveExterior.array.every(value=>value===0));
    const exterior=rocks.geometry.attributes.aCaveExterior;assert.ok(exterior.isInstancedBufferAttribute);assert.equal(exterior.count,rocks.count);
    assert.deepEqual([...exterior.array.slice(0,8)],Array(8).fill(1));assert.ok(exterior.array.slice(8).every(value=>value===0));
    assert.equal(wall.material.map,bundle.albedo);assert.equal(floor.material.map,bundle.albedo);
    cave.setMountainMap(replacement);assert.equal(freed,0);assert.equal(shaders[0].uniforms.caveMountainMap.value,replacement);
    assert.deepEqual([portal.material.version,floor.material.version],versions);
    cave.dispose();cave.setMountainMap(mountain);assert.equal(freed,0);assert.equal(nextFreed,0);
  }finally{cave.dispose();mountain.dispose();replacement.dispose();}
});

test('岛屿setRockMap同步洞外山体借用图，替换/重复设置/晚到各释放一次',()=>{
  const island=createIsland(new THREE.Scene()),first=new THREE.Texture(),second=new THREE.Texture();let a=0,b=0;
  first.addEventListener('dispose',()=>a++);second.addEventListener('dispose',()=>b++);
  try{
    const portal=island.group.getObjectByName('厚岩拱与裂隙洞口'),shader=compile(portal.material);
    island.setRockMap(first);island.setRockMap(first);assert.equal(shader.uniforms.caveMountainMap?.value,first);assert.equal(a,0);
    island.setRockMap(second);assert.equal(a,1);assert.equal(shader.uniforms.caveMountainMap.value,second);
    island.dispose();island.dispose();assert.equal(b,1);
    const late=new THREE.Texture();let c=0;late.addEventListener('dispose',()=>c++);island.setRockMap(late);island.setRockMap(late);assert.equal(c,1);
  }finally{island.dispose();}
});
