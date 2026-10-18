import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const surfaceUrl=new URL('./assets/textures/terrain/powder-snow-albedo-v1.webp',import.meta.url).href;
const flakeUrl=new URL('./assets/textures/sky/snowflake-atlas-runtime-512-v1.webp',import.meta.url).href;

async function load(url,{signal,atlas=false}={}) {
  return loadOptionalResource(async()=>{
    const map=await new THREE.TextureLoader().loadAsync(url);
    map.name=atlas?'ImageGen snowflake atlas':'ImageGen powder snow';
    map.colorSpace=atlas?THREE.NoColorSpace:THREE.SRGBColorSpace;
    if(!atlas)map.wrapS=map.wrapT=THREE.RepeatWrapping;
    map.anisotropy=4;
    return map;
  },{signal,dispose:map=>map?.dispose(),onFallback:error=>console.warn('雪景纹理未就绪，保留基础效果',error)});
}
export const loadSnowSurface=options=>load(surfaceUrl,options);
export const loadSnowFlakes=options=>load(flakeUrl,{...options,atlas:true});
