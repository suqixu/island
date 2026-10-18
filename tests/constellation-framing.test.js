import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createNightSky} from '../src/night-sky.js';
const framing=await import('../src/constellation-framing.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;});
const getConstellationViewFov=(...args)=>{
  assert.ok(framing?.getConstellationViewFov,'开启星座时尚未扩大视野');
  return framing.getConstellationViewFov(...args);
};

test('开启星座扩大视野，关闭后恢复各观景模式原本的视野',()=>{
  for(const base of [46,54,66]){
    assert.equal(getConstellationViewFov(base,16/9,false),base);
    assert.ok(getConstellationViewFov(base,16/9,true)>=80);
  }
  assert.equal(getConstellationViewFov(100,16/9,true),100,'不能缩窄已有的更广视野');
});

test('横屏与竖屏都能完整容纳居中的星座轮廓，并保持真实恒星位置',()=>{
  const night=createNightSky();
  try{
    const guides=night.group.getObjectByName('constellation-guides');
    const original=night.group.getObjectByName('catalogue-stars').geometry.attributes.position.array.slice();
    for(const aspect of [16/9,1,390/844]){
      const view=new THREE.PerspectiveCamera(getConstellationViewFov(54,aspect,true),aspect,.5,7000);
      for(const lines of guides.children.filter(child=>child.isLineSegments)){
        const positions=lines.geometry.attributes.position,center=new THREE.Vector3(),point=new THREE.Vector3();
        for(let i=0;i<positions.count;i++)center.add(point.fromBufferAttribute(positions,i));
        view.lookAt(center.normalize());view.updateMatrixWorld();
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).project(view);
          assert.ok(Math.abs(point.x)<.85&&Math.abs(point.y)<.85,`${lines.name} 在宽高比 ${aspect} 下应完整入镜并留有余量`);
        }
      }
    }
    assert.deepEqual(night.group.getObjectByName('catalogue-stars').geometry.attributes.position.array,original);
  }finally{night.dispose();}
});
