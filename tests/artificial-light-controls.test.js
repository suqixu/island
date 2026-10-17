import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLighthouse} from '../src/lighthouse.js';
import {createPathLamps} from '../src/path-lamps.js';
const controls=await import('../src/artificial-light-controls.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});

test('灯光三态保留自动昼夜、只关灯塔、关闭全部，并可恢复',()=>{
  assert.ok(controls?.getArtificialLightControls);
  const scene=new THREE.Scene(),heightAt=()=>12;
  const tower=createLighthouse(scene,{heightAt,position:{x:10,z:-4}});
  const lamps=createPathLamps(scene,{heightAt,layout:{routes:[{id:'fixture',kind:'mountain',width:1.1,points:[{x:58,z:-60},{x:130,z:-60}]}]}});
  const towerLights=[],pathLights=[];
  tower.group.traverse(obj=>{if(obj.isPointLight)towerLights.push(obj);});lamps.group.traverse(obj=>{if(obj.isPointLight)pathLights.push(obj);});
  const update=(time,mode,daylight=0,forced=false)=>{
    const env={daylight,...controls.getArtificialLightControls(mode,forced)};
    tower.update(time,env);lamps.update(time,env,new THREE.PerspectiveCamera());
  };
  try{
    update(0,'auto');assert.ok(towerLights.some(light=>light.intensity>0));assert.ok(pathLights.some(light=>light.intensity>0));
    update(1,'lighthouse-off');assert.ok(towerLights.every(light=>light.intensity===0));assert.ok(pathLights.some(light=>light.intensity>0),'只关灯塔不能影响路灯');
    update(2,'all-off');assert.ok([...towerLights,...pathLights].every(light=>light.intensity===0));
    update(3,'auto');assert.ok([...towerLights,...pathLights].some(light=>light.intensity>0));
    update(4,'auto',1);assert.ok([...towerLights,...pathLights].every(light=>light.intensity===0),'自动模式白天仍熄灯');
    update(5,'auto',0,true);assert.ok([...towerLights,...pathLights].every(light=>light.intensity===0),'保留既有音乐场景的熄灯要求');
  }finally{tower.dispose();lamps.dispose();}
});
