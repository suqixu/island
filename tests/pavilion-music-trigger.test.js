import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;try{module=await import('../src/pavilion-music-trigger.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const api=()=>{assert.equal(typeof module?.createPavilionMusicTrigger,'function');return module.createPavilionMusicTrigger;};
const center=new THREE.Vector3(14,37,19),target=center.clone(),camera=center.clone().add(new THREE.Vector3(-13,6,8));
test('山洞连续累计到第三、第五、第十次，各阶段互斥，切换视角清空全部阶段',()=>{
  const trigger=api()(center,'cave',[3,5,10]);
  for(let click=1;click<=10;click++) {
    assert.equal(trigger.selectView('cave'),[3,5,10].includes(click),`第${click}次点击`);
    for(const step of [3,5,10]) assert.equal(trigger.isActive(camera,target,false,step),step===(click>=10?10:click>=5?5:click>=3?3:0));
  }
  trigger.selectView('island');assert.equal(trigger.isActive(camera,target),false);
  assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),true);
  assert.equal(trigger.isActive(camera,target,false,3),true);assert.equal(trigger.isActive(camera,target,false,5),false);
  const far=new THREE.Vector3(160,68,200);
  assert.equal(trigger.isActive(far,target,true,3),true);assert.equal(trigger.isActive(far,target,false,3),false);
});
test('南峰亭前两次点击不触发，第三次开始，其余视角打断计数',()=>{
  const trigger=api()(center);
  assert.equal(trigger.selectView('south-pavilion'),false);assert.equal(trigger.isActive(camera,target),false);
  assert.equal(trigger.selectView('south-pavilion'),false);assert.equal(trigger.selectView('south-pavilion'),true);
  assert.equal(trigger.isActive(camera,target),true);trigger.selectView('island');assert.equal(trigger.isActive(camera,target),false);
  trigger.selectView('south-pavilion');trigger.selectView('east-pavilion');
  assert.equal(trigger.selectView('south-pavilion'),false);assert.equal(trigger.selectView('south-pavilion'),false);assert.equal(trigger.selectView('south-pavilion'),true);
});
test('触发后等待镜头到亭子，离开亭子或取消时停止，不会靠近自动重启',()=>{
  const trigger=api()(center);for(let i=0;i<3;i++)trigger.selectView('south-pavilion');
  const far=new THREE.Vector3(160,68,200);
  assert.equal(trigger.isActive(far,target,true),true);assert.equal(trigger.isActive(camera,target),true);
  assert.equal(trigger.isActive(far,new THREE.Vector3(0,15,0)),false);assert.equal(trigger.isActive(camera,target),false);
  for(let i=0;i<3;i++)trigger.selectView('south-pavilion');trigger.cancel();assert.equal(trigger.isActive(camera,target),false);
});

test('東峰亭独立累计三击，南峰亭不会触发东峰音乐',()=>{
  const trigger=api()(center,'east-pavilion');
  for(let i=0;i<3;i++)assert.equal(trigger.selectView('south-pavilion'),false);
  assert.equal(trigger.selectView('east-pavilion'),false);assert.equal(trigger.selectView('east-pavilion'),false);assert.equal(trigger.selectView('east-pavilion'),true);
});

test('山洞三击独立计数，切换到凉亭清空，返回洞内不会自动再触发',()=>{
  const center=new THREE.Vector3(30,12.2,36), camera=new THREE.Vector3(42.5,16,51.6);
  const trigger=api()(center,'cave');
  assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),true);
  assert.equal(trigger.isActive(camera,center),true);trigger.selectView('south-pavilion');
  assert.equal(trigger.isActive(camera,center),false);assert.equal(trigger.selectView('cave'),false);
});


test('非重复地标点击仅在指定次数触发，超过末次后不循环计数',()=>{
  const trigger=api()(center,'dock',[3],{repeat:false});
  for(let click=1;click<=15;click++)assert.equal(trigger.selectView('dock'),click===3,`第${click}次`);
  trigger.selectView('island');
  assert.equal(trigger.selectView('dock'),false);assert.equal(trigger.selectView('dock'),false);assert.equal(trigger.selectView('dock'),true);
});
