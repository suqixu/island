import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import * as THREE from 'three';
import {parseFilmScript,sampleFilmScript} from '../src/film-script.js';
import {sampleFilmSchedule} from '../src/scene-capabilities/sampling.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {getSunBackdropState,getSunDiscProjection,getSunVisibility} from '../src/sun-framing.js';
import {createFilmCamera} from '../src/film-camera.js';
const source=()=>readFileSync(new URL('../src/assets/data/films/isola-sunset.json',import.meta.url),'utf8');
test('渔舟唱晚的日落时间连续单向，片尾停留暮色、无月无星，银鱼与渔船可调度',()=>{
 const film=parseFilmScript(source());assert.equal(film.duration,60);assert.equal(film.title,'浮屿 · 渔舟唱晚');
 let previous=0;for(let t=0;t<=60;t+=.25){const frame=sampleFilmSchedule(film,t),hour=frame.properties['scene.hour']??sampleFilmScript(film,t).environment.hour;assert.ok(hour>=previous);previous=hour;assert.equal(frame.properties['sky.moon.enabled'],false);assert.equal(frame.properties['sky.stars.enabled'],false);}
 const a=sampleFilmSchedule(film,50).properties['scene.hour'],b=sampleFilmSchedule(film,59).properties['scene.hour'];assert.equal(a,b);
 const env=getEnvironment(createSimulation({hour:b}));const height=env.sun[1]/Math.hypot(...env.sun);assert.equal(getSunVisibility({...env,sunHeight:height}),0);assert.ok(env.daylight>.05,'保留暮光，不能直接到黑夜');
 const shot=film.shots.at(-1);assert.deepEqual(shot.camera.at(-1).position,shot.camera.at(-2).position);assert.deepEqual(shot.camera.at(-1).target,shot.camera.at(-2).target);
 for(const capability of ['wildlife.fishWave','wildlife.sailboat','wildlife.sunsetBird'])assert.ok(film.clips.some(c=>c.capability===capability));
});
test('影片可以放大完整太阳，普通漫游尺寸保持原样',()=>{
 const camera=new THREE.PerspectiveCamera(46,16/9,.5,7000);camera.position.set(180,20,260);camera.lookAt(550,5,780);camera.updateMatrixWorld();
 const direction=new THREE.Vector3(.3,.2,.7).normalize();
 const normal=getSunBackdropState(camera,1280,720,direction),film=getSunBackdropState(camera,1280,720,direction,80);
 const projection=getSunDiscProjection(camera,film.direction,film.angularRadius);assert.ok(Math.abs(projection.radius*720-80)<.2);assert.ok(projection.center.y+projection.radius<1);assert.ok(projection.center.y-projection.radius>-1);
 assert.ok(film.angularRadius>normal.angularRadius*2);
});
test('竖屏重构图仍在离岸海面观看，不因远处注视点把摄影机拉回岛上',()=>{
 const film=parseFilmScript(source()),camera=new THREE.PerspectiveCamera(46,390/844,.5,65000),controls={target:new THREE.Vector3()};
 const filmCamera=createFilmCamera({camera,controls,landmarks:{island:new THREE.Vector3(0,15,0)},heightAt:()=>-30});
 try{for(const time of [0,13,26,33,43,54]){filmCamera.apply(sampleFilmScript(film,time));assert.ok(Math.hypot(camera.position.x,camera.position.z)>200,`${time}秒竖屏镜头不可退回岛内`);}}finally{filmCamera.dispose();}
});
