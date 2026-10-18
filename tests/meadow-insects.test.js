import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { seededRandom } from '../src/terrain.js';
import { createFlowerButterflies } from '../src/flower-butterflies.js';

const api = await import('../src/meadow-insects.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const day = { season: 'summer', daylight: 1, rain: 0, snow: 0, snowCover: 0, windSpeed: 5 };
function sites(count=12) {
  return Array.from({length:count},(_,i)=>({ available:()=>true,
    sample(time,target){return target.set(10+i%4*2+Math.sin(time)*.04,3,8+Math.floor(i/4)*2);} }));
}
function create(options={}) {
  assert.equal(typeof api.createMeadowInsects,'function','需要蜜蜂和蜻蜓的真实场景实现');
  return api.createMeadowInsects(new THREE.Group(),{anchors:sites(),heightAt:()=>2,random:seededRandom(104),...options});
}
function pose(effect,name,index=0) {
  const mesh=effect.group.getObjectByName(name),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  mesh.getMatrixAt(index,matrix);matrix.decompose(position,rotation,scale);return {position,size:scale.x};
}
function advance(effect,from,to,env=day,camera) {
  for(let step=Math.round(from*20);step<=Math.round(to*20);step++)effect.update(step/20,env,camera);
}
const bodies=['采蜜蜂身体','草间蜻蜓身体'];

test('蜜蜂落在真实花心采蜜，连续拜访不同花簇后离开，路径保持连续且不穿地面',()=>{
  const anchors=sites(),effect=create({anchors});
  try {
    const visited=new Map();let flew=false,left=false,previous,previousSize=0;
    for(let step=0;step<2400;step++) {
      const time=step/20;effect.update(time,day);const body=pose(effect,bodies[0]);
      if(body.size>.1) {
        flew ||= body.position.y>3.6;
        assert.ok(body.position.y>=2.05);
        for(let index=0;index<anchors.length;index++) {
          const flower=anchors[index].sample(time,new THREE.Vector3());flower.y+=.09*body.size;
          if(body.position.distanceTo(flower)<.005)visited.set(index,(visited.get(index)??0)+1);
        }
        if(previous&&previousSize>.1)assert.ok(body.position.distanceTo(previous)<.5,'两帧之间不能突然换位');
      }else if(visited.size)left=true;
      previous=body.position;previousSize=body.size;
    }
    assert.ok(flew);assert.ok([...visited.values()].filter(samples=>samples>=20).length>=2,'要在至少两处花心各采蜜一秒以上');
    assert.ok(left,'几次采蜜后要离开');
  }finally{effect.dispose();}
});

test('蜻蜓出现短暂停悬后继续飞行，停悬只有微小调整，不落到花心',()=>{
  const effect=create();
  try {
    let previous,slow=0,longestSlow=0,fast=0;
    for(let step=0;step<1600;step++) {
      effect.update(step/20,day);const body=pose(effect,bodies[1]);
      if(body.size>.2&&previous) {
        const distance=body.position.distanceTo(previous);
        slow=distance<.012?slow+.05:0;longestSlow=Math.max(longestSlow,slow);
        if(distance>.04)fast++;
        assert.ok(body.position.y>3.5,'蜻蜓应在花丛上方停悬');
      }else slow=0;
      previous=body.size>.2?body.position:undefined;
    }
    assert.ok(longestSlow>=.8,'至少有一段可观察到的停悬');assert.ok(fast>20,'停悬之间应继续飞行');
  }finally{effect.dispose();}
});

test('两种昆虫遇雨雪强风、冬季或夜间平滑退场，薄残雪也禁止复飞',()=>{
  for(const change of [{rain:1},{snow:1},{snowCover:.0001},{windSpeed:18},{seasonIndex:3},{daylight:0},{weather:'blizzard'}]) {
    const effect=create();
    try {
      advance(effect,0,12);
      const before=bodies.map(name=>pose(effect,name));assert.ok(before.every(body=>body.size>.1));
      effect.update(12.05,{...day,...change});
      assert.ok(bodies.every(name=>pose(effect,name).size>.01),'不能在天气变化第一帧突然消失');
      advance(effect,12.1,24,{...day,...change});
      assert.ok(effect.group.children.every(group=>!group.visible));
      advance(effect,24.05,36,{...day,snowCover:.02});
      assert.ok(effect.group.children.every(group=>!group.visible),'薄残雪期间保持休眠');
    }finally{effect.dispose();}
  }
});

test('天气转好后错开恢复，花丛隐藏时两种昆虫退出',()=>{
  let available=true;const anchors=sites().map(anchor=>({...anchor,available:()=>available})),effect=create({anchors});
  try {
    advance(effect,0,3,{...day,snow:1});let first=0,largest=0;
    for(let step=61;step<400;step++) {
      effect.update(step/20,day);
      const body=effect.group.getObjectByName(bodies[0]);
      const count=Array.from({length:body.count},(_,i)=>pose(effect,bodies[0],i).size).filter(size=>size>.02).length;
      if(!first&&count)first=count;largest=Math.max(largest,count);
    }
    assert.equal(first,1);assert.ok(largest>first);
    available=false;advance(effect,20,32);
    assert.ok(effect.group.children.every(group=>!group.visible));
  }finally{effect.dispose();}
});

test('蜜蜂与蝴蝶共用花朵占用记录，不能同时采同一朵花，释放时不清掉其他居民',()=>{
  const anchors=sites(1),outside={},reservations=new Set([outside,anchors[0]]);
  const effect=create({anchors,reservations});
  const butterflies=createFlowerButterflies(new THREE.Group(),{anchors,reservations,heightAt:()=>2,random:seededRandom(73)});
  try {
    advance(effect,0,12);assert.ok(pose(effect,bodies[0]).size<.001,'已占用的花不能被蜜蜂访问');
    reservations.delete(anchors[0]);let beeFed=false,butterflyRested=false;
    for(let step=241;step<2400;step++) {
      const time=step/20;effect.update(time,day);butterflies.update(time,day);
      const bee=pose(effect,bodies[0]),butterfly=pose(butterflies,'花丛蝴蝶身体');
      const beeHere=bee.size>.1&&Math.abs(bee.position.y-(3+.09*bee.size))<.005;
      const butterflyHere=butterfly.size>.1&&Math.abs(butterfly.position.y-3.04)<.005;
      assert.ok(!(beeHere&&butterflyHere),'同一花心不能同时停着两种昆虫');beeFed ||= beeHere;butterflyRested ||= butterflyHere;
    }
    assert.ok(beeFed&&butterflyRested,'两种居民都应有访问机会');
  }finally{effect.dispose();butterflies.dispose();}
  assert.ok(reservations.has(outside),'只能释放自己占用的花');
});

test('画质限制数量，远处限频与隐藏，重新靠近立即更新，无负实例缩放',()=>{
  const effect=create();
  try {
    const counts=bodies.map(name=>effect.group.getObjectByName(name).count);effect.setQuality('low');
    bodies.forEach((name,i)=>assert.ok(effect.group.getObjectByName(name).count<counts[i]));effect.setQuality('high');
    advance(effect,0,12);const body=effect.group.getObjectByName(bodies[0]),camera=new THREE.PerspectiveCamera();camera.position.set(150,10,8);camera.lookAt(12,3,10);
    effect.update(12.05,day,camera);const version=body.instanceMatrix.version;effect.update(12.06,day,camera);assert.equal(body.instanceMatrix.version,version);
    camera.position.set(1500,10,8);camera.lookAt(12,3,10);effect.update(13,day,camera);assert.ok(effect.group.children.every(group=>!group.visible));
    const hidden=body.instanceMatrix.version;advance(effect,13.05,14,day,camera);assert.equal(body.instanceMatrix.version,hidden);
    camera.position.set(12,7,25);camera.lookAt(12,3,10);effect.update(14.05,day,camera);assert.ok(body.instanceMatrix.version>hidden);
    effect.group.traverse(mesh=>{if(!mesh.isInstancedMesh)return;const matrix=new THREE.Matrix4();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));assert.ok(matrix.determinant()>=0);}});
  }finally{effect.dispose();}
});

