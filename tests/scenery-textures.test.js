import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createIsland} from '../src/models/island.js';

test('山体与海岸岩石共享新贴图，替换及退出时恰好释放一次',()=>{
  const island=createIsland(new THREE.Scene()),first=new THREE.Texture(),second=new THREE.Texture();
  let firstReleased=0,secondReleased=0;
  first.addEventListener('dispose',()=>firstReleased++);second.addEventListener('dispose',()=>secondReleased++);
  try{
    assert.equal(typeof island.setRockMap,'function','山石材质尚未接入新贴图');
    const shaders=['连续海床与火山岛','海岸玄武岩-1'].map(name=>{
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      island.group.getObjectByName(name).material.onBeforeCompile(shader);return shader;
    });
    island.setRockMap(first);
    for(const shader of shaders){assert.equal(shader.uniforms.uRockMap.value,first);assert.equal(shader.uniforms.uRockMapEnabled.value,1);}
    island.setRockMap(first);assert.equal(firstReleased,0,'重复设置不能释放正在使用的贴图');
    island.setRockMap(second);assert.equal(firstReleased,1);
    for(const shader of shaders)assert.equal(shader.uniforms.uRockMap.value,second);
    island.dispose();island.dispose();assert.equal(secondReleased,1);
  }finally{island.dispose();}
});

test('海沙、泻湖沙底与石阶按区域共享贴图，替换与退出不重复释放',()=>{
  const island=createIsland(new THREE.Scene());
  const names=['连续海床与火山岛','环岛沙土与登山小径','山径天然石阶'];
  const shaders=names.map(name=>{
    const mesh=island.group.getObjectByName(name);assert.ok(mesh,name);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    mesh.material.onBeforeCompile(shader);return shader;
  });
  const maps=Object.fromEntries(['sand','lagoon','stone'].map(name=>[name,new THREE.Texture()]));
  const releases={sand:0,lagoon:0,stone:0};
  for(const [name,map]of Object.entries(maps))map.addEventListener('dispose',()=>releases[name]++);
  try{
    assert.equal(typeof island.setCoastalMaps,'function');
    island.setCoastalMaps(maps);island.setCoastalMaps(maps);
    for(const shader of shaders){
      assert.equal(shader.uniforms.uSandMap.value,maps.sand);
      assert.equal(shader.uniforms.uLagoonMap.value,maps.lagoon);
      assert.equal(shader.uniforms.uStepMap.value,maps.stone);
    }
    const replacement=new THREE.Texture();let freed=0;replacement.addEventListener('dispose',()=>freed++);
    island.setCoastalMaps({...maps,sand:replacement});
    assert.deepEqual(releases,{sand:1,lagoon:0,stone:0});
    island.setCoastalMaps({sand:null});
    assert.equal(shaders[0].uniforms.uSandMapEnabled.value,0);
    assert.equal(shaders[0].uniforms.uLagoonMapEnabled.value,1,'单张海沙失败不禁用已加载的泻湖纹理');
    island.dispose();island.dispose();
    assert.deepEqual(releases,{sand:1,lagoon:1,stone:1});assert.equal(freed,1);
    const late=new THREE.Texture();let lateFreed=0;late.addEventListener('dispose',()=>lateFreed++);
    island.setCoastalMaps({sand:late});assert.equal(lateFreed,1,'退出后才加载完的贴图也要释放');
  }finally{island.dispose();}
});

test('细软沙滩只在礁石附近留下少量小碎砾，主沙面不再铺满碎石',()=>{
  const island=createIsland(new THREE.Scene());
  try {
    const pebbles=island.group.getObjectByName('沙滩细砾');
    assert.ok(pebbles.count>0&&pebbles.count<=64);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
    for(let i=0;i<pebbles.count;i++){
      pebbles.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
      assert.ok(Math.max(scale.x,scale.y,scale.z)<.085,'碎砾缩到几厘米，不能像撒满大颗石子');
    }
  }finally{island.dispose();}
});
