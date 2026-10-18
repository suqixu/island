import { DEFAULTS } from './runtime-config.js';
import {getSeaHorizonState} from './sea-horizon.js';
import {ECLIPSE_CORONA_GLSL} from './eclipse-corona.js';

const schedule=DEFAULTS.sky.schedules.lunarEclipse;
const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const DURATION=schedule.duration,UMBRA_RADIUS=2.15;

// Area of the Moon's unit disc inside the larger, curved umbral shadow.
function shadowCoverage(distance,radius){
  if(distance<=radius-1)return 1;
  if(distance>=radius+1)return 0;
  const a=Math.acos(clamp((distance*distance+1-radius*radius)/(2*distance),-1,1));
  const b=Math.acos(clamp((distance*distance+radius*radius-1)/(2*distance*radius),-1,1));
  const lens=Math.sqrt(Math.max(0,(-distance+1+radius)*(distance+1-radius)*(distance-1+radius)*(distance+1+radius)))*.5;
  return clamp((a+radius*radius*b-lens)/Math.PI);
}

/** A complete transit of Earth's shadow; totality retains faint red light. */
export function getLunarEclipseState(progress){
  if(!Number.isFinite(progress))return {active:false,progress:0,shadowCenter:[-3.7,-.894],coverage:0,totality:0,lightFactor:1};
  const phase=clamp(progress),x=(phase-.5)*7.4;
  const shadowCenter=[x,-.45+x*.12];
  const coverage=shadowCoverage(Math.hypot(...shadowCenter),UMBRA_RADIUS);
  return {active:true,progress:phase,shadowCenter,coverage,
    totality:smooth((coverage-.96)/.04),lightFactor:1-.94*coverage};
}

/** All consumers see the same dimming, without changing the base simulation. */
export function getLunarEclipseEnvironment(env,eclipse=getLunarEclipseState()){
  const coverage=eclipse.active?clamp(eclipse.coverage):0;
  const distance=eclipse.active?Math.hypot(...eclipse.shadowCenter):4;
  const night=1-smooth(((env.daylight??1)-.01)/.15);
  // Hold the newly covered disc dark long enough for its red limb to appear,
  // then reveal the scarlet surface over the inner transit.
  const blood=smooth((coverage-.985)/.015)*smooth((.96-distance)/.47)*night;
  const skyTint=smooth((blood-.05)/.80)*night;
  // No outline during partial eclipse. On ingress, a brief bright red limb
  // precedes the red surface; totality keeps only a faint red limb afterward.
  const rim=coverage>=1?smooth((1.15-distance)/.16)*night:0;
  const ringFlash=eclipse.progress<.5?1.15*(1-blood):0;
  return {...env,lunarEclipse:eclipse,
    moonLight:(env.moonLight??0)*(eclipse.active?eclipse.lightFactor:1),
    moonLightTint:[1,1-blood*.75,1-blood*.9],
    lunarBloodStrength:blood,lunarSkyTintStrength:skyTint,lunarWorldTintStrength:skyTint,
    lunarDiscExposure:1.55+.25*blood,lunarRimStrength:rim*(.20+ringFlash*.60),
    lunarCoronaStrength:rim*ringFlash,
    lunarGlowLight:(env.moonLight??0)*rim*(.6+.2*blood),
    lunarHaloFactor:1-.6*smooth(coverage)};
}

/** Shared dark crimson horizon for sky and distant water, never a screen overlay. */
export function getLunarEclipseSeaHorizon(env,state=getSeaHorizonState(env)){
  const amount=clamp(env.lunarSkyTintStrength??0)*(1-smooth(((env.daylight??1)-.01)/.15));
  if(amount===0)return state;
  const target=[.033,.0040,.0062];
  return{...state,color:state.color.map((value,index)=>value+(target[index]-value)*amount)};
}

