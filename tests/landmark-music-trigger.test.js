import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
let api;try{api=await import('../src/landmark-music-trigger.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const center=new THREE.Vector3(30,12,36),camera=center.clone().add(new THREE.Vector3(12,6,16));
test('全岛第三次点击播放，桌面和手机远景不会误判离开，其他视角重置计数',()=>{
  const target=new THREE.Vector3(0,15,0);
  for(const scale of [1,1.48]) {
    const trigger=api.createLandmarkMusicTrigger(target,'island');
    const camera=new THREE.Vector3(160*scale,68*scale,200*scale);
    for(let click=1;click<=9;click++) {
      assert.equal(trigger.selectView('island'),click===3);
      assert.deepEqual(trigger.getMusicFlags(camera,target),{islandSongMusic:click>=3});
    }
    trigger.selectView('cave');
    assert.deepEqual(trigger.getMusicFlags(camera,target),{islandSongMusic:false});
    assert.equal(trigger.selectView('island'),false);
    assert.equal(trigger.selectView('island'),false);
    assert.equal(trigger.selectView('island'),true);
    assert.deepEqual(trigger.getMusicFlags(camera,target.clone().addScalar(100),true),{islandSongMusic:true});
    assert.deepEqual(trigger.getMusicFlags(camera,target.clone().addScalar(100),false),{islandSongMusic:false});
  }
});
test('山洞第3、5、10、12次按用户指定顺序触发，其他次数不启动新歌曲',()=>{
  assert.equal(typeof api?.createLandmarkMusicTrigger,'function');
  const trigger=api.createLandmarkMusicTrigger(center,'cave');
  const expected={3:'caveMusic',5:'caveBoruMusic',10:'caveDreamMusic',12:'caveChantMusic'};
  let flag;
  for(let click=1;click<=15;click++) {
    assert.equal(trigger.selectView('cave'),Object.hasOwn(expected,click));
    flag=expected[click]??flag;
    const flags=trigger.getMusicFlags(camera,center,false);
    assert.deepEqual(Object.keys(flags).filter(k=>flags[k]),flag?[flag]:[]);
  }
  trigger.selectView('dock');assert.ok(Object.values(trigger.getMusicFlags(camera,center,false)).every(v=>!v));
  assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),false);assert.equal(trigger.selectView('cave'),true);
});
test('码头只有第三次触发送别，离开再返回需重新点击三次',()=>{
  assert.equal(typeof api?.createLandmarkMusicTrigger,'function');
  const dockTarget=new THREE.Vector3(5,5,60),dockCamera=new THREE.Vector3(40,12,128);
  const trigger=api.createLandmarkMusicTrigger(dockTarget,'dock');
  for(let click=1;click<=15;click++)assert.equal(trigger.selectView('dock'),click===3);
  assert.deepEqual(trigger.getMusicFlags(dockCamera,dockTarget,false),{dockMusic:true});
  const far=new THREE.Vector3(160,68,200);
  assert.deepEqual(trigger.getMusicFlags(far,center,false),{dockMusic:false});
  assert.equal(trigger.selectView('dock'),false);assert.equal(trigger.selectView('dock'),false);assert.equal(trigger.selectView('dock'),true);
});


test('灯塔第3、5、10、12次依次播放四首指定曲目，超过次数不自动重新唱',()=>{
  assert.equal(typeof api?.createLandmarkMusicTrigger,'function');
  const trigger=api.createLandmarkMusicTrigger(center,'lighthouse');
  const expected={3:'lighthouseMusic',5:'lighthouseLubinghuaMusic',10:'lighthouseHualianMusic',12:'lighthouseTuogaoMusic'};
  let flag;
  for(let click=1;click<=15;click++) {
    assert.equal(trigger.selectView('lighthouse'),Object.hasOwn(expected,click));flag=expected[click]??flag;
    assert.deepEqual(Object.entries(trigger.getMusicFlags(camera,center)).filter(([,v])=>v).map(([k])=>k),flag?[flag]:[]);
  }
});
