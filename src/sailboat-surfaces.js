import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const atlasUrl=new URL('./assets/textures/boats/sailboat-materials-v1.webp',import.meta.url).href;
const released=new WeakSet();
const textures=maps=>Object.values(maps??{}).flatMap(material=>Object.values(material??{})).filter(texture=>texture?.isTexture);

/** Shared bundles own their maps; replacement, cancellation and teardown converge here. */
export function disposeSailboatSurfaceMaps(maps,preserve=new Set()){
  for(const texture of new Set(textures(maps))){
    if(preserve.has(texture)||released.has(texture))continue;
    released.add(texture);texture.dispose();
  }
}
function configure(texture,colorSpace){
  texture.colorSpace=colorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.anisotropy=4;texture.flipY=true;texture.unpackAlignment=1;texture.needsUpdate=true;
  return texture;
}

/** Split once, retaining neutral grain rather than replacing the boat's paint. */
export function createSailboatSurfaceMaps(rgba,width,height){
  const half=Math.floor(width/2),maps={};
  if(half<1||height<1||rgba.length<width*height*4)throw new Error('Invalid sailboat material atlas');
  for(const [kind,offset] of [['cloth',0],['wood',half]]){
    const color=new Uint8Array(half*height*4),relief=new Uint8Array(half*height);
    const base=kind==='cloth'?220:178,contrast=255-base;
    for(let y=0;y<height;y++)for(let x=0;x<half;x++){
      const source=(y*width+x+offset)*4,i=y*half+x;
      const luma=(rgba[source]*.2126+rgba[source+1]*.7152+rgba[source+2]*.0722)/255;
      const value=Math.round(base+luma*contrast);
      color.set([value,value,value,255],i*4);relief[i]=Math.round(luma*255);
    }
    const albedo=configure(new THREE.DataTexture(color,half,height,THREE.RGBAFormat),THREE.SRGBColorSpace);
    const bump=configure(new THREE.DataTexture(relief,half,height,THREE.RedFormat),THREE.NoColorSpace);
    albedo.name=`帆船 ${kind} · 中性写实纹理`;bump.name=`帆船 ${kind} · 单通道微凹凸`;
    maps[kind]={albedo,relief:bump};
  }
  return maps;
}
function readAtlas(texture){
  const image=texture.image;
  if(image?.data)return{rgba:image.data,width:image.width,height:image.height};
  if(!image||typeof document==='undefined')throw new Error('Sailboat material image unavailable');
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('Sailboat material canvas unavailable');
  context.drawImage(image,0,0,1024,512);
  return{rgba:context.getImageData(0,0,1024,512).data,width:1024,height:512};
}

/** Optional 4 s request. Late atlases are released before any pixel work. */
export async function loadSailboatSurfaces({signal,loadTexture=()=>new THREE.TextureLoader().loadAsync(atlasUrl),schedule,cancel}={}){
  const discard=texture=>disposeSailboatSurfaceMaps({atlas:{albedo:texture}});
  const atlas=await loadOptionalResource(()=>loadTexture(atlasUrl),{signal,timeoutMs:4000,retries:0,dispose:discard,
    ...(schedule?{schedule}:{}),...(cancel?{cancel}:{})});
  if(!atlas)return null;
  try{
    if(signal?.aborted)return null;
    const {rgba,width,height}=readAtlas(atlas);
    return createSailboatSurfaceMaps(rgba,width,height);
  }catch{return null;}
  finally{discard(atlas);}
}
