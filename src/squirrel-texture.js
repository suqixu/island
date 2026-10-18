import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';
const url=new URL('./assets/textures/vegetation/squirrel-fur-albedo-v1.webp',import.meta.url).href;
export function loadSquirrelFur({signal}={}){return loadOptionalResource(async()=>{const map=await new THREE.TextureLoader().loadAsync(url);map.name='Imagegen squirrel fur';map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;},{signal,dispose:map=>map?.dispose()});}
export function createSquirrelSurface(){
  const uniforms={uSquirrelFur:{value:null},uSquirrelFurEnabled:{value:0}};let disposed=false;
  function setMap(map){if(disposed){map?.dispose();return;}const previous=uniforms.uSquirrelFur.value;if(previous===map)return;uniforms.uSquirrelFur.value=map;uniforms.uSquirrelFurEnabled.value=map?1:0;previous?.dispose();}
  return {uniforms,setMap,dispose(){if(disposed)return;setMap(null);disposed=true;}};
}
export function attachSquirrelSurface(material,uniforms){
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=`attribute vec2 aSquirrelLook;attribute float aSquirrelHead;varying vec2 vFurUv;\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float hy=aSquirrelLook.x*aSquirrelHead,hp=aSquirrelLook.y*aSquirrelHead;
      mat3 squirrelHead=mat3(cos(hy),0.,-sin(hy),0.,1.,0.,sin(hy),0.,cos(hy))*mat3(1.,0.,0.,0.,cos(hp),sin(hp),0.,-sin(hp),cos(hp));
      objectNormal=squirrelHead*objectNormal;`);
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed=squirrelHead*(transformed-vec3(0.,.02,.13))+vec3(0.,.02,.13);vFurUv=uv;`);
    shader.fragmentShader=`uniform sampler2D uSquirrelFur;uniform float uSquirrelFurEnabled;varying vec2 vFurUv;\n${shader.fragmentShader}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float furHeight=.5;
      if(uSquirrelFurEnabled>.5){
        vec3 fur=texture2D(uSquirrelFur,vFurUv).rgb;furHeight=dot(fur,vec3(.2126,.7152,.0722));
        // 贴图经 sRGB 解码后的主体亮度约为 .13，围绕它展开毛根与毛尖的对比。
        diffuseColor.rgb*=clamp(.95+(furHeight-.13)*3.2,.48,1.55);
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 fx=dFdx(-vViewPosition),fy=dFdy(-vViewPosition),frx=cross(fy,normal),fry=cross(normal,fx);
      float fd=dot(fx,frx)*faceDirection;
      // 小动物的屏幕微分很小，不能用大于实际面积的下限抹掉毛丝起伏。
      normal=normalize(max(abs(fd),1e-10)*normal-sign(fd)*(dFdx(furHeight)*frx+dFdy(furHeight)*fry)*.0018*uSquirrelFurEnabled);`);
  };
  material.customProgramCacheKey=()=> 'squirrel-fur-look-v2';
}
