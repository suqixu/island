import { DEFAULTS } from './runtime-config.js';
import * as THREE from 'three';
import {getAnimationRate} from './animation-time.js';
import {clearCloudCoverForPreview} from './cloud-cover.js';
import {filmRandom,getFilmView} from './meteor-film-sampling.js';

const schedule=DEFAULTS.sky.schedules.aurora;
const clamp=THREE.MathUtils.clamp,smooth=THREE.MathUtils.smoothstep;
const vertexShader=/* glsl */`
  uniform float uTime;
  uniform float uBearing;
  uniform float uSeed;
  uniform float uShape;
  uniform float uFold;
  varying vec2 vUv;
  varying float vLane;
  varying float vAltitude;
  void main(){
    vUv=uv;vLane=position.z;
    float lane=position.z,x=uv.x,y=uv.y,t=uTime*.055;
    float fold=(sin(x*(9.0+uFold*4.0)+t+lane*1.8+uSeed)*.045
      +sin(x*(20.0+uFold*5.0)-t*.7+lane)*.018)*uFold;
    float azimuth=uBearing+(x-.5)*2.35+fold*(.6+y*.7)+lane*.12;
    float bottom=.075+lane*.048+sin(x*7.5+t*.6+lane)*.028;
    float altitude=bottom+y*(.49+lane*.035)+fold*(.35+y*.5);
    if(uShape>.5 && uShape<1.5){
      // A long, low arch with a thin luminous lower rim and a soft upper veil.
      altitude=.11+cos((x-.5)*2.9)*(.25+lane*.035)+y*.18+fold*.45;
      azimuth=uBearing+(x-.5)*2.85+lane*.065+fold*.7;
    }else if(uShape>1.5 && uShape<2.5){
      // Sparse vertical shafts remain straight while their bases drift slowly.
      altitude=bottom+y*(.87+lane*.035)+fold*.22;
      azimuth=uBearing+(x-.5)*2.45+lane*.075+fold*.22;
    }else if(uShape>2.5){
      // Full-azimuth crown converges overhead; long rays also drape into low sky.
      // An integer winding keeps both azimuth seam edges coincident.
      float crownFold=sin(x*31.4159265+t+lane*1.8+uSeed)*.025*uFold;
      azimuth=uBearing+(x-.5)*6.2831853+crownFold*(1.0-y);
      altitude=.085+lane*.035+y*(1.45-lane*.035)+crownFold*(1.0-y);
    }
    vAltitude=altitude;
    vec3 point=vec3(cos(azimuth)*cos(altitude),sin(altitude),sin(azimuth)*cos(altitude))*2160.0;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.0);
  }
`;
const fragmentShader=/* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSeed;
  uniform float uDetail;
  uniform float uShape;
  uniform float uPalette;
  uniform float uFold;
  uniform float uRayDensity;
  varying vec2 vUv;
  varying float vLane;
  varying float vAltitude;
  void main(){
    float x=vUv.x,y=vUv.y,t=uTime*.055,lane=vLane;
    float fold=sin(x*(10.0+uFold*3.0)+t+lane*1.8+uSeed)*uFold;
    float rays=.55+.25*sin(x*uRayDensity+fold*3.5-t*.8+lane*8.0)
      +uDetail*.12*sin(x*uRayDensity*2.1+fold*7.0+t*.4);
    float billow=.66+.34*sin(x*17.0+sin(x*5.0-t*.35)*2.0+t*.6+lane);
    float bottom=smoothstep(0.0,.085,y);
    float curtain=exp(-y*3.9)*bottom*(1.0-smoothstep(.58,1.0,y));
    float upper=exp(-pow((y-.40)/.19,2.0))*.16;
    float density=(curtain+upper)*max(rays,.1)*billow;
    float edge=smoothstep(0.0,.13,x)*(1.0-smoothstep(.82,1.0,x));
    if(uShape>.5 && uShape<1.5){
      float rim=exp(-pow((y-.18)/.14,2.0));
      density=(rim*.85+exp(-y*3.0)*bottom*.28)*(.62+rays*.38)*billow;
    }else if(uShape>1.5 && uShape<2.5){
      float cells=9.0+floor(uRayDensity*.035);
      float cell=floor(x*cells+lane*.27);
      float across=fract(x*cells+lane*.27)-.5;
      float shaft=exp(-across*across*(45.0+uFold*25.0));
      float top=.28+.68*(.5+.5*sin(cell*2.399+uSeed+lane));
      density=shaft*bottom*(1.0-smoothstep(top-.16,top,y))*(.50+.50*billow)
        +curtain*.07;
    }else if(uShape>2.5){
      float spokeCount=24.0+floor(uRayDensity*.08);
      float spokes=pow(.5+.5*sin(x*6.2831853*spokeCount+uSeed+lane*.8),5.0);
      float veil=(.22+.78*smoothstep(.0,.75,y))*bottom*(1.0-smoothstep(.89,1.0,y));
      density=(spokes*.78+.07)*veil*(.75+.25*sin(y*13.0-t*.4+lane));
      edge=1.0;
    }
    float horizon=smoothstep(.025,.10,vAltitude);
    vec3 green=mix(vec3(.11,1.0,.45),vec3(.12,.91,.64),uPalette);
    vec3 cyan=mix(vec3(.13,.73,.89),vec3(.21,.84,.96),uPalette);
    vec3 color=mix(green,cyan,smoothstep(.12,.65,y)*(.48+uPalette*.35)+lane*.08);
    color=mix(color,vec3(.57,.21,.80),smoothstep(.3,.72,y)*(.20+uPalette*.22));
    float alpha=density*edge*horizon*uOpacity*(1.0-lane*.18);
    gl_FragColor=vec4(color,alpha);
  }
`;

/** Three fixed ribbons in one draw call, without textures or per-frame buffers.
 * Mount in the camera-following night-sky root. Each event keeps its world bearing.
 * Only winter clear-night time counts toward the natural event schedule.
 */
