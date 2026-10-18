import * as THREE from 'three';
import {createAtmosphere} from '../src/atmosphere.js';
import {createOcean} from '../src/ocean.js';
import {getLunarEclipseState,getLunarEclipseEnvironment,getLunarEclipseSeaHorizon} from '../src/lunar-eclipse.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {getMoonBackdropDirection} from '../src/moon-framing.js';
import {loadLunarSurface} from '../src/lunar-surface.js';
import {loadCloudTextures} from '../src/cloud-texture.js';

const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,innerWidth/innerHeight,.5,65000);
camera.position.set(160,52,210);camera.lookAt(0,34,0);camera.updateMatrixWorld();
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('sky'),antialias:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
const [moonMap,cloudMaps]=await Promise.all([loadLunarSurface(),loadCloudTextures()]);
const atmosphere=createAtmosphere(scene,{moonMap,cloudMaps}),ocean=createOcean(scene);
const base={...getEnvironment(createSimulation({hour:22})),cloudiness:.03,skyCloudCover:.05};
const slider=document.getElementById('phase'),output=document.getElementById('state');
let phase=.25,running=false,last=performance.now(),time=0,raf=null;
function render(){
  const eclipse=getLunarEclipseState(document.getElementById('enabled').checked?phase:undefined),env=getLunarEclipseEnvironment(base,eclipse);
  env.seaHorizon=getLunarEclipseSeaHorizon(env);
  env.moonDirection=getMoonBackdropDirection(camera,innerWidth,env);
  if(document.getElementById('detail').checked)env.moonDirection.addScaledVector(camera.up,.02).normalize();
  atmosphere.update(time,env,camera);
  if(document.getElementById('detail').checked)atmosphere.group.getObjectByName('phase-moon').scale.multiplyScalar(2.35);
  ocean.update(time,env);renderer.render(scene,camera);
  output.textContent=`进度 ${Math.round(phase*100)}% · 地影遮挡 ${Math.round(eclipse.coverage*100)}% · 月光 ${Math.round(eclipse.lightFactor*100)}% · 红光 ${Math.round(env.lunarBloodStrength*100)}% · 天空染色 ${Math.round(env.lunarSkyTintStrength*100)}% · 光晕 ${Math.round(env.lunarHaloFactor*100)}% · ${eclipse.totality>.9?'红月全食':eclipse.coverage>0?'偏食':'明亮满月'}`;
}
document.querySelectorAll('[data-phase]').forEach(button=>button.onclick=()=>{running=false;phase=Number(button.dataset.phase);slider.value=phase;render();});
slider.oninput=()=>{running=false;phase=Number(slider.value);render();};
document.getElementById('enabled').onchange=render;
document.getElementById('detail').onchange=render;
document.getElementById('play').onclick=()=>{phase=0;running=true;last=performance.now();if(raf===null)raf=requestAnimationFrame(tick);};
document.getElementById('fov').onchange=event=>{camera.fov=Number(event.target.value);camera.updateProjectionMatrix();render();};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();}
addEventListener('resize',resize);resize();
function tick(now){raf=null;if(!running||document.hidden)return;const dt=Math.min(.1,(now-last)/1000);last=now;time+=dt;phase=Math.min(1,phase+dt/96);slider.value=phase;if(phase===1)running=false;render();if(running)raf=requestAnimationFrame(tick);}
addEventListener('visibilitychange',()=>{if(!document.hidden&&running&&raf===null){last=performance.now();raf=requestAnimationFrame(tick);}});
addEventListener('pagehide',()=>{running=false;if(raf!==null)cancelAnimationFrame(raf);ocean.dispose();atmosphere.dispose();renderer.dispose();},{once:true});
