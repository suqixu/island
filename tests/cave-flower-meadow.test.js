import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import renderingConfig from '../src/config/rendering.json' with { type: 'json' };
import * as THREE from 'three';
import { caveToLocal } from '../src/cave-layout.js';
const module = await import('../src/models/cave-flower-meadow.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('洞口繁花贴合实际地形且留出入口与台阶，固定空间簇覆盖多种花色', () => {
  assert.equal(typeof module.createCaveFlowerMeadow, 'function');
  const scene=new THREE.Group(),heightAt=(x,z)=>10+.03*(x-30)-.06*(z-36);
  const distanceAt=(x,z)=>Math.abs(caveToLocal({x,y:10,z}).side)-1.25;
  const meadow=module.createCaveFlowerMeadow(scene,{heightAt,distanceAt});
  const meshes=meadow.group.children.filter(o=>o.isMesh&&o.visible);
  assert.ok(meshes.length<=12);assert.ok(meshes.every(o=>o.isInstancedMesh));
  const petals=meshes.filter(o=>o.instanceColor);assert.ok(petals.reduce((sum,mesh)=>sum+mesh.count,0)>200);
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),color=new THREE.Color(),colors=new Set();
  for(const mesh of petals)for(let i=0;i<mesh.count;i++) {
    mesh.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
    const local=caveToLocal(point);
    assert.ok(local.forward>1.7&&local.forward<13);
    assert.ok(distanceAt(point.x,point.z)>.5,'保留通道，不在台阶上种花');
    assert.ok(Math.abs(point.y-heightAt(point.x,point.z))<.025,'根部不能悬空或穿坡');
    mesh.getColorAt(i,color);colors.add(color.getHexString());
  }
  assert.ok(colors.size>=8,'花色应丰富');
  const resources=meshes.map(mesh=>[mesh.geometry,mesh.material]);
  meadow.update(4,{wind:.9,season:'summer'});meadow.update(8,{wind:.4,season:'winter',snow:1});
  assert.deepEqual(meshes.map(mesh=>[mesh.geometry,mesh.material]),resources,'每帧不重建花丛');
  assert.ok(meshes.every(mesh=>!mesh.visible),'积雪时休眠');
  meadow.update(10,{wind:.3,season:'spring',snow:0});assert.ok(meshes.every(mesh=>mesh.visible));
  meadow.dispose();assert.equal(scene.children.length,0);
});

test('近景花头具有内外叠瓣与杯状深度，仍受实例几何预算约束',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  try{
    const petals=meadow.group.getObjectByName('洞前缤纷花瓣'),{position,aPetalTexture}=petals.geometry.attributes;
    let innerUpright=0;for(let i=0;i<position.count;i++)if(aPetalTexture.getX(i)>.5&&Math.hypot(position.getX(i),position.getZ(i))<.1&&position.getY(i)>.60)innerUpright++;
    assert.ok(innerUpright>20,'花头内部也应有立起的叠瓣，避免六角扁片的外观');
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
    for(let i=0;i<petals.geometry.index.count;i+=3){
      const ids=[0,1,2].map(offset=>petals.geometry.index.getX(i+offset));if(ids.some(index=>aPetalTexture.getX(index)<.5))continue;
      a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);normal.subVectors(b,a).cross(c.sub(a));
      assert.ok(normal.y>=-1e-9,'圆润花缘不能翻折成朝下的尖角');
    }
    assert.ok(petals.geometry.index.count/3<=560,'立体花蕊的单实例预算为560个三角形（原480），仍限制密集花海开销');
    assert.ok(meadow.group.children.filter(mesh=>mesh.isMesh&&mesh.visible).length<=12,'六个固定花簇各两批实例，不逐株增加绘制');
  }finally{meadow.dispose();}
});

