import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createNightSky} from '../src/night-sky.js';
import {ZODIAC_CONSTELLATIONS} from '../src/zodiac-constellations.js';
import {COMET_STYLES} from '../src/comet-styles.js';
import {getConstellationViewFov} from '../src/constellation-framing.js';

const scene=new THREE.Scene();scene.background=new THREE.Color('#070f25');
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('sky'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;
const camera=new THREE.PerspectiveCamera(66,innerWidth/innerHeight,.1,7000);camera.position.set(0,0,.001);
const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableZoom=false;controls.enableDamping=false;
let night=createNightSky(),elapsed=0,env;
scene.add(night.group);
const running=document.getElementById('running'),state=document.getElementById('state'),guides=document.getElementById('guides');
const constellation=document.getElementById('constellation');
const cometVariant=document.getElementById('comet-variant');
for(const {name} of ZODIAC_CONSTELLATIONS)constellation.add(new Option(name,name));
for(const {id,name} of COMET_STYLES)cometVariant.add(new Option(name,id));
function reset(){
  night.dispose();const index=COMET_STYLES.findIndex(style=>style.id===cometVariant.value);
  night=createNightSky({cometRandom:index<0?Math.random:()=>(index+.5)/COMET_STYLES.length});
  scene.add(night.group);night.setQuality(document.getElementById('quality').value);night.setConstellationsVisible(guides.checked);elapsed=0;
}
function preset(kind){
  constellation.value='';camera.fov=getConstellationViewFov(66,camera.aspect,guides.checked);camera.updateProjectionMatrix();
  reset();env={hour:22,season:'summer',daylight:0,cloudiness:0,skyCloudCover:0,fog:0,moonLight:0,sun:[-.4,-.7,.2]};
  camera.position.set(0,0,.001);controls.target.set(.39,.44,-.81);
  if(kind==='orion'){env.season='winter';controls.target.set(.37,.8,-.47);}
  if(kind==='moon')env.moonLight=1;
  if(kind==='day'){env.daylight=1;scene.background.set('#5e9dcc');}else scene.background.set('#070f25');
  if(kind==='fog')env.fog=1;
  controls.update();night.update(0,env,camera);running.checked=true;render();
}
function render(){
  night.update(elapsed,env,camera);renderer.render(scene,camera);
  const meteor=night.group.getObjectByName('meteor'),comet=night.group.getObjectByName('comet');
  const streaks=meteor.geometry.drawRange.count/6,burst=night.group.getObjectByName('meteor-shower');
  state.textContent=`${constellation.value?`${constellation.value} · `:''}夜空观察 ${elapsed.toFixed(2)} 秒 · ${night.group.visible?'夜空可见':'夜空已隐藏'} · ${meteor.visible?`流星雨 ${streaks} 条轨迹（本组${burst.userData.burstCount}颗）`:'无流星雨'} · ${comet.visible?`彗星：${comet.userData.variantName}`:'无彗星'}`;
}
function fitConstellation(lines){
  camera.updateMatrixWorld();
  const point=new THREE.Vector3(),positions=lines.geometry.attributes.position,rotation=lines.parent.parent.quaternion;
  let tangent=0;
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyQuaternion(rotation).add(night.group.position).applyMatrix4(camera.matrixWorldInverse);
    tangent=Math.max(tangent,Math.abs(point.y)/-point.z,Math.abs(point.x)/(-point.z*camera.aspect));
  }
  camera.fov=THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2*Math.atan(tangent*1.25)),66,120);camera.updateProjectionMatrix();
}
constellation.onchange=()=>{
  const name=constellation.value;if(!name)return;
  preset('milky');constellation.value=name;guides.checked=true;night.setConstellationsVisible(true);
  const lines=night.group.getObjectByName('constellation-guides').getObjectByName(name);
  const center=new THREE.Vector3(),point=new THREE.Vector3(),positions=lines.geometry.attributes.position;
  for(let i=0;i<positions.count;i++)center.add(point.fromBufferAttribute(positions,i));
  center.normalize();
  // Bring the actual star pattern to upper culmination, then aim the view at it.
  // Only the test scene's observing time changes; the celestial map stays intact.
  env.season='spring';env.hour=(12+Math.atan2(center.z,center.x)*12/Math.PI+24)%24;
  night.update(elapsed,env,camera);
  center.applyQuaternion(lines.parent.parent.quaternion);
  controls.target.copy(center).add(camera.position);controls.update();fitConstellation(lines);running.checked=false;render();
};
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>preset(button.dataset.preset));
document.querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{
  preset('milky');running.checked=false;const kind=button.dataset.event;
  for(let frame=0;frame<3000;frame++){
    elapsed+=.05;night.update(elapsed,env,camera);
    const object=night.group.getObjectByName(kind);
    const targetCount=night.group.getObjectByName('meteor-shower').userData.burstCount??1;
    if(object.visible&&object.material.uniforms.uOpacity.value>(kind==='comet'?.75:.35)&&(kind!=='meteor'||(object.geometry.drawRange.count>=targetCount*6&&object.geometry.attributes.aOpacity.getX((targetCount-1)*4)>.3)))break;
  }
  if(kind==='comet'){
    const positions=night.group.getObjectByName('comet').geometry.attributes.position,center=new THREE.Vector3(),point=new THREE.Vector3();
    for(let i=0;i<positions.count;i++)center.add(point.fromBufferAttribute(positions,i));
    const nucleus=new THREE.Vector3().fromBufferAttribute(positions,0).add(new THREE.Vector3().fromBufferAttribute(positions,1)).multiplyScalar(.5);
    controls.target.copy(center.multiplyScalar(1/positions.count).lerp(nucleus,.35)).add(night.group.position);controls.update();camera.fov=45;camera.updateProjectionMatrix();
    running.checked=true;
  }
  render();
});
cometVariant.onchange=()=>document.querySelector('[data-event="comet"]').click();
document.getElementById('quality').onchange=event=>{night.setQuality(event.target.value);renderer.setPixelRatio(Math.min(devicePixelRatio,event.target.value==='low'?.8:1.7));resize();};
guides.onchange=()=>{night.setConstellationsVisible(guides.checked);camera.fov=getConstellationViewFov(66,camera.aspect,guides.checked);camera.updateProjectionMatrix();if(constellation.value)fitConstellation(night.group.getObjectByName('constellation-guides').getObjectByName(constellation.value));render();};
function resize(){camera.aspect=innerWidth/innerHeight;camera.fov=getConstellationViewFov(66,camera.aspect,guides.checked);camera.updateProjectionMatrix();if(constellation.value)fitConstellation(night.group.getObjectByName('constellation-guides').getObjectByName(constellation.value));renderer.setSize(innerWidth,innerHeight);render();}
window.addEventListener('resize',resize);
window.addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);controls.dispose();night.dispose();renderer.dispose();});
preset('milky');resize();let previous=performance.now();
renderer.setAnimationLoop(now=>{const delta=Math.min(.1,Math.max(0,(now-previous)/1000));previous=now;if(!document.hidden&&running.checked)elapsed+=delta;render();});
