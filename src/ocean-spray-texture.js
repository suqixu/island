import * as THREE from 'three';

const atlasUrl = new URL('./assets/textures/water/ocean-impact-atlas-v1.webp', import.meta.url).href;

/** One shared RGBA atlas; preserve generated transparency and soft droplets. */
export function createSprayAtlas() {
  const texture=new THREE.Texture();
  texture.name='拍岸浪花 · imagegen 透明图集';
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  const uniforms={map:{value:texture},ready:{value:0}};
  let disposed=false;
  const ready=typeof document==='undefined' ? Promise.resolve(false)
    : new THREE.ImageLoader().loadAsync(atlasUrl).then(image=>{
      if(disposed)return false;
      texture.image=image;texture.needsUpdate=true;uniforms.ready.value=1;
      return true;
    }).catch(()=>false);
  function dispose(){if(disposed)return;disposed=true;uniforms.ready.value=0;texture.dispose();}
  return {uniforms,ready,dispose};
}
