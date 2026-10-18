import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const module = await import('../src/ocean-impact.js').catch(error => {
  if(error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
function create(scene) {
  assert.ok(module?.createImpactPlumes, '拍岸需要由透明图集绘制的局部破浪水冠');
  return module.createImpactPlumes(scene, { map: { value: new THREE.Texture() }, ready: { value: 1 } }, () => .4);
}
const hit = (x=0,z=0) => ({ x,y:1,z,impact:.6,nx:1,nz:0,wind:[1,0] });

test('同一段岸线只产生一簇水冠，分开的撞击可同时出现，静海不增加绘制', () => {
  const scene = new THREE.Group(), plumes=create(scene);
  assert.equal(scene.children.length,0);
  assert.equal(plumes.emit(hit()),true);
  assert.equal(plumes.emit(hit(3,1)),false,'相邻岸线采样不能堆成贴图墙');
  assert.equal(plumes.emit(hit(25,0)),true);
  plumes.update(.2,{daylight:1,storm:1,cloudiness:1});
  const mesh=scene.getObjectByName('拍岸破浪水冠');
  assert.ok(mesh?.isMesh);
  assert.equal([...mesh.geometry.attributes.aAlpha.array].filter(x=>x>0).length,2);
  assert.ok(mesh.geometry.attributes.aHeight.array[0]>1);
  plumes.update(4,{daylight:1});
  assert.equal(mesh.visible,false,'旧水冠必须完全消散');
  plumes.dispose();assert.equal(scene.children.length,0);
});

test('水冠受画质池限制，变大后崩落，薄雾阶段接续，释放不销毁共享图集', () => {
  const scene=new THREE.Group(),plumes=create(scene);
  plumes.setQuality('low');
  for(let i=0;i<30;i++)plumes.emit(hit(i*25,0));
  plumes.update(.15,{daylight:1});
  const mesh=scene.getObjectByName('拍岸破浪水冠'),a=mesh.geometry.attributes;
  assert.ok(mesh.geometry.instanceCount<=12);
  const youngHeight=a.aHeight.array[0],youngWidth=a.aWidth.array[0];
  plumes.update(.4,{daylight:1});
  assert.ok(a.aHeight.array[0]>youngHeight,'水冠应先抬起');
  plumes.update(.6,{daylight:1});
  assert.ok(a.aWidth.array[0]>youngWidth,'水冠随撞击向外散开');
  assert.ok(a.aMist.array[0]>0,'破碎后接续薄雾');
  for(const attribute of Object.values(a))assert.ok([...attribute.array].every(Number.isFinite));
  let releases=0;
  mesh.material.uniforms.uSprayAtlas.value.addEventListener('dispose',()=>releases++);
  plumes.dispose();plumes.dispose();assert.equal(releases,0);
});
