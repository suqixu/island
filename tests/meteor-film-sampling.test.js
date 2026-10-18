import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMeteorShower} from '../src/meteor-shower.js';
test('影片流星真实支持0至32颗、直接定位一致、普通状态恢复且保留两批绘制',()=>{
 const shower=createMeteorShower(),view=new THREE.PerspectiveCamera(70,1.6,.1,10000);view.lookAt(0,1,-1);view.updateMatrixWorld();
 try{assert.equal(typeof shower.sampleFilm,'function');const before=shower.getRuntimeOptions();shower.beginFilm();
  for(const count of [0,1,9,18,32]){shower.sampleFilm({id:'test',start:0,localTime:.8,parameters:{burstCount:count,maxActive:32,flightDuration:1.1,burstInterval:4,lingerDuration:.3,brightness:1,bearing:-55}},{seed:2,frameAt:()=>view});shower.update(0,1,view);assert.equal(shower.group.getObjectByName('meteor-head').geometry.drawRange.count,count);}
  const frame={id:'test',start:0,localTime:.8,parameters:{burstCount:18,maxActive:32,flightDuration:1.1,burstInterval:4,lingerDuration:.3,brightness:1,bearing:-55}},ctx={seed:2,frameAt:()=>view};
  shower.sampleFilm(frame,ctx);shower.update(0,1,view);const a=Array.from(shower.group.getObjectByName('meteor').geometry.attributes.position.array);
  for(let t=0;t<.8;t+=.05){shower.sampleFilm({...frame,localTime:t},ctx);shower.update(.05,1,view);}shower.sampleFilm(frame,ctx);shower.update(.05,1,view);assert.deepEqual(Array.from(shower.group.getObjectByName('meteor').geometry.attributes.position.array),a);
  assert.throws(()=>shower.setRuntimeOptions({burstCount:33}));shower.sampleFilm(null,ctx);shower.update(0,1,view);assert.equal(shower.group.getObjectByName('meteor').geometry.drawRange.count,0);shower.endFilm();assert.deepEqual(shower.getRuntimeOptions(),before);assert.equal(shower.group.children.length,2);
 }finally{shower.dispose();}
});
