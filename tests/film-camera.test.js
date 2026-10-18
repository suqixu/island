import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const api=await import('../src/film-camera.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function create(aspect=1.5,heightAt=()=>5){assert.equal(typeof api.createFilmCamera,'function');const camera=new THREE.PerspectiveCamera(46,aspect,.5,1000),controls={target:new THREE.Vector3()};let anchor=new THREE.Vector3(20,10,30);const effect=api.createFilmCamera({camera,controls,landmarks:{island:()=>anchor},heightAt});return {camera,controls,effect,move:point=>anchor=point};}
const sample=time=>({time,shot:{id:'test',start:0,end:10,landmark:'island',camera:[{at:0,position:[10,2,0],target:[0,0,0],fov:46},{at:10,position:[0,4,10],target:[0,2,0],fov:40}]}});
test('地标镜头平滑连接关键点，视线和FOV同步，重播重新解析实际位置',()=>{const f=create();f.effect.apply(sample(0));assert.deepEqual(f.camera.position.toArray(),[30,12,30]);f.effect.apply(sample(5));assert.deepEqual(f.camera.position.toArray(),[25,13,35]);assert.equal(f.camera.fov,43);assert.deepEqual(f.controls.target.toArray(),[20,11,30]);f.move(new THREE.Vector3(100,10,30));f.effect.apply(sample(6));assert.ok(f.camera.position.x<30,'单镜头不能随随机对象跳位');f.effect.reset();f.effect.apply(sample(0));assert.equal(f.camera.position.x,110);});
test('地表保护与手机构图保留主体，资源释放后不再移动相机',()=>{const f=create(1.5,()=>20),mobile=create(.46,()=>20);f.effect.apply(sample(5));mobile.effect.apply(sample(5));assert.ok(f.camera.position.y>=20.65);assert.ok(mobile.camera.position.distanceTo(mobile.controls.target)>=f.camera.position.distanceTo(f.controls.target));f.effect.dispose();const before=f.camera.position.clone();f.effect.apply(sample(9));assert.deepEqual(f.camera.position,before);});
test('三个关键点形成连续弧线，经过中间机位不突然停住',()=>{const f=create(),value=sample(0);value.shot.camera.splice(1,0,{at:5,position:[8,5,8],target:[0,1,0],fov:43});value.time=4.9;f.effect.apply(value);const a=f.camera.position.clone();value.time=5;f.effect.apply(value);assert.ok(f.camera.position.distanceTo(new THREE.Vector3(28,15,38))<1e-5);value.time=5.1;f.effect.apply(value);assert.ok(a.distanceTo(f.camera.position)>.1,'弧线中间仍应连续前进');});
test('动态地标可按首机位选择朝向，从主体一侧观察而不隔着树干',()=>{
  const camera=new THREE.PerspectiveCamera(46,1.5,.5,1000),controls={target:new THREE.Vector3()};let received;
  const effect=api.createFilmCamera({camera,controls,landmarks:{island:shot=>{received=shot;return {position:new THREE.Vector3(20,10,30),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2)};}},heightAt:()=>0});
  const value=sample(0);effect.apply(value);assert.equal(received,value.shot);assert.ok(camera.position.distanceTo(new THREE.Vector3(20,12,20))<1e-6);
});
test('观察中的主体移动时镜头平滑跟随，静态地标仍固定',()=>{
  const camera=new THREE.PerspectiveCamera(46,1.5,.5,1000),controls={target:new THREE.Vector3()},subject=new THREE.Vector3(20,10,30);
  const effect=api.createFilmCamera({camera,controls,landmarks:{island:()=>({position:subject.clone(),focus:target=>target.copy(subject)})},heightAt:()=>0});
  const value=sample(0);effect.apply(value);subject.y+=2;value.time=.1;effect.apply(value);assert.ok(controls.target.y>10.1);assert.ok(controls.target.y<12,'跟拍应缓慢追随，不随目标跳位');
});
test('查询片段起点机位不移动真实镜头，也不改变当前镜头缓存',()=>{const f=create();f.effect.apply(sample(5));const before=f.camera.position.clone(),target=f.controls.target.clone();const pose=f.effect.getPoseAt(sample(0));assert.deepEqual(pose.position.toArray(),[30,12,30]);assert.deepEqual(f.camera.position,before);assert.deepEqual(f.controls.target,target);f.effect.apply(sample(6));assert.ok(f.camera.position.x<25);});

test('暂停镜头转屏立即重算构图，重复适配不推进时间或重新选择地标',()=>{
  const f=create(1.6,()=>0);const value=sample(5);f.effect.apply(value);
  const target=f.controls.target.clone(),landscapeDistance=f.camera.position.distanceTo(target);
  f.move(new THREE.Vector3(200,80,400));f.camera.aspect=.46;f.camera.updateProjectionMatrix();
  assert.equal(typeof f.effect.reframe,'function');assert.equal(f.effect.reframe(),true);
  assert.ok(Math.abs(f.camera.position.distanceTo(target)/landscapeDistance-Math.sqrt(1/.46))<1e-6);
  assert.deepEqual(f.controls.target,target,'适配当前镜头，不能重新随机选择主体');
  const portrait=f.camera.position.clone();f.effect.reframe();assert.ok(f.camera.position.distanceTo(portrait)<1e-9,'重复转屏不叠加后退距离');
  f.effect.apply(value);assert.ok(f.camera.position.distanceTo(portrait)<1e-9,'恢复播放首帧不再跳变');
  f.effect.reset();assert.equal(f.effect.reframe(),false,'重置后不能复用旧影片的最后一帧');f.effect.dispose();assert.equal(f.effect.reframe(),false);
});