export function createAurora({random=Math.random}={}){
  let filmControl,filmContext={},filmView,savedUniforms,runtimeOptions={},savedRuntime;
  const group=new THREE.Group();group.name='aurora';group.visible=false;
  const positions=[],uvs=[],indices=[],columns=48,rows=4;
  for(let lane=0;lane<3;lane++){
    const base=positions.length/3;
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      positions.push(x/columns,y/rows,lane);uvs.push(x/columns,y/rows);
    }
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const a=base+y*(columns+1)+x,b=a+columns+1;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
  const uniforms={uTime:{value:0},uOpacity:{value:0},uBearing:{value:0},uSeed:{value:0},uDetail:{value:1},
    uShape:{value:0},uPalette:{value:0},uFold:{value:1},uRayDensity:{value:145}};
  const material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,
    side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const curtain=new THREE.Mesh(geometry,material);curtain.name='aurora-curtains';curtain.frustumCulled=false;curtain.renderOrder=-900;group.add(curtain);
  const heading=new THREE.Vector3();
  const sample=()=>clamp(random(),0,1);
  let disposed=false,mode=DEFAULTS.sky.aurora,lastTime,clock=0,startsAt=schedule.initialWait.min+sample()*schedule.initialWait.range,active=false,age=0,duration=0;

  function setMode(value){
    if(disposed)return;
    const next=DEFAULTS.sky.modes.includes(value)?value:DEFAULTS.sky.aurora;if(next===mode)return;
    mode=next;active=false;age=0;group.visible=false;uniforms.uOpacity.value=0;
    if(mode==='default')startsAt=clock+schedule.initialWait.min+sample()*schedule.initialWait.range;
  }
  function update(time,env={},view){
    if(disposed||!view)return;
    const now=Number.isFinite(time)?time:(lastTime??0);
    const dt=lastTime===undefined?0:clamp((now-lastTime)/getAnimationRate(env),0,.25);
    lastTime=Math.max(now,lastTime??now);
    const winter=env.season?env.season==='winter':env.seasonIndex===3;
    const clear=(env.weather??'sunny')==='sunny';
    const night=1-smooth(clamp(env.daylight??1,0,1),.015,.22);
    const cover=clamp(Math.max(env.cloudiness??.12,env.skyCloudCover??0),0,1);
    const visibility=winter&&clear?night*(1-smooth(cover,.22,.86))*(1-clamp(env.fog??0,0,1)):0;
    if(filmControl!==undefined){
      if(!filmControl){group.visible=false;uniforms.uOpacity.value=0;return;}
      const p={...runtimeOptions,...filmControl.parameters},r=filmRandom(filmContext.seed??0,filmControl.id),v=filmView??view;
      v.getWorldDirection(heading);uniforms.uBearing.value=Math.atan2(heading.z,heading.x)+(r()-.5)*.24;
      uniforms.uSeed.value=r()*Math.PI*2;uniforms.uShape.value=Math.max(0,['curtain','arc','pillars','crown'].indexOf(p.shape??'curtain'));uniforms.uPalette.value=r();uniforms.uFold.value=.65+r()*.8;uniforms.uRayDensity.value=105+r()*95;
      uniforms.uTime.value=filmControl.localTime;uniforms.uOpacity.value=visibility*.72*(p.brightness??1);group.visible=uniforms.uOpacity.value>.001;return;
    }
    if(mode==='off'||visibility<.005){group.visible=false;uniforms.uOpacity.value=0;return;}
    if(!active&&(mode==='instant'||clock>=startsAt)){
      active=true;age=mode==='instant'?8:0;duration=schedule.duration.min+sample()*schedule.duration.range;
      view.getWorldDirection(heading);uniforms.uBearing.value=Math.atan2(heading.z,heading.x)+(sample()-.5)*.24;
      uniforms.uSeed.value=sample()*Math.PI*2;
      uniforms.uShape.value=Math.min(3,Math.floor(sample()*4));
      uniforms.uPalette.value=sample();uniforms.uFold.value=.65+sample()*.8;
      uniforms.uRayDensity.value=105+sample()*95;
    }
    if(visibility>.15){clock+=dt;if(active)age+=dt;}
    if(active)uniforms.uTime.value+=dt;
    const envelope=mode==='instant'?1:smooth(age,0,8)*(1-smooth(age,duration-12,duration));
    uniforms.uOpacity.value=active?visibility*envelope*.72:0;
    group.visible=uniforms.uOpacity.value>.001;
    if(active&&mode==='default'&&age>=duration){active=false;group.visible=false;uniforms.uOpacity.value=0;startsAt=clock+schedule.repeatWait.min+sample()*schedule.repeatWait.range;}
  }
  function setQuality(value){uniforms.uDetail.value=value==='low'?0:1;}
  function dispose(){if(disposed)return;disposed=true;group.visible=false;geometry.dispose();material.dispose();group.removeFromParent();group.clear();}
  return{group,update,setMode,setQuality,dispose,getRuntimeOptions:()=>({...runtimeOptions,mode}),setRuntimeOptions(patch){if(patch.shape!==undefined&&!['curtain','arc','pillars','crown'].includes(patch.shape))throw new Error('未知极光形态');if(patch.brightness!==undefined&&(!Number.isFinite(patch.brightness)||patch.brightness<0||patch.brightness>4))throw new Error('极光强度越界');runtimeOptions={...runtimeOptions,...patch};},
    beginFilm(){if(filmControl!==undefined)return;savedUniforms=Object.fromEntries(Object.entries(uniforms).map(([k,u])=>[k,u.value]));savedRuntime={...runtimeOptions};filmControl=null;},
    sampleFilm(frame,context={}){if(frame&&(!filmControl||frame.id!==filmControl.id))filmView=getFilmView(frame,context,context.frameAt(frame.start));filmControl=frame;filmContext=context;},
    endFilm(){if(filmControl===undefined)return;for(const [key,value]of Object.entries(savedUniforms))uniforms[key].value=value;runtimeOptions=savedRuntime;filmControl=undefined;filmView=undefined;lastTime=undefined;group.visible=false;},
  };
}

/** Prepare the existing simulation state for a visible instant preview. */
export function prepareAuroraPreview(state,cloudCover){
  state.seasonIndex=3;state.seasonProgress=0;
  state.weather='sunny';state.weatherProgress=0;state.weatherDuration=undefined;state.weatherSeasonIndex=3;
  state.hour=22;state.moonNightEnding=null;state.holdSunClock=false;state.holdMoonClock=false;
  if(cloudCover)clearCloudCoverForPreview(cloudCover,state.elapsed);
}
