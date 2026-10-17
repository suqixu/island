import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createBloomPass } from '../src/bloom.js';

const size = 64;
const renderer = new THREE.WebGLRenderer();
renderer.setSize(size, size);
document.body.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1,1,1,-1,0,2);
camera.position.z = 1;
const data = new Float32Array(size * size * 4);
for(let i=0;i<data.length;i+=4) data.set([.25,.35,.5,1],i);
// One invalid light sample must not contaminate the mip pyramid.
data.set([NaN, NaN, NaN, 1], (size * 32 + 32) * 4);
data.set([Infinity, Infinity, Infinity, 1], (size * 32 + 34) * 4);
const texture = new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.FloatType);
texture.needsUpdate = true;
const material = new THREE.ShaderMaterial({uniforms:{image:{value:texture}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
  fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}',
  depthTest:false,depthWrite:false});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
const composer = new EffectComposer(renderer);
composer.renderToScreen = false;
composer.addPass(new RenderPass(scene,camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(size,size),.16,.4,1.1);
composer.addPass(bloom);
function invalidPixels(target){
  const pixels = new Uint16Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
  let count=0;
  for(let i=0;i<pixels.length;i+=4) if([0,1,2].some(c=>!Number.isFinite(THREE.DataUtils.fromHalfFloat(pixels[i+c]))))count++;
  return count;
}
bloom.enabled=false; composer.render(); const inputInvalid=invalidPixels(composer.readBuffer);
bloom.enabled=true; composer.render(); const originalInvalid=invalidPixels(composer.readBuffer);
composer.removePass(bloom);
const guardedBloom = createBloomPass(size,size);
composer.addPass(guardedBloom);
composer.render(); const guardedInvalid=invalidPixels(composer.readBuffer);
const cleanBloomInvalid=guardedBloom.renderTargetsVertical.reduce((sum,target)=>sum+invalidPixels(target),0);
// The normal HDR highlight must retain the exact original bloom result.
data.fill(0);
for(let i=0;i<data.length;i+=4)data.set([.25,.35,.5,1],i);
for(let y=30;y<35;y++)for(let x=30;x<35;x++)data.set([8,4,2,1],(y*size+x)*4);
texture.needsUpdate=true;
function pixelsOf(){
  const target=composer.readBuffer,pixels=new Uint16Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
  return pixels;
}
composer.render(); const guardedClean=pixelsOf();
composer.removePass(guardedBloom);composer.addPass(bloom);composer.render();const originalClean=pixelsOf();
const cleanDifference=guardedClean.reduce((sum,value,i)=>sum+(value!==originalClean[i]?1:0),0);
const result={inputInvalid,originalInvalid,guardedInvalid,cleanBloomInvalid,cleanDifference,
  pass:originalInvalid>inputInvalid && guardedInvalid<=inputInvalid && cleanBloomInvalid===0 && cleanDifference===0};
document.querySelector('#results').textContent=JSON.stringify(result,null,2);
