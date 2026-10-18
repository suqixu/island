import * as THREE from 'three';
import {loadOptionalResource} from './resource-loading.js';

const petalUrl=new URL('./assets/textures/vegetation/flower-petal-albedo-v2.webp',import.meta.url).href;
const pollenUrl=new URL('./assets/textures/vegetation/flower-pollen-albedo-v1.webp',import.meta.url).href;
function loadTexture(url,name,{signal}={}) {
  return loadOptionalResource(async()=>{
    const map=await new THREE.TextureLoader().loadAsync(url);
    map.name=name;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;
  },{signal,dispose:map=>map?.dispose()});
}
export function loadFlowerTexture(options) {return loadTexture(petalUrl,'Imagegen flower petal',options);}
export function loadFlowerPollenTexture(options) {return loadTexture(pollenUrl,'Imagegen flower pollen',options);}
export function createFlowerTextureState(){
  const uniforms={uPetalMap:{value:null},uPetalMapEnabled:{value:0},uPollenMap:{value:null},uPollenMapEnabled:{value:0}};
  let disposed=false;
  function setTexture(key,map){
    if(disposed){map?.dispose();return;}
    const previous=uniforms[key].value;if(previous===map)return;
    uniforms[key].value=map;uniforms[`${key}Enabled`].value=map?1:0;
    if(previous&&previous!==uniforms.uPetalMap.value&&previous!==uniforms.uPollenMap.value)previous.dispose();
  }
  const setMap=map=>setTexture('uPetalMap',map),setPollenMap=map=>setTexture('uPollenMap',map);
  return {uniforms,setMap,setPollenMap,dispose(){if(disposed)return;setMap(null);setPollenMap(null);disposed=true;}};
}
export function markPetalTexture(geometry,enabled){geometry.setAttribute('aPetalTexture',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(enabled?1:0),1));return geometry;}

/** 颜色渐变沿单瓣UV展开，组织细纹和花粉共用贴图，不增加绘制批次。 */
export function attachFlowerTexture(material,uniforms,{centerColors=false}={}){
  if(!uniforms)return material;const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=`attribute float aPetalTexture;varying vec2 vPetalUv;varying float vPetalMask;${centerColors?'attribute vec3 aFlowerCenter;varying vec3 vFlowerCenter;varying float vCenterShade;':''}\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvPetalUv=uv;vPetalMask=aPetalTexture;${centerColors?'vFlowerCenter=aFlowerCenter;vCenterShade=color.r;':''}`);
    shader.fragmentShader=`uniform sampler2D uPetalMap;uniform float uPetalMapEnabled;uniform sampler2D uPollenMap;uniform float uPollenMapEnabled;varying vec2 vPetalUv;varying float vPetalMask;${centerColors?'varying vec3 vFlowerCenter;varying float vCenterShade;':''}\n${shader.fragmentShader}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float petalWeight=uPetalMapEnabled*vPetalMask;float petalHeight=1.0;
      if(vPetalMask>.5){
        // 根部浓色到中段饱和色，再到透亮瓣缘；图片未就绪也保留渐变。
        float petalLength=clamp(vPetalUv.y,0.0,1.0);
        float petalPigment=.48+.52*smoothstep(.02,.72,petalLength);
        float petalTip=.14*smoothstep(.48,1.0,petalLength);
        vec3 petalColor=mix(diffuseColor.rgb*petalPigment,vec3(1.0),petalTip);
        diffuseColor.rgb=petalColor;
      }
      if(uPetalMapEnabled>0.5){
        vec3 petalAlbedo=texture2D(uPetalMap,vPetalUv).rgb;
        petalHeight=dot(petalAlbedo,vec3(0.2126,0.7152,0.0722));
        float petalContrast=clamp(.99+(petalHeight-.82)*.60,.90,1.035);
        diffuseColor.rgb*=mix(1.0,petalContrast,petalWeight);
      }
      float pollenHeight=0.5;float pollenWeight=0.0;
      ${centerColors?`if(vPetalMask<.5){
        diffuseColor.rgb=vFlowerCenter*vCenterShade;
        pollenWeight=uPollenMapEnabled;
        if(uPollenMapEnabled>.5){
          pollenHeight=dot(texture2D(uPollenMap,vPetalUv).rgb,vec3(.2126,.7152,.0722));
          diffuseColor.rgb*=clamp(.76+pollenHeight*.48,.78,1.10);
        }
      }`:''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,0.78-petalHeight*0.14,petalWeight);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 petalDx=dFdx(-vViewPosition),petalDy=dFdy(-vViewPosition);
      vec3 petalRx=cross(petalDy,normal),petalRy=cross(normal,petalDx);
      float petalDet=dot(petalDx,petalRx)*faceDirection;
      float flowerRelief=petalHeight*0.00010*petalWeight+pollenHeight*0.00005*pollenWeight;
      vec3 petalGrad=sign(petalDet)*(dFdx(flowerRelief)*petalRx+dFdy(flowerRelief)*petalRy);
      // 仅防退化面积归零，不能用屏幕面积下限抹去小花瓣的细纹。
      normal=normalize(max(abs(petalDet),1e-10)*normal-petalGrad);`);
  };
  material.customProgramCacheKey=()=>`${key}|flower-petal-v6-${centerColors}`;return material;
}
