import * as THREE from 'three';
import {createNightSky} from '../src/night-sky.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {createSceneCapabilities} from '../src/scene-capabilities/index.js';
import {createFilmSceneScheduling} from '../src/film-scene-scheduling.js';
import {createFilmCamera} from '../src/film-camera.js';
import {sampleFilmScript} from '../src/film-script.js';
import film from '../src/assets/data/films/isola-night-echoes.json' with {type:'json'};
import cameraConfig from '../src/config/camera.json' with {type:'json'};
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color('#071326');const sky=createNightSky();scene.add(sky.group);
const camera=new THREE.PerspectiveCamera(82,innerWidth/innerHeight,.1,10000),controls={target:new THREE.Vector3()},landmarks=Object.fromEntries(Object.entries(cameraConfig.views).map(([id,v])=>[id,new THREE.Vector3(...v.target)]));
for(const shot of film.shots)landmarks[shot.landmark]??=new THREE.Vector3(0,15,0);
const state=createSimulation(),registry=createSceneCapabilities({state,atmosphere:sky}),filmCamera=createFilmCamera({camera,controls,landmarks,heightAt:()=>-100});const scheduling=createFilmSceneScheduling({registry,filmCamera,random:()=>.23});scheduling.begin(film);
function render(time){const sample=sampleFilmScript(film,time);Object.assign(state,{hour:sample.environment.hour,seasonIndex:sample.environment.season,weather:sample.environment.weather,snowCover:sample.environment.snowCover});scheduling.apply(sample);filmCamera.apply(sample);const env=scheduling.composeEnvironment(getEnvironment(state));sky.update(time,env,camera);renderer.render(scene,camera);return env;}
function visibleNames(){camera.updateMatrixWorld();scene.updateMatrixWorld(true);const result=[];sky.group.traverse(o=>{if(!o.isSprite||!o.visible||!o.parent?.visible)return;const p=o.getWorldPosition(new THREE.Vector3()).project(camera);if(Math.abs(p.x)<1&&Math.abs(p.y)<.82&&p.z>-1&&p.z<1)result.push(o.name);});return result;}
document.querySelector('#constellations').onclick=()=>{render(90);document.querySelector('#report').textContent=JSON.stringify({time:90,visibleNames:visibleNames()},null,2);};
document.querySelector('#meteors').onclick=()=>{const sample={time:.8,properties:{},clips:[{id:'pool',capability:'sky.meteor',start:0,end:10,localTime:.8,parameters:{burstCount:32,maxActive:32}}]};sky.sampleFilm({meteor:sample.clips[0]},{seed:5,frameAt:()=>camera});sky.update(0,{daylight:0,cloudiness:0,fog:0,moonLight:0,season:'summer',hour:22},camera);renderer.render(scene,camera);document.querySelector('#report').textContent=`实际流星亮点：${sky.group.getObjectByName('meteor-head').geometry.drawRange.count}`;};
document.querySelector('#run').onclick=()=>{
 try{let samples=0;for(let time=0;time<=film.duration;time+=.25){const env=render(time);if(time===178&&env.lunarEclipse.totality!==1)throw Error('月食未进入全食');samples++;}
 render(90);const names=visibleNames();if(!names.length)throw Error('星座名称未进入画面');
 const heads=sky.group.getObjectByName('meteor-head'),meteorResults=[];for(const count of [0,1,9,18,32]){const frame={id:`count-${count}`,start:118,localTime:.8,parameters:{burstCount:count,maxActive:32}};sky.sampleFilm({meteor:frame},{seed:5,frameAt:()=>filmCamera.getPoseAt(sampleFilmScript(film,118))});sky.update(411+count,{daylight:0,cloudiness:0,fog:0,moonLight:0,season:'summer',hour:22},camera);if(heads.geometry.drawRange.count!==count)throw Error(`流星${count}颗未生效`);meteorResults.push(heads.geometry.drawRange.count);}
 render(90);document.querySelector('#report').textContent=JSON.stringify({passed:true,samples,meteorResults,visibleNames:names,drawCalls:renderer.info.render.calls},null,2);
 }catch(error){document.querySelector('#report').textContent=`失败：${error.message}`;console.error(error);}
};render(90);
