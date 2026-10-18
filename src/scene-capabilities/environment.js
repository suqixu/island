import {LUNAR_CYCLE_DAYS} from '../moon.js';
export function createEnvironmentCapabilityBindings({state}){
 let overrides={};
 const fields={hour:'hour',season:'seasonIndex',weather:'weather',snowCover:'snowCover',cloudMode:'cloudMode',motionRate:'filmMotionRate'};
 return {
  capture:()=>structuredClone(state),begin(){overrides={};},restore(snapshot){const elapsed=Math.max(state.elapsed??0,snapshot.elapsed??0);if(!Object.hasOwn(snapshot,'filmMotionRate'))delete state.filmMotionRate;Object.assign(state,snapshot,{elapsed});overrides={};},
  read(id){const key=id.split('.').at(-1);return key==='moonPhase'?state.lunarDay/LUNAR_CYCLE_DAYS:id.startsWith('scene.')?state[fields[key]]:undefined;},
  apply(id,value){const key=id.split('.').at(-1);if(id.startsWith('scene.')){if(key==='moonPhase')state.lunarDay=value*LUNAR_CYCLE_DAYS;else state[fields[key]]=value;}else overrides[key]=value;},
  composeEnvironment(env){const next={...env,...overrides};
   if(overrides.windSpeed!==undefined&&overrides.wind===undefined)next.wind=Math.min(1,next.windSpeed/35);
   if(overrides.windDirection){const [x,z]=overrides.windDirection,l=Math.hypot(x,z)||1;next.windDirection=[x/l,z/l];}
   if(overrides.temperature===undefined&&(overrides.rain!==undefined||overrides.snow!==undefined))next.temperature=env.temperature+(env.rain-next.rain)*4+(env.snow-next.snow)*12;
   return next;},
 };
}
