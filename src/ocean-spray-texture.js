import * as THREE from 'three';

const atlasUrl = new URL('./assets/textures/water/ocean-impact-atlas-v1.webp', import.meta.url).href;

/** 共享透明图集只在首次台风时下载，未触发时不占用海面启动的等待预算。 */
export function createSprayAtlas({loadImage=url=>typeof document==='undefined'
  ? null : new THREE.ImageLoader().loadAsync(url)}={}) {
  const texture=new THREE.Texture();
  texture.name='拍岸浪花 · imagegen 透明图集';
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  const uniforms={map:{value:texture},ready:{value:0}};
  const idleReady=Promise.resolve(false);
  let disposed=false,pending;
  function load(){
    if(disposed)return idleReady;
    if(pending)return pending;
    pending=Promise.resolve().then(()=>disposed?null:loadImage(atlasUrl)).then(image=>{
      if(!image)return false;
      if(disposed){image.close?.();return false;}
      texture.image=image;texture.needsUpdate=true;uniforms.ready.value=1;
      return true;
    }).catch(()=>false);
    return pending;
  }
  function dispose(){
    if(disposed)return;
    disposed=true;uniforms.ready.value=0;texture.dispose();
    texture.image?.close?.();texture.image=null;
  }
  return {uniforms,load,get ready(){return disposed?idleReady:pending??idleReady;},dispose};
}
