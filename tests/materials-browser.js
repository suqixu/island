import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createIsland} from '../src/models/island.js';
import {createOcean} from '../src/ocean.js';
import {createAtmosphere} from '../src/atmosphere.js';
import {createLighthouse} from '../src/models/lighthouse.js';
import {LIGHTHOUSE_SITE} from '../src/lighthouse-layout.js';
import {createSailboats} from '../src/models/sailboats.js';
import {loadDockSurfaces,loadLighthouseSurfaces,loadPavilionRoofSurfaces,createStructureSurfaceState} from '../src/structure-surfaces.js';
import {createRestPavilion} from '../src/models/rest-pavilion.js';
import {REST_PAVILION_SITES} from '../src/rest-pavilion-layout.js';
import {createPavilionSurfaceSampler} from '../src/rest-pavilion-surface.js';
import {loadCoastalSurfaces} from '../src/coastal-surfaces.js';
import {loadRockSurface} from '../src/rock-surface.js';
import {loadLeafTextures} from '../src/leaf-texture.js';
import {loadCloudTextures} from '../src/cloud-texture.js';
import {loadLunarSurface} from '../src/lunar-surface.js';
import {getLunarEclipseState,getLunarEclipseEnvironment,getLunarEclipseSeaHorizon} from '../src/lunar-eclipse.js';
import {getMoonBackdropDirection} from '../src/moon-framing.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {getLagoonShelter} from '../src/lagoon.js';

const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
document.body.prepend(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.15,65000);
const controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=1;controls.maxDistance=1000;
const island=createIsland(scene),ocean=createOcean(scene,{heightAt:island.heightAtRendered,shelterAt:getLagoonShelter});
const lighthouse=createLighthouse(scene,{...LIGHTHOUSE_SITE,heightAt:island.heightAtRendered});
const pavilionHeight=createPavilionSurfaceSampler(island,REST_PAVILION_SITES);
const pavilions=REST_PAVILION_SITES.map(site=>createRestPavilion(scene,{...site,heightAt:pavilionHeight,
  approach:{...site.approach,y:pavilionHeight(site.approach.x,site.approach.z)}}));
const roofOwner=createStructureSurfaceState();
const boats=createSailboats(scene,{heightAt:island.heightAtRendered,seed:20261018});
camera.position.set(160,52,210);controls.target.set(0,34,0);controls.update();camera.updateMatrixWorld();
let env=getEnvironment(createSimulation({hour:14,season:'summer',weather:'sunny'}));
boats.update(0,env,camera);boats.update(30,env,camera);
const [cloudMaps,dockMaps,towerMaps,coastalMaps,rockMap,leafMaps,roofMaps,moonMap]=await Promise.all([
  loadCloudTextures(),loadDockSurfaces(),loadLighthouseSurfaces(),loadCoastalSurfaces(),loadRockSurface(),loadLeafTextures(),loadPavilionRoofSurfaces(),loadLunarSurface(),boats.loadSurfaces(),ocean.ready,
]);
roofOwner.setMaps(roofMaps);pavilions.forEach(pavilion=>pavilion.setSurfaceMaps({wood:dockMaps,roof:roofMaps}));
island.setDockMaps(dockMaps);lighthouse.setSurfaceMaps(towerMaps);lighthouse.setStepMap(coastalMaps.stone);island.setCoastalMaps(coastalMaps);island.setRockMap(rockMap);island.setLeafMaps(leafMaps);
const atmosphere=createAtmosphere(scene,{cloudMaps,moonMap});
function render(){camera.updateMatrixWorld();if(env.lunarEclipse?.active)env.moonDirection=getMoonBackdropDirection(camera,innerWidth,env);island.update(30,env);ocean.update(30,env);lighthouse.update(30,env,camera);pavilions.forEach(pavilion=>pavilion.update(30,env));atmosphere.update(30,env,camera);renderer.render(scene,camera);}
function view(name){
  env=getEnvironment(createSimulation({hour:['bed','overhead'].includes(name)?17.1:14,season:'summer',weather:'sunny'}));
  if(name==='blood'){env=getLunarEclipseEnvironment(getEnvironment(createSimulation({hour:22,season:'summer',weather:'sunny'})),getLunarEclipseState(.5));env.seaHorizon=getLunarEclipseSeaHorizon(env);}
  if(name==='boat'){
    const ship=boats.group.children.find(ship=>ship.visible),variant=ship?.children.find(child=>child.visible);
    if(!variant){document.querySelector('#status').textContent='当前航线没有可见帆船';return;}
    ship.updateWorldMatrix(true,true);
    const box=new THREE.Box3().setFromObject(variant),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
    controls.target.copy(centre);camera.position.copy(centre).add(new THREE.Vector3(size.y*1.4,size.y*.3,size.y*1.8));
  }else if(name==='pavilion'){
    const site=REST_PAVILION_SITES[0],direction=new THREE.Vector3(site.entranceDirection.x,0,site.entranceDirection.z).normalize();
    controls.target.copy(pavilions[0].group.position).add(new THREE.Vector3(0,1.5,0));
    camera.position.copy(controls.target).addScaledVector(direction,5.5).add(new THREE.Vector3(direction.z*2,1.1,-direction.x*2));
  }else if(name==='steps'){
    controls.target.copy(lighthouse.group.position).add(new THREE.Vector3(3,.3,0));camera.position.copy(lighthouse.group.position).add(new THREE.Vector3(10,5,10));
  }else if(name==='lighthouse'){
    controls.target.copy(lighthouse.group.position).add(new THREE.Vector3(1,3.5,0));camera.position.copy(lighthouse.group.position).add(new THREE.Vector3(14,11,18));
  }else{
    const presets={dock:[[12,4.5,110],[5,1.7,99]],'dock-main':[[40,12,128],[5,5,60]],'stair-debug':[[14,9,85],[1,5,57]],'stair-top':[[-2,35,59],[-2,5.3,58]],blood:[[210,90,260],[0,14,0]],sand:[[20,2.2,78],[13,.8,68]],edge:[[20,10,95],[0,5,65]],bed:[[260,105,345],[0,8,0]],overhead:[[110,470,155],[0,0,0]]};
    camera.position.fromArray(presets[name][0]);controls.target.fromArray(presets[name][1]);
  }
  controls.update();render();document.querySelector('#status').textContent=`材质就绪 · ${renderer.info.render.calls}次绘制 · 拖动可检查近景`;
}
controls.addEventListener('change',render);
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);render();});
view('dock');
addEventListener('pagehide',()=>{controls.dispose();boats.dispose();pavilions.forEach(pavilion=>pavilion.dispose());roofOwner.dispose();lighthouse.dispose();ocean.dispose();atmosphere.dispose();island.dispose();renderer.dispose();renderer.forceContextLoss();},{once:true});
