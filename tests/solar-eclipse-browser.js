import * as THREE from 'three';
import {createAtmosphere} from '../src/atmosphere.js';
import {createOcean} from '../src/ocean.js';
import {getSolarEclipseState} from '../src/solar-eclipse.js';
import {getSunBackdropState} from '../src/sun-framing.js';
import {getSeaHorizonState} from '../src/sea-horizon.js';

const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(54,innerWidth/innerHeight,.5,65000);
camera.position.set(160,68,200);camera.lookAt(0,15,0);camera.updateMatrixWorld();
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('sky'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
const atmosphere=createAtmosphere(scene,{moonMap:new THREE.Texture()}),ocean=createOcean(scene);
const slider=document.getElementById('phase'),output=document.getElementById('state');let phase=.5,running=false,last=performance.now(),time=0;
function render(){
  const eclipse=getSolarEclipseState(phase),sunDirection=new THREE.Vector3(0,1,.55).normalize();
  const framing=getSunBackdropState(camera,innerWidth,innerHeight,sunDirection);
  const env={hour:12,season:'summer',weather:'sunny',solarDaylight:1,daylight:eclipse.lightFactor,eclipse,
    sunDirection,sun:[0,1,.55],sunBackdropDirection:framing.direction,sunAngularRadius:framing.angularRadius*(1+eclipse.coverage*.8),
    cloudiness:.12,skyCloudCover:.18,fog:0,rain:0,snow:0,storm:0,wind:.22,moonLight:0,moonVisibility:0,moonIllumination:0};
  env.seaHorizon=getSeaHorizonState(env);atmosphere.update(time,env,camera);ocean.update(time,env);renderer.render(scene,camera);
  output.textContent=`进度 ${Math.round(phase*100)}% · 太阳遮挡 ${Math.round(eclipse.coverage*100)}% · ${eclipse.totality>.9?'全食 · 日冕显现':eclipse.coverage>0?'偏食':'正常日光'}`;
}
document.querySelectorAll('[data-phase]').forEach(button=>button.onclick=()=>{running=false;phase=Number(button.dataset.phase);slider.value=phase;render();});
slider.oninput=()=>{running=false;phase=Number(slider.value);render();};
document.getElementById('play').onclick=()=>{phase=0;running=true;};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();}
addEventListener('resize',resize);resize();
renderer.setAnimationLoop(now=>{const dt=Math.min(.1,(now-last)/1000);last=now;time+=dt;if(running){phase=Math.min(1,phase+dt/48);slider.value=phase;if(phase===1)running=false;}render();});
addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);ocean.dispose();atmosphere.dispose();renderer.dispose();},{once:true});
