import * as THREE from 'three';
import {createAtmosphere} from '/src/atmosphere.js';
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,innerWidth/innerHeight,.5,65000);
camera.position.set(200,75,260);camera.lookAt(0,47,0);camera.updateMatrixWorld(true);
const env={hour:14.5,daylight:1,weather:'sunny',season:'summer',wind:.2,windSpeed:3,rain:0,storm:0,fog:0,snow:0,cloudiness:.12,skyCloudCover:.2,moonLight:0,instantFilmFrame:true};
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const values=[];
const originalRandom=Math.random;let appearanceRoll=.1;Math.random=()=>appearanceRoll;
let atmosphere;
try{
 atmosphere=createAtmosphere(scene);const sky=atmosphere.group.children.find(o=>o.material?.uniforms?.uRainbowStrength);
 const draw=(time,patch={})=>{atmosphere.update(time,{...env,...patch},camera);return sky.material.uniforms.uRainbowStrength.value};
 draw(0,{weather:'rain',rain:1});draw(1);const before=draw(21),secondaryBefore=sky.material.uniforms.uRainbowSecondary.value;appearanceRoll=.99;assert(before>.7,'自然彩虹应已出现');
 atmosphere.beginFilm();assert(draw(40,{weather:'typhoon',rain:1,storm:1})===0,'影片隐藏原自然彩虹');
 assert(draw(50,{rainbowStrength:.8})===.8,'片尾彩虹直接作用于天空材质');
 assert(draw(60,{rainbowStrength:0})===0,'倒拖可立即收起彩虹');atmosphere.endFilm();
 const restored=draw(60);assert(sky.material.uniforms.uRainbowSecondary.value===secondaryBefore,'退出必须保留同一自然彩虹的单双虹形态');assert(Math.abs(restored-before)<1e-8,'退出应恢复自然彩虹的剩余寿命');assert(draw(130)===0,'自然彩虹仍正常到期');
 values.push({before,restored,secondaryBefore,secondaryAfter:sky.material.uniforms.uRainbowSecondary.value});atmosphere.dispose();
 atmosphere=createAtmosphere(scene);const drySky=atmosphere.group.children.find(o=>o.material?.uniforms?.uRainbowStrength);
 atmosphere.update(0,env,camera);atmosphere.beginFilm();
 atmosphere.update(30,{...env,weather:'rain',rain:1},camera);atmosphere.update(58,{...env,rainbowStrength:1},camera);atmosphere.endFilm();
 atmosphere.update(80,env,camera);assert(drySky.material.uniforms.uRainbowStrength.value===0,'影片降雨不能产生额外的漫游彩虹');
 window.result={passed:true,values};
}catch(error){window.result={passed:false,error:String(error),stack:error.stack};}
finally{Math.random=originalRandom;atmosphere?.dispose();document.querySelector('#report').textContent=JSON.stringify(window.result,null,2);}