export function createLunarEclipse({random=Math.random}={}){
  let mode=DEFAULTS.sky.lunarEclipse,observed=0,nextAt=DEFAULTS.sky.lunarEclipse==='instant'?0:schedule.initialWait.min+random()*schedule.initialWait.range,age=-1,completedNight=-Infinity;
  function reset(){age=-1;completedNight=-Infinity;nextAt=observed+(mode==='instant'?0:schedule.initialWait.min+random()*schedule.initialWait.range);}
  function setMode(value){
    const next=DEFAULTS.sky.modes.includes(value)?value:DEFAULTS.sky.lunarEclipse;
    if(next===mode)return;
    mode=next;reset();
  }
  function update(delta,env={}){
    const dt=Number.isFinite(delta)?clamp(delta,0,1):0;
    const night=(env.daylight??1)<.08&&(env.moonAltitude??-1)>.08
      &&(env.moonIllumination??0)>=.995;
    const clear=night&&Math.max(env.cloudiness??0,env.skyCloudCover??0)<.6
      &&(env.fog??0)<.25&&(env.rain??0)<.2&&(env.storm??0)<.1;
    const nightId=(env.dayIndex??0)-((env.hour??22)<12?1:0);
    if(mode==='off')return getLunarEclipseState();
    if(clear)observed+=dt;
    if(!night){
      if(age>=0){age=-1;nextAt=observed+(mode==='instant'?0:schedule.repeatWait.min+random()*schedule.repeatWait.range);}
      return getLunarEclipseState();
    }
    if(age>=0){
      age+=dt;
      if(age>=DURATION){completedNight=nightId;age=-1;nextAt=observed+(mode==='instant'?0:schedule.repeatWait.min+random()*schedule.repeatWait.range);return getLunarEclipseState();}
    }else if(completedNight!==nightId&&(mode==='instant'?night:clear)&&observed>=nextAt)age=0;
    return getLunarEclipseState(age>=0?age/DURATION:undefined);
  }
  return {update,setMode,reset};
}

// Keep the illuminated disc golden, then reveal a luminous scarlet full
// Moon. Its local rim/glow is independent of the dimmed light on the island.
export const LUNAR_ECLIPSE_GLSL=/* glsl */`
  uniform float uLunarEclipseActive;
  uniform float uLunarTotality;
  uniform float uLunarBloodStrength;
  uniform float uLunarRimStrength;
  uniform float uLunarCoronaStrength;
  uniform vec2 uEarthShadow;
  ${ECLIPSE_CORONA_GLSL}
  vec3 lunarEclipseRimColor(){return vec3(1.0,.018,.004);}
  vec3 lunarEclipseColor(vec3 normalColor,vec3 albedo,float brightness,vec2 disc,float exposure){
    float distanceToShadow=length(disc-uEarthShadow);
    float umbra=1.0-smoothstep(2.04,2.26,distanceToShadow);
    float penumbra=1.0-smoothstep(2.26,2.82,distanceToShadow);
    float depth=clamp(distanceToShadow/2.15,0.0,1.0);
    vec3 nearBlack=normalColor*.012;
    // Remap the existing lunar albedo: dark maria stay deep crimson, while
    // highlands and crater rays glow scarlet. No painted detail or extra texture.
    float luminance=dot(albedo,vec3(.2126,.7152,.0722));
    float relief=pow(clamp((luminance-.20)/.58,0.0,1.0),1.65);
    vec3 scarlet=vec3(.025+relief*1.60,.0008+pow(relief,3.0)*.055,.0004+pow(relief,4.0)*.008);
    vec3 redSurface=scarlet*brightness*exposure*mix(.88,1.06,pow(depth,1.7));
    // Gentle rolloff preserves luminous crater detail instead of clipping to flat red.
    vec3 blood=redSurface/(vec3(1.0)+redSurface*.22);
    vec3 shadow=mix(nearBlack,blood,uLunarBloodStrength);
    vec3 lit=normalColor*(1.0-penumbra*.16*uLunarEclipseActive);
    vec3 color=mix(lit,shadow,umbra*uLunarEclipseActive);
    float rimOffset=(length(disc)-1.0)/.014;
    float rim=exp(-rimOffset*rimOffset)*uLunarRimStrength;
    return color+lunarEclipseRimColor()*rim*.85;
  }
`;
