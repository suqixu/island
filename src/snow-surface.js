// 所有露天表面共用世界坐标雪面：斑驳堆积、风纹、细颗粒和微法线。
// ImageGen 雪面以世界坐标铺贴，平滑法线决定覆雪，避免逐三角面染色。
export function getSnowCover(environment={}) {
  const value=environment.snowCover??environment.snow??0;
  return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
}

export function isSnowLandscape(environment={}) {
  return (environment.snow??0)>.05||getSnowCover(environment)>.025||environment.weather==='blizzard';
}

export function createSnowSurfaceState() {
  const uniforms={uSnowMap:{value:null},uSnowMapEnabled:{value:0},uSnowDaylight:{value:1},uSnowSeed:{value:0}};
  const released=new WeakSet();let disposed=false;
  const release=map=>{if(map&&!released.has(map)){released.add(map);map.dispose();}};
  function setMap(map) {
    if(disposed){release(map);return;}
    const previous=uniforms.uSnowMap.value;
    uniforms.uSnowMap.value=map??null;uniforms.uSnowMapEnabled.value=map?1:0;
    if(previous!==map)release(previous);
  }
  function dispose(){if(disposed)return;setMap(null);disposed=true;}
  return {uniforms,setMap,dispose};
}

export function attachSnowSurface(material, cover, {layer=false,surface,shoreline=false,volume=false,growth=false,mask='1.0',smoothNormals=false}={}) {
  if(material.userData.snowSurface)return material;
  material.userData.snowSurface=true;
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    compile.call(this,shader,renderer);
    shader.uniforms.uSurfaceSnow=cover;
    const maps=surface?.uniforms??surface;
    shader.uniforms.uSnowMap=maps?.uSnowMap??{value:null};
    shader.uniforms.uSnowMapEnabled=maps?.uSnowMapEnabled??{value:0};
    shader.uniforms.uSnowDaylight=maps?.uSnowDaylight??{value:1};
    shader.uniforms.uSnowSeed=maps?.uSnowSeed??{value:0};
    shader.vertexShader=`uniform float uSurfaceSnow; ${growth?'attribute vec3 aSnowBase;':''} ${smoothNormals?'attribute vec3 aSnowNormal;':''} varying vec3 vSnowWorld; varying vec3 vSnowSmoothNormal;\n${shader.vertexShader}`.replace('#include <project_vertex>',`
      ${growth?'transformed=mix(aSnowBase,transformed,clamp(uSurfaceSnow,0.0,1.0));':''}
      vec4 snowWorld=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        snowWorld=instanceMatrix*snowWorld;
      #endif
      vSnowWorld=(modelMatrix*snowWorld).xyz;
      ${smoothNormals?`vec3 snowTransformedNormal=aSnowNormal;
      #ifdef USE_INSTANCING
        mat3 snowInstanceNormal=mat3(instanceMatrix);
        snowTransformedNormal/=vec3(dot(snowInstanceNormal[0],snowInstanceNormal[0]),dot(snowInstanceNormal[1],snowInstanceNormal[1]),dot(snowInstanceNormal[2],snowInstanceNormal[2]));
        snowTransformedNormal=snowInstanceNormal*snowTransformedNormal;
      #endif
      snowTransformedNormal=normalMatrix*snowTransformedNormal;
      vSnowSmoothNormal=inverseTransformDirection(snowTransformedNormal,viewMatrix);`
      :'vSnowSmoothNormal=inverseTransformDirection(transformedNormal,viewMatrix);'}
      #include <project_vertex>`);
    shader.fragmentShader=`varying vec3 vSnowWorld; varying vec3 vSnowSmoothNormal;
      uniform float uSurfaceSnow; uniform sampler2D uSnowMap; uniform float uSnowMapEnabled; uniform float uSnowDaylight; uniform float uSnowSeed;
      float snowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float snowNoise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(snowHash(i),snowHash(i+vec2(1,0)),f.x),
          mix(snowHash(i+vec2(0,1)),snowHash(i+vec2(1,1)),f.x),f.y);
      }
      ${shader.fragmentShader}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`
      float snowCoverage=0.0,snowPatch=0.0,snowGrain=.5,snowRipple=.5;
      if(uSurfaceSnow>.001) {
      vec3 snowFace=normalize(vSnowSmoothNormal);
      float snowUp=${volume?'1.0':'smoothstep(0.03,0.66,snowFace.y)'};
      vec2 snowPatchPoint=vSnowWorld.xz+vec2(uSnowSeed,uSnowSeed*.618);
      snowPatch=snowNoise(snowPatchPoint*.28+vSnowWorld.y*.06)*.6
        +snowNoise(snowPatchPoint*1.4+vSnowWorld.y*.43)*.4;
      float snowAmount=clamp(uSurfaceSnow*1.35-(1.0-snowUp)*.65,0.0,1.0);
      snowCoverage=smoothstep(snowPatch*.48,snowPatch*.48+.22,snowAmount)*snowUp
        *smoothstep(${shoreline?'.40,1.0':'.05,.5'},vSnowWorld.y)*clamp(${mask},0.0,1.0);
      snowGrain=mix(.5,snowNoise(vSnowWorld.xz*31.0),1.0-smoothstep(.02,.18,length(fwidth(vSnowWorld.xz))));
      snowRipple=sin(vSnowWorld.x*.8+vSnowWorld.z*2.1+snowPatch*2.0)*.5+.5;
      vec3 snowColor=mix(vec3(.65,.77,.88),vec3(.94,.97,1.0),.66+snowGrain*.22);
      if(uSnowMapEnabled>.5) {
        vec3 snowAlbedo=texture2D(uSnowMap,vSnowWorld.xz*.32+vSnowWorld.y*.035).rgb;
        vec3 snowDetail=texture2D(uSnowMap,mat2(.8,.6,-.6,.8)*vSnowWorld.xz*1.4).rgb;
        snowGrain=dot(snowDetail,vec3(.2126,.7152,.0722));
        snowRipple=dot(snowAlbedo,vec3(.2126,.7152,.0722));
        snowColor=mix(vec3(.98,.99,1.0),mix(snowAlbedo,snowDetail,.22),.32);
      }
      diffuseColor.rgb=mix(diffuseColor.rgb,snowColor*(.96+.04*snowRipple),snowCoverage);
      }
      ${layer?'diffuseColor.a*=snowCoverage;':''}
      roughnessFactor=mix(roughnessFactor,.96,snowCoverage);
      #include <metalnessmap_fragment>
      metalnessFactor=mix(metalnessFactor,0.0,snowCoverage);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`
      totalEmissiveRadiance+=diffuseColor.rgb*snowCoverage*uSnowDaylight*.18;
      if(uSurfaceSnow>.001) {
      normal=normalize(mix(normal,normalize((viewMatrix*vec4(normalize(vSnowSmoothNormal),0.0)).xyz),snowCoverage*.96));
      float snowRelief=(snowPatch*.01+snowRipple*.018+snowGrain*.004)*snowCoverage;
      vec3 snowRx=cross(dFdy(-vViewPosition),normal),snowRy=cross(normal,dFdx(-vViewPosition));
      float snowDet=dot(dFdx(-vViewPosition),snowRx);
      normal=normalize(max(abs(snowDet),.000001)*normal-sign(snowDet)*(dFdx(snowRelief)*snowRx+dFdy(snowRelief)*snowRy));
      }
      #include <lights_physical_fragment>`);
  };
  material.customProgramCacheKey=()=>`${key}|snow-surface-imagegen-v5-${layer}-${shoreline}-${volume}-${growth}-${mask}-${smoothNormals}`;
  return material;
}
