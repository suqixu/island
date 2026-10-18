import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const url=new URL('./assets/textures/terrain/coastal-rock-albedo-v1.jpg',import.meta.url).href;
export async function loadRockSurface({signal}={}){
  return loadOptionalResource(async()=>{
  const map=await new THREE.TextureLoader().loadAsync(url);
  map.name='Imagegen coastal volcanic rock';map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
  return map;
  },{signal,dispose:map=>map?.dispose(),onFallback:error=>console.warn('山石贴图未就绪，保留基础材质',error)});
}
