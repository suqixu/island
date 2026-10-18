import { DEFAULTS, RENDERING_CONFIG } from './runtime-config.js';
import * as THREE from 'three';
import meteorConfig from './config/scene-capabilities.json' with {type:'json'};
import {validateCapabilityValue} from './scene-capabilities/registry.js';
import {sampleMeteorEpisode,getFilmView} from './meteor-film-sampling.js';

const schedule=DEFAULTS.sky.schedules.meteor;
const clamp=THREE.MathUtils.clamp,smooth=THREE.MathUtils.smoothstep,RADIUS=2110,POOL_SIZE=32;
const limits=RENDERING_CONFIG.meteorLimits;
function randomSource(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
const trailVertex=/* glsl */`
  attribute float aOpacity;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vColor;
  void main(){vUv=uv;vOpacity=aOpacity;vColor=aColor;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const trailFragment=/* glsl */`
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vColor;
  void main(){
    float x=clamp(vUv.x,0.0,1.0),y=(vUv.y-.5)*2.0;
    float core=exp(-y*y*30.0),halo=exp(-y*y*3.5);
    float tail=pow(1.0-x,1.2);
    float edge=1.0-smoothstep(.7,1.0,abs(y));
    gl_FragColor=vec4(vColor,(core*1.25+halo*.12)*tail*edge*vOpacity*uOpacity);
  }
`;
const headVertex=/* glsl */`
  attribute float aOpacity;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying float vOpacity;
  varying vec3 vColor;
  void main(){vOpacity=aOpacity;vColor=aColor;gl_PointSize=aSize*uPixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const headFragment=/* glsl */`
  uniform float uOpacity;
  varying float vOpacity;
  varying vec3 vColor;
  void main(){
    float r=length(gl_PointCoord-.5)*2.0;
    float core=exp(-r*r*110.0),glow=exp(-r*r*8.0)*.12;
    gl_FragColor=vec4(vColor,(core+glow)*(1.0-smoothstep(.65,1.0,r))*vOpacity*uOpacity);
  }
`;
function attribute(length,size){return new THREE.BufferAttribute(new Float32Array(length*size),size).setUsage(THREE.DynamicDrawUsage);}
function geometry(count,quad=false){
  const value=new THREE.BufferGeometry(),vertices=quad?count*4:count;
  value.setAttribute('position',attribute(vertices,3));value.setAttribute('aOpacity',attribute(vertices,1));value.setAttribute('aColor',attribute(vertices,3));
  if(quad){
    const uv=[],indices=[];
    for(let i=0;i<count;i++){const at=i*4;uv.push(0,0,0,1,1,0,1,1);indices.push(at,at+2,at+1,at+2,at+3,at+1);}
    value.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));value.setIndex(indices);
  }else value.setAttribute('aSize',attribute(vertices,1));
  value.setDrawRange(0,0);return value;
}
function material(vertexShader,fragmentShader,uniforms){return new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false});}

/** A fixed pool and two draw calls for the entire meteor shower, including
 * lingering trails. Directions are fixed in world space for each episode.
 * dt is unaccelerated elapsed time, supplied by the owning night sky.
 */
