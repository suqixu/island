import * as THREE from 'three';
import {getFilmKeyframes} from './film-script.js';
import config from './config/film.json' with {type:'json'};

export function createFilmCamera({camera,controls,landmarks,heightAt=()=>0}) {
  const anchor=new THREE.Vector3(),rotation=new THREE.Quaternion(),position=new THREE.Vector3(),target=new THREE.Vector3(),next=new THREE.Vector3(),focusOffset=new THREE.Vector3();
  let shotId,disposed=false,positionCurve,targetCurve,focus,lastTime,lastSample;
  function reset(){shotId=undefined;lastSample=undefined;}
  function apply(sample){
    if(disposed)return;
    const {shot}=sample;
    if(shot.id!==shotId){
      const entry=typeof landmarks[shot.landmark]==='function'?landmarks[shot.landmark](shot):landmarks[shot.landmark];
      if(!entry)throw new Error('宣传片观看位置尚未准备好');
      anchor.copy(entry.position??entry);rotation.copy(entry.quaternion??new THREE.Quaternion());shotId=shot.id;
      focus=entry.focus;focusOffset.set(0,0,0);lastTime=sample.time;
      positionCurve=shot.camera.length>2?new THREE.CatmullRomCurve3(shot.camera.map(frame=>new THREE.Vector3(...frame.position))):null;
      targetCurve=shot.camera.length>2?new THREE.CatmullRomCurve3(shot.camera.map(frame=>new THREE.Vector3(...frame.target))):null;
    }
    const {from,to,index,progress}=getFilmKeyframes(shot.camera,sample.time-shot.start),p=positionCurve?progress:progress*progress*(3-2*progress);
    if(positionCurve){const t=(index+progress)/(shot.camera.length-1);positionCurve.getPoint(t,position);targetCurve.getPoint(t,target);}
    else{position.fromArray(from.position).lerp(next.fromArray(to.position),p);target.fromArray(from.target).lerp(next.fromArray(to.target),p);}
    position.applyQuaternion(rotation).add(anchor);target.applyQuaternion(rotation).add(anchor);
    if(focus){focus(next).sub(anchor);focusOffset.lerp(next,1-Math.exp(-Math.min(.25,Math.max(0,sample.time-lastTime))*3));position.add(focusOffset);target.add(focusOffset);}lastTime=sample.time;
    const narrow=Math.min(1.8,Math.max(1,Math.sqrt(1/Math.max(.3,camera.aspect))));
    position.sub(target).multiplyScalar(narrow).add(target);
    const floor=heightAt(position.x,position.z);if(Number.isFinite(floor))position.y=Math.max(position.y,floor+config.cameraClearance);
    camera.position.copy(position);controls.target.copy(target);camera.lookAt(target);
    const fov=from.fov+(to.fov-from.fov)*p;
    if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
    lastSample=sample;
  }
  return {apply,reset,reframe(){if(disposed||!lastSample)return false;apply(lastSample);return true;},get aspect(){return camera.aspect;},getPoseAt(sample){const ghost=camera.clone(),targetControls={target:controls.target.clone()};const probe=createFilmCamera({camera:ghost,controls:targetControls,landmarks,heightAt});probe.apply(sample);ghost.updateMatrixWorld(true);probe.dispose();return ghost;},dispose(){disposed=true;reset();}};
}
