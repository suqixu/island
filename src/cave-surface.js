import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const url=new URL('./assets/textures/terrain/cave-rock-albedo-v1.webp',import.meta.url).href;
const disposedTextures=new WeakSet();
const clamp=THREE.MathUtils.clamp,smooth=THREE.MathUtils.smoothstep;

/** A bundle is shared by all cave materials; every owned texture is released once. */
export function disposeCaveSurfaceMaps(maps,preserve=new Set()){
  for(const texture of new Set(Object.values(maps??{}))){
    if(!texture?.isTexture||preserve.has(texture)||disposedTextures.has(texture))continue;
    disposedTextures.add(texture);texture.dispose();
  }
}
function configure(texture,colorSpace=THREE.NoColorSpace){
  texture.colorSpace=colorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;return texture;
}

/** Image-derived scalar data, sampled once after load. No runtime canvas or noise. */
export function createCaveDetailMaps(rgba,width,height){
  const luminance=new Float32Array(width*height),relief=new Uint8Array(width*height),roughness=new Uint8Array(width*height);
  for(let i=0;i<luminance.length;i++)luminance[i]=(rgba[i*4]*.2126+rgba[i*4+1]*.7152+rgba[i*4+2]*.0722)/255;
  const at=(x,y)=>luminance[((y+height)%height)*width+(x+width)%width];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,luma=luminance[i];
    const neighbors=(at(x-1,y)+at(x+1,y)+at(x,y-1)+at(x,y+1))*.25;
    const contrast=Math.abs(luma-neighbors),crack=smooth(neighbors-luma,.04,.20);
    // Only smooth, moderately dark patches become damp. Deep cracks remain rough.
    const wet=smooth(luma,.14,.24)*(1-smooth(luma,.32,.47))*(1-smooth(contrast,.035,.13));
    relief[i]=Math.round(clamp(.18+luma*.72-crack*.12,0,1)*255);
    roughness[i]=Math.round(clamp(.92+crack*.07-wet*.32,.60,.99)*255);
  }
  const make=(data,name)=>{const texture=configure(new THREE.DataTexture(data,width,height,THREE.RedFormat));texture.unpackAlignment=1;texture.flipY=true;texture.name=name;return texture;};
  return{relief:make(relief,'Cave photo scalar relief'),roughness:make(roughness,'Cave photo scalar roughness')};
}
function deriveFromImage(albedo){
  if(!albedo.image||typeof document==='undefined')return{};
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context?.drawImage||!context?.getImageData)return{};
  context.drawImage(albedo.image,0,0,512,512);
  return createCaveDetailMaps(context.getImageData(0,0,512,512).data,512,512);
}

/** Optional, bounded to 4 s total. Failure keeps the existing procedural cave. */
export async function loadCaveSurface({signal,loadTexture=()=>new THREE.TextureLoader().loadAsync(url),schedule,cancel}={}){
  const albedo=await loadOptionalResource(()=>loadTexture(url),{signal,timeoutMs:4000,retries:0,
    dispose:texture=>disposeCaveSurfaceMaps({albedo:texture}),...(schedule?{schedule}:{}),...(cancel?{cancel}:{})});
  if(!albedo)return null;
  if(signal?.aborted){disposeCaveSurfaceMaps({albedo});return null;}
  configure(albedo,THREE.SRGBColorSpace);albedo.name='Imagegen seamless limestone cave rock';
  let details={};
  // Derive only after a timely load. Late resources are discarded without canvas work.
  // A missing/tainted canvas must not discard an otherwise usable albedo.
  try{details=deriveFromImage(albedo);}catch{/* Existing scalar maps stay in use. */}
  return{albedo,...details};
}