test('花蕊在瓣口形成短而密的花粉簇，颜色保持白粉红黄',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  try{
    const petals=meadow.group.getObjectByName('洞前缤纷花瓣'),{position,aPetalTexture}=petals.geometry.attributes;
    let rimTop=-Infinity,heartTop=-Infinity;const grains=[];
    for(let i=0;i<position.count;i++){
      const y=position.getY(i);if(aPetalTexture.getX(i)>.5)rimTop=Math.max(rimTop,y);
      else {heartTop=Math.max(heartTop,y);if(y>.625&&Math.hypot(position.getX(i),position.getZ(i))>.025)grains.push(i);}
    }
    assert.ok(heartTop>.64&&heartTop<.668,'花粉簇在瓣口可见，不能缩在杯底或高挑成一束硬棒');
    assert.ok(grains.length>=32,'瓣口需要密集的立体花粉颗粒，不能只留一颗小球');
    const centers=petals.geometry.attributes.aFlowerCenter,tones=new Set();
    for(let i=0;i<centers.count;i++){
      const r=centers.getX(i),g=centers.getY(i),b=centers.getZ(i);
      if(r>.8&&g>.8&&b>.8)tones.add('白');
      else if(r>.8&&g>.45&&b>.5)tones.add('粉');
      else if(r>.8&&g<.4&&b<.4)tones.add('红');
      else if(r>.8&&g>.65&&b<.45)tones.add('黄');
    }
    assert.deepEqual([...tones].sort(),['白','粉','红','黄'].sort(),'保留白粉红黄四类可辨的花蕊颜色');
    for(let i=0;i<centers.count;i++)assert.ok(Math.max(centers.getX(i),centers.getY(i),centers.getZ(i))>.7,'花蕊以明亮的白、粉、红、黄为主');
  }finally{meadow.dispose();}
});

test('单瓣有独立轮廓与错落的着生高度，避免同心连碗',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  try{
    const {position}=meadow.group.getObjectByName('洞前缤纷花瓣').geometry.attributes,roots=[];
    const left=new THREE.Vector3(),right=new THREE.Vector3();
    for(let petal=0;petal<7;petal++){
      const start=petal*20;roots.push(position.getY(start+2));
      left.fromBufferAttribute(position,start+15).setY(0).normalize();right.fromBufferAttribute(position,start+19).setY(0).normalize();
      assert.ok(Math.acos(left.dot(right))<Math.PI*2/7+.08,'单瓣覆盖角不能跨过两侧相邻花瓣形成连碗');
    }
    assert.ok(Math.max(...roots)-Math.min(...roots)>.008,'花瓣不能都从同一球心和等高圆环长出');
  }finally{meadow.dispose();}
});


function visibleFlowerRecords(meadow) {
  const records=[];
  for(const mesh of meadow.group.children.filter(mesh=>mesh.visible&&mesh.instanceColor)) {
    for(let i=0;i<mesh.count;i++)records.push([
      ...mesh.instanceMatrix.array.slice(i*16,i*16+16),
      ...mesh.instanceColor.array.slice(i*3,i*3+3),
      ...mesh.geometry.attributes.aFlowerCenter.array.slice(i*3,i*3+3),
    ].join(','));
  }
  return records.sort();
}
function visibleTriangles(meadow) {
  return meadow.group.children.filter(mesh=>mesh.visible).reduce((sum,mesh)=>sum+mesh.count*mesh.geometry.index.count/3,0);
}

test('远景保持每株栽种变换和颜色，减少至少八成三角形且不逐帧重排实例',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  const camera=new THREE.PerspectiveCamera();
  try {
    const near=visibleFlowerRecords(meadow),baseline=visibleTriangles(meadow);
    assert.equal(near.length,1042);
    assert.equal(createHash('sha256').update(near.join('\n')).digest('hex'),'19f09872a60d9e205a65c43e406fb0acb3db384c53ab96dbbc63b36a3e2b0268','近景不能改变原来的栽种位置、密度、旋转、尺寸与颜色');
    const matrices=meadow.group.children.map(mesh=>({mesh,array:mesh.instanceMatrix.array.slice(),version:mesh.instanceMatrix.version}));
    camera.position.set(900,40,900);meadow.update(1,{season:'summer',wind:.5},camera);
    assert.ok(visibleTriangles(meadow)<baseline*.2,'远处必须真正切换到更低的几何成本');
    assert.deepEqual(visibleFlowerRecords(meadow),near,'远景每一株仍在原处并保留相同花色、花蕊色');
    for(let i=0;i<60;i++)meadow.update(2+i/60,{season:'summer',wind:.5},camera);
    for(const {mesh,array,version} of matrices){assert.deepEqual(mesh.instanceMatrix.array,array);assert.equal(mesh.instanceMatrix.version,version,'LOD与风摆都不能重写实例矩阵');}
    assert.ok(meadow.group.children.every(mesh=>!mesh.castShadow&&mesh.receiveShadow),'花海继续只接收阴影，不能引入密集投影');
    meadow.update(4,{season:'spring'});
    assert.equal(visibleTriangles(meadow),baseline,'没有相机时保留兼容的近景');
  } finally { meadow.dispose(); }
});