test('场景状态独立，空花丛不生成居民，退出幂等且共享资源只释放一次',()=>{
  const effect=create(),other=create(),empty=create({anchors:[]});
  try {
    other.update(0,day);const before=pose(other,bodies[0]);advance(effect,0,12);assert.deepEqual(pose(other,bodies[0]),before);
    advance(empty,0,20);assert.ok(empty.group.children.every(group=>!group.visible));
    const resources=new Set(),released=new Map();effect.group.traverse(mesh=>{if(mesh.isInstancedMesh)resources.add(mesh);if(mesh.geometry)resources.add(mesh.geometry);if(mesh.material)resources.add(mesh.material);});
    for(const resource of resources){released.set(resource,0);resource.addEventListener('dispose',()=>released.set(resource,released.get(resource)+1));}
    const body=effect.group.getObjectByName(bodies[0]);effect.dispose();effect.dispose();const version=body.instanceMatrix.version;effect.update(20,day);effect.setQuality('low');
    assert.equal(body.instanceMatrix.version,version);assert.ok([...released.values()].every(count=>count===1));
  }finally{effect.dispose();other.dispose();empty.dispose();}
});

test('蜜蜂蜻蜓离开视线后分别停止写入，转回直接更新当前姿态',()=>{
  const effect=create(),reference=create(),camera=new THREE.PerspectiveCamera(70,1,.1,500);camera.position.set(13,8,30);
  try {
    advance(effect,0,12);advance(reference,0,12);
    const versions=bodies.map(name=>effect.group.getObjectByName(name).instanceMatrix.version);
    camera.lookAt(13,8,50);effect.update(12.05,day,camera);reference.update(12.05,day);
    assert.ok(effect.group.children.every(group=>!group.visible));
    advance(effect,12.1,14,day,camera);advance(reference,12.1,14);
    bodies.forEach((name,index)=>assert.equal(effect.group.getObjectByName(name).instanceMatrix.version,versions[index]));
    camera.lookAt(13,3,10);effect.update(14.05,day,camera);reference.update(14.05,day);
    assert.ok(effect.group.children.every(group=>group.visible));
    bodies.forEach((name,index)=>{assert.ok(effect.group.getObjectByName(name).instanceMatrix.version>versions[index]);assert.deepEqual(pose(effect,name),pose(reference,name));});
  }finally{effect.dispose();reference.dispose();}
});