export function createMeteorShower({groupRandom=Math.random,timeRandom=Math.random}={}){
  let runtimeOptions={},filmControl,filmContext,filmView;
  const random=randomSource(570317),group=new THREE.Group();group.name='meteor-shower';
  const opacity={value:0},pixelRatio={value:1};
  const trails=new THREE.Mesh(geometry(POOL_SIZE,true),material(trailVertex,trailFragment,{uOpacity:opacity}));
  const heads=new THREE.Points(geometry(POOL_SIZE),material(headVertex,headFragment,{uOpacity:opacity,uPixelRatio:pixelRatio}));
  trails.name='meteor';heads.name='meteor-head';trails.renderOrder=-860;heads.renderOrder=-850;
  trails.frustumCulled=heads.frustumCulled=false;group.add(trails,heads);
  const pool=Array.from({length:POOL_SIZE},()=>({active:false,born:0,flight:1,linger:1,width:6,size:16,brightness:1,trailFraction:.3,start:new THREE.Vector3(),away:new THREE.Vector3(),color:new THREE.Color()}));
  const skyAnchor=new THREE.Vector3(),east=new THREE.Vector3(),up=new THREE.Vector3(),end=new THREE.Vector3();
  const head=new THREE.Vector3(),tail=new THREE.Vector3(),side=new THREE.Vector3(),liveColor=new THREE.Color();
  let halfHeight=1,aspect=1,elapsed=0,observed=0,nextAt=DEFAULTS.sky.meteor==='instant'?0:schedule.initialWait.min+timeRandom()*schedule.initialWait.range,started=-Infinity,nextBurstAt=Infinity,nextMeteorAt=Infinity,burstRemaining=0,burstSize=0,burstIndex=0,burstBearing=0,quality=RENDERING_CONFIG.defaultQuality,disposed=false,mode=DEFAULTS.sky.meteor;

  function clear(){
    pool.forEach(slot=>{slot.active=false;});started=-Infinity;burstRemaining=0;
    trails.geometry.setDrawRange(0,0);heads.geometry.setDrawRange(0,0);trails.visible=heads.visible=false;
  }
  function setMode(value){
    const next=DEFAULTS.sky.modes.includes(value)?value:DEFAULTS.sky.meteor;
    if(next===mode)return;mode=next;clear();group.visible=false;
    nextAt=observed+(mode==='instant'?0:schedule.initialWait.min+timeRandom()*schedule.initialWait.range);
  }
  function setEnabled(value){setMode(value?'default':'off');}

  function begin(view){
    // Capture the view once per episode; existing paths stay fixed when turning.
    view.getWorldDirection(skyAnchor);
    east.setFromMatrixColumn(view.matrixWorld,0);up.setFromMatrixColumn(view.matrixWorld,1);
    halfHeight=Math.tan(THREE.MathUtils.degToRad(view.getEffectiveFOV())*.5);aspect=view.aspect;
    started=elapsed;nextAt=observed+(mode==='instant'?schedule.instantRepeat:schedule.repeatWait.min+timeRandom()*schedule.repeatWait.range);nextBurstAt=elapsed+(mode==='instant'?0:.65);burstRemaining=0;
  }
  function spawn(){
    let slot;
    for(let i=0;i<(runtimeOptions.maxActive??limits[quality].capacity);i++)if(!pool[i].active){slot=pool[i];break;}
    if(!slot)return;
    const x=(random()-.5)*.7,y=(random()-.5)*.3;
    const dx=Math.cos(burstBearing)/aspect,dy=Math.sin(burstBearing),edge=1.2;
    // Extend a line through the central view past both screen edges. Resolve
    // those rays into a world-space great circle, independent of horizon height.
    const before=Math.min((edge-y)/-dy,Math.abs(dx)>1e-6?(edge+Math.sign(dx)*x)/Math.abs(dx):Infinity);
    const after=Math.min((-edge-y)/dy,Math.abs(dx)>1e-6?(edge-Math.sign(dx)*x)/Math.abs(dx):Infinity);
    slot.start.copy(skyAnchor).addScaledVector(east,(x-dx*before)*halfHeight*aspect).addScaledVector(up,(y-dy*before)*halfHeight).normalize();
    end.copy(skyAnchor).addScaledVector(east,(x+dx*after)*halfHeight*aspect).addScaledVector(up,(y+dy*after)*halfHeight).normalize();
    slot.travel=slot.start.angleTo(end);
    slot.away.copy(end).addScaledVector(slot.start,-slot.start.dot(end)).normalize();
    // A visual mass proxy ties scale, brightness and speed to one individual.
    // Larger meteors move a little more slowly, within a short, crisp pass.
    const mass=random();
    slot.active=true;slot.born=elapsed;slot.flight=runtimeOptions.flightDuration??(.85+mass*.45);
    slot.linger=runtimeOptions.lingerDuration??(.18+mass*.22);
    slot.trailFraction=.55+random()*.18;
    slot.width=3.8+mass*2.6;slot.size=6+mass*6;
    slot.brightness=(1.15+mass*.65)*(runtimeOptions.brightness??1);
    slot.color.setRGB(1,.96+random()*.03,.84+random()*.10);
  }
  function point(slot,progress,target){
    const angle=slot.travel*progress;
    return target.copy(slot.start).multiplyScalar(Math.cos(angle)).addScaledVector(slot.away,Math.sin(angle)).multiplyScalar(RADIUS);
  }
  function writeQuad(index,slot,alpha){
    side.crossVectors(head,tail).normalize();
    const a=trails.geometry.attributes,offset=index*4;
    for(let i=0;i<4;i++){
      const value=i<2?head:tail,width=slot.width*(i<2?1:.25),sign=i%2?1:-1;
      a.position.setXYZ(offset+i,value.x+side.x*width*sign,value.y+side.y*width*sign,value.z+side.z*width*sign);
      a.aOpacity.setX(offset+i,alpha);a.aColor.setXYZ(offset+i,liveColor.r,liveColor.g,liveColor.b);
    }
  }
  function update(delta,visibility,view,{moonLight=0,pixelRatio:ratio=1}={}){
    if(disposed||!view||filmControl===undefined&&mode==='off')return;
    if(filmControl!==undefined){renderFilm(visibility,view,moonLight,ratio);return;}
    const dt=Number.isFinite(delta)?clamp(delta,0,.25):0;elapsed+=dt;
    opacity.value=clamp(visibility,0,1)*(1-clamp(moonLight,0,1)*.22);pixelRatio.value=ratio;
    group.visible=visibility>.005;
    if(visibility<=.02){
      clear();nextAt=mode==='instant'?observed:Math.max(nextAt,observed+3);return;
    }
    if(visibility>.2)observed+=dt;
    if(observed>=nextAt&&visibility>.2)begin(view);
    const age=elapsed-started;
    if(age<30&&visibility>.2){
      if(elapsed>=nextBurstAt&&age<29){
        burstSize=runtimeOptions.burstCount??(1+clamp(Math.floor(groupRandom()*9),0,8));burstRemaining=burstSize;
        burstBearing=runtimeOptions.bearing===undefined?-(.55+groupRandom()*(Math.PI-1.10)):THREE.MathUtils.degToRad(runtimeOptions.bearing);
        group.userData.burstIndex=++burstIndex;group.userData.burstCount=burstSize;group.userData.burstDirection=burstBearing;
        nextMeteorAt=elapsed;nextBurstAt=elapsed+(runtimeOptions.burstInterval??(2.8+timeRandom()*5.2));
      }
      while(burstRemaining>0&&elapsed>=nextMeteorAt){
        spawn();burstRemaining--;nextMeteorAt+=(.14+random()*.10)*Math.min(1,3/burstSize);
      }
    }
    let trailCount=0,headCount=0;
    for(const slot of pool){
      if(!slot.active)continue;
      const age=elapsed-slot.born;
      if(age>=slot.flight+slot.linger){slot.active=false;continue;}
      const t=clamp(age/slot.flight,0,1),after=Math.max(0,age-slot.flight);
      const fade=(1-smooth(after,0,slot.linger))*smooth(t,0,.06);
      liveColor.copy(slot.color);
      point(slot,t,head);point(slot,Math.max(0,t-slot.trailFraction),tail);
      const alpha=slot.brightness*fade*(after>0?.48:1);
      writeQuad(trailCount++,slot,alpha);
      if(age<slot.flight){
        const a=heads.geometry.attributes;
        a.position.setXYZ(headCount,head.x,head.y,head.z);a.aSize.setX(headCount,slot.size);
        a.aOpacity.setX(headCount,slot.brightness*smooth(t,0,.06));
        a.aColor.setXYZ(headCount,liveColor.r,liveColor.g,liveColor.b);headCount++;
      }
    }
    trails.geometry.setDrawRange(0,trailCount*6);heads.geometry.setDrawRange(0,headCount);
    trails.visible=trailCount>0;heads.visible=headCount>0;
    for(const object of [trails,heads])for(const name of ['position','aOpacity','aColor','aSize'])if(object.geometry.attributes[name])object.geometry.attributes[name].needsUpdate=true;
  }
  function setQuality(value){quality=Object.hasOwn(limits,value)?value:RENDERING_CONFIG.defaultQuality;if(filmControl===undefined)pool.forEach((slot,i)=>{if(i>=limits[quality].capacity)slot.active=false;});}
  let savedRuntimeOptions;
  function setRuntimeOptions(patch={}){for(const [key,value]of Object.entries(patch)){const schema=meteorConfig.meteor.parameters[key];if(!schema)throw new Error(`未知流星参数 ${key}`);validateCapabilityValue(schema,value,key);if(key==='mode'&&filmControl===undefined)setMode(value);else runtimeOptions[key]=value;}}
  function renderFilm(visibility,view,moonLight,ratio){
    opacity.value=clamp(visibility,0,1)*(1-clamp(moonLight,0,1)*.22);pixelRatio.value=ratio;
    const slots=filmControl?sampleMeteorEpisode({...filmControl,parameters:{...runtimeOptions,...filmControl.parameters}},{seed:filmContext.seed,view:filmView??view}):[];
    let trailCount=0,headCount=0;
    for(const slot of slots){const age=filmControl.localTime-slot.born,t=clamp(age/slot.flight,0,1),after=Math.max(0,age-slot.flight),fade=(1-smooth(after,0,slot.linger))*smooth(t,0,.06);liveColor.copy(slot.color);point(slot,t,head);point(slot,Math.max(0,t-slot.trailFraction),tail);writeQuad(trailCount++,slot,slot.brightness*fade*(after>0?.48:1));if(age<slot.flight){const a=heads.geometry.attributes;a.position.setXYZ(headCount,head.x,head.y,head.z);a.aSize.setX(headCount,slot.size);a.aOpacity.setX(headCount,slot.brightness*smooth(t,0,.06));a.aColor.setXYZ(headCount,liveColor.r,liveColor.g,liveColor.b);headCount++;}}
    trails.geometry.setDrawRange(0,trailCount*6);heads.geometry.setDrawRange(0,headCount);trails.visible=trailCount>0;heads.visible=headCount>0;group.visible=visibility>.005&&trailCount>0;group.userData.activeCount=headCount;
    for(const object of [trails,heads])for(const attribute of Object.values(object.geometry.attributes))if(attribute.usage===THREE.DynamicDrawUsage)attribute.needsUpdate=true;
  }
  function sampleFilm(frame,context={}){if(frame&&(!filmControl||frame.id!==filmControl.id)){const view=context.frameAt?.(frame.start);if(view)filmView=getFilmView(frame,context,view);}filmControl=frame;filmContext=context;}
  function dispose(){if(disposed)return;disposed=true;trails.geometry.dispose();trails.material.dispose();heads.geometry.dispose();heads.material.dispose();group.removeFromParent();group.clear();}
  return{group,update,setQuality,setEnabled,setMode,dispose,getRuntimeOptions:()=>({...runtimeOptions,mode}),setRuntimeOptions,getRuntimeCapabilities:()=>meteorConfig.meteor.parameters,beginFilm(){if(filmControl!==undefined)return;savedRuntimeOptions={...runtimeOptions};filmControl=null;filmContext={};filmView=undefined;},sampleFilm,endFilm(){if(filmControl===undefined)return;runtimeOptions=savedRuntimeOptions;filmControl=undefined;filmView=undefined;trails.visible=heads.visible=false;group.visible=false;trails.geometry.setDrawRange(0,0);heads.geometry.setDrawRange(0,0);}};
}