test('花簇按相机世界坐标独立分级，阈值之间滞回且休眠恢复不漏花',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  const cameraRoot=new THREE.Group(),camera=new THREE.PerspectiveCamera();cameraRoot.add(camera);
  try {
    const nearMeshes=meadow.group.children.filter(mesh=>mesh.instanceColor&&mesh.userData.flowerLod==='near');
    assert.ok(nearMeshes.length>1&&nearMeshes.length<=6,'使用少量固定空间簇，而非全片统一或逐株判级');
    const {nearDistance,farDistance}=renderingConfig.caveFlowerLod;
    const first=nearMeshes[0],center=first.boundingSphere.center.clone(),radius=first.boundingSphere.radius;
    cameraRoot.position.copy(center);camera.position.set(0,0,radius+farDistance+1);
    meadow.update(0,{season:'summer'},camera);assert.equal(first.visible,false);
    camera.position.z=radius+(nearDistance+farDistance)/2;
    meadow.update(1,{season:'summer'},camera);assert.equal(first.visible,false,'回程经过中间区仍保持远景');
    camera.position.z=radius+nearDistance-1;
    meadow.update(2,{season:'summer'},camera);assert.equal(first.visible,true);
    camera.position.z=radius+(nearDistance+farDistance)/2;
    meadow.update(3,{season:'summer'},camera);assert.equal(first.visible,true,'离开经过中间区仍保持近景');
    camera.position.set(0,0,radius+farDistance);meadow.update(4,{season:'summer'},camera);
    assert.ok(nearMeshes.some(mesh=>mesh.visible)&&nearMeshes.some(mesh=>!mesh.visible),'视距边界横穿花簇时应允许近远景共存');
    for(const env of [{season:'winter'},{seasonIndex:3},{season:'spring',snowCover:.2}]) {
      meadow.update(5,env,camera);assert.ok(meadow.group.children.every(mesh=>!mesh.visible));
      meadow.update(6,{season:'spring'},camera);assert.equal(visibleFlowerRecords(meadow).length,1042);
    }
  } finally { meadow.dispose(); }
});

test('花簇远近切换保留实际花心落点和风摆，全部共享资源仅释放一次',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  const sites=meadow.getFlowerAnchors(),camera=new THREE.PerspectiveCamera();
  const resources=new Set();
  for(const mesh of meadow.group.children){resources.add(mesh);resources.add(mesh.geometry);resources.add(mesh.material);resources.add(mesh.customDepthMaterial);}
  const released=new Map([...resources].map(resource=>[resource,0]));
  for(const resource of resources)resource.addEventListener('dispose',()=>released.set(resource,released.get(resource)+1));
  try {
    meadow.update(0,{season:'summer',wind:.6});const before=sites.map(site=>site.sample(0,new THREE.Vector3()).clone());
    camera.position.set(1000,100,1000);meadow.update(0,{season:'summer',wind:.6},camera);
    assert.ok(sites.every(site=>site.available()),'切到远景不能使落在同株花上的昆虫失去落点');
    sites.forEach((site,i)=>assert.ok(site.sample(0,new THREE.Vector3()).distanceTo(before[i])<1e-9,'固定LOD不改变落点或风摆相位'));
    meadow.update(2,{season:'summer',wind:.6},camera);
    assert.ok(sites.some((site,i)=>site.sample(2,new THREE.Vector3()).distanceTo(before[i])>.01),'远景仍共享实际风摆');
    meadow.update(3,{season:'winter'},camera);assert.ok(sites.every(site=>!site.available()));
    meadow.update(4,{season:'spring'},camera);assert.ok(sites.every(site=>site.available()));
    meadow.dispose();meadow.dispose();
    assert.ok(sites.every(site=>!site.available()));
    assert.ok([...released.values()].every(count=>count===1),'近远景几何、实例和共享材质均须恰好释放一次');
    const matrices=[...resources].filter(resource=>resource.isInstancedMesh).map(mesh=>[mesh,mesh.instanceMatrix.version]);
    meadow.update(5,{season:'summer'},camera);
    for(const [mesh,version]of matrices)assert.equal(mesh.instanceMatrix.version,version);
  } finally {meadow.dispose();}
});


