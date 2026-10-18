import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const urls={
  broadleaf:new URL('./assets/textures/vegetation/broadleaf-veins-albedo-v1.webp',import.meta.url).href,
  palm:new URL('./assets/textures/vegetation/palm-leaflet-albedo-v1.webp',import.meta.url).href,
};
export async function loadLeafTextures({signal}={}) {
  const loader=new THREE.TextureLoader();
  return Object.fromEntries(await Promise.all(Object.entries(urls).map(async([name,url])=>{
    const map=await loadOptionalResource(async()=>{
      const map=await loader.loadAsync(url);map.name=`Imagegen ${name} leaf veins`;
      map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
      return map;
    },{signal,dispose:value=>value?.dispose()});
    return [name,map];
  })));
}

/** One pair of shared maps for all trees, palms, ferns and cave vines. */
export function createLeafTextureState() {
  const broadleaf={uLeafAlbedo:{value:null},uLeafAlbedoEnabled:{value:0}};
  const palm={uLeafAlbedo:{value:null},uLeafAlbedoEnabled:{value:0}};
  const entries={broadleaf,palm};let disposed=false;
  function setMaps(maps) {
    if(disposed){for(const map of new Set(Object.values(maps)))map?.dispose();return;}
    const previous=new Set(Object.values(entries).map(value=>value.uLeafAlbedo.value));
    for(const [name,uniforms]of Object.entries(entries))if(name in maps){
      uniforms.uLeafAlbedo.value=maps[name];uniforms.uLeafAlbedoEnabled.value=maps[name]?1:0;
    }
    const current=new Set(Object.values(entries).map(value=>value.uLeafAlbedo.value));
    for(const map of previous)if(map&&!current.has(map))map.dispose();
  }
  function dispose(){if(disposed)return;setMaps({broadleaf:null,palm:null});disposed=true;}
  return {broadleaf,palm,setMaps,dispose};
}

/** Leaf-local UVs follow the wind deformation; existing colours keep the seasons.
 * Geometry already supplies its outline, so no alpha layers or shadow changes.
 */
export function attachLeafTexture(material,uniforms,{mixed=false,snow='uSnow'}={}) {
  if(!uniforms||material.userData.leafTexture)return material;
  material.userData.leafTexture=true;
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=`varying vec2 vBotanicalUv; varying float vBotanicalMask;
      ${mixed?'attribute float aLeafTexture;':''}\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vBotanicalUv=uv;vBotanicalMask=${mixed?'aLeafTexture':'1.0'};`);
    shader.fragmentShader=`uniform sampler2D uLeafAlbedo; uniform float uLeafAlbedoEnabled;
      varying vec2 vBotanicalUv; varying float vBotanicalMask;
      vec3 botanicalNormal(vec3 position,vec3 surfaceNormal,float height,float facing) {
        vec3 sx=normalize(dFdx(position)),sy=normalize(dFdy(position));
        vec3 rx=cross(sy,surfaceNormal),ry=cross(surfaceNormal,sx);
        float determinant=dot(sx,rx)*facing;
        vec3 gradient=sign(determinant)*(dFdx(height)*rx+dFdy(height)*ry);
        return normalize(max(abs(determinant),0.00001)*surfaceNormal-gradient);
      }\n${shader.fragmentShader}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float botanicalLight=0.13;
      float botanicalWeight=uLeafAlbedoEnabled*vBotanicalMask*(1.0-clamp(${snow},0.0,1.0));
      if(uLeafAlbedoEnabled>0.5) {
        vec3 botanicalAlbedo=texture2D(uLeafAlbedo,clamp(vBotanicalUv,0.0,1.0)).rgb;
        botanicalLight=dot(botanicalAlbedo,vec3(0.2126,0.7152,0.0722));
        // Albedo modulation avoids multiplying dark green by dark green.
        diffuseColor.rgb*=mix(1.0,clamp(0.45+botanicalLight*4.2,0.65,1.55),botanicalWeight);
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      normal=botanicalNormal(-vViewPosition,normal,botanicalLight*0.002*botanicalWeight,faceDirection);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,0.82-clamp(botanicalLight,0.0,0.4)*0.2,botanicalWeight);`);
  };
  material.customProgramCacheKey=()=>`${key}|botanical-albedo-v1-${mixed}-${snow}`;
  return material;
}