test('分簇保持既有36个昆虫落点的全局采样顺序，空花海不产生落点',()=>{
  const meadow=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>4,distanceAt:()=>2});
  const empty=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>NaN});
  try {
    const sites=meadow.getFlowerAnchors();assert.equal(sites.length,36);
    const expected=[
      [29.866383036240034,4.680153040418446,41.024168398044075],
      [29.206333069471516,4.639385938866987,43.17323046731117],
      [29.15223799896866,4.830009909430544,41.749951142328214],
      [28.88153269883518,4.604836270101018,39.889808079501506],
    ];
    expected.forEach((point,i)=>assert.ok(sites[i].sample(0,new THREE.Vector3()).distanceTo(new THREE.Vector3(...point))<1e-7,'不能因分簇改变原有昆虫停靠的花株'));
    assert.equal(empty.count,0);assert.deepEqual(empty.getFlowerAnchors(),[]);
    empty.update(1,{season:'summer'},new THREE.PerspectiveCamera());
  }finally{meadow.dispose();empty.dispose();}
});


test('花海父组平移旋转后按世界距离选LOD，花心落点跟随相同变换',()=>{
  const parent=new THREE.Group(),meadow=module.createCaveFlowerMeadow(parent,{heightAt:()=>4,distanceAt:()=>2});
  const camera=new THREE.PerspectiveCamera(),site=meadow.getFlowerAnchors()[0];
  try {
    const original=site.sample(0,new THREE.Vector3()).clone();
    parent.position.set(350,-10,170);parent.rotation.y=1.1;parent.updateWorldMatrix(true,true);
    const transformed=original.applyMatrix4(parent.matrixWorld);
    assert.ok(site.sample(0,new THREE.Vector3()).distanceTo(transformed)<1e-7);
    camera.position.copy(transformed);meadow.update(0,{season:'summer'},camera);
    assert.ok(meadow.group.children.filter(mesh=>mesh.visible).every(mesh=>mesh.userData.flowerLod==='near'),'相机贴近变换后的花海时保持近景');
    camera.position.addScalar(1000);meadow.update(0,{season:'summer'},camera);
    assert.ok(meadow.group.children.filter(mesh=>mesh.visible).every(mesh=>mesh.userData.flowerLod==='far'));
  }finally{meadow.dispose();}
});


test('摄影观察点沿用原全局第6株并跟随真实实例及父组世界变换',()=>{
  const parent=new THREE.Group(),meadow=module.createCaveFlowerMeadow(parent,{heightAt:()=>4,distanceAt:()=>2});
  const empty=module.createCaveFlowerMeadow(new THREE.Group(),{heightAt:()=>NaN});
  try {
    assert.equal(typeof meadow.getObservationPoint,'function','摄影地标需要按原全局株序取点');
    const target=new THREE.Vector3(),expected=new THREE.Vector3(28.011675479233265,4.594975246429444,40.96621579253674);
    assert.equal(meadow.getObservationPoint(6,target),target,'复用调用者提供的向量');
    assert.ok(target.distanceTo(expected)<1e-7,'不能将全局第6株替换为第一簇第6株');
    const meshCount=meadow.group.children.length;
    const camera=new THREE.PerspectiveCamera();camera.position.set(900,100,900);meadow.update(0,{season:'summer'},camera);
    assert.ok(meadow.getObservationPoint(6,target).distanceTo(expected)<1e-7,'降级至远景不能改变摄影构图');
    parent.position.set(150,-10,80);parent.rotation.y=.7;parent.scale.set(1.5,.9,1.2);parent.updateWorldMatrix(true,true);
    assert.ok(meadow.getObservationPoint(6,target).distanceTo(expected.applyMatrix4(parent.matrixWorld))<1e-7,'父组平移旋转缩放后仍返回世界坐标');
    const custom=new THREE.Vector3(.02,.7,-.01),customBefore=custom.clone();
    const customExpected=new THREE.Vector3(28.0136024518311,4.736637233421207,40.96572700232267).applyMatrix4(parent.matrixWorld);
    assert.ok(meadow.getObservationPoint(6,target,custom).distanceTo(customExpected)<1e-7,'允许调用者提供局部观察点，避免摄影高度重复维护');
    assert.deepEqual(custom,customBefore);assert.equal(meadow.group.children.length,meshCount,'不得为摄影地标新增GPU实例');
    assert.equal(empty.getObservationPoint(0,target),null);assert.equal(meadow.getObservationPoint(-1,target),null);
    assert.equal(meadow.getObservationPoint(meadow.count,target),null);
    meadow.dispose();assert.equal(meadow.getObservationPoint(6,target),null);
  }finally{meadow.dispose();empty.dispose();}
});
