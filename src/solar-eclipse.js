import { DEFAULTS } from './runtime-config.js';
const schedule=DEFAULTS.sky.schedules.solarEclipse;
const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const DURATION=schedule.duration,MOON_RADIUS=1.05;

/** A scenic transit: overlapping discs produce partial coverage, a brief
 * totality plateau, then a continuous return to normal daylight. */
export function getSolarEclipseState(progress){
  if(!Number.isFinite(progress))return{active:false,progress:0,offset:-2.1,coverage:0,totality:0,lightFactor:1};
  const phase=clamp(progress);
  const offset=phase<.42?-2.1+2.08*smooth(phase/.42)
    :phase>.58?.02+2.08*smooth((phase-.58)/.42):-.02+.04*(phase-.42)/.16;
  const distance=Math.abs(offset)*Math.hypot(1,.08),r=MOON_RADIUS;
  let coverage=0;
  if(distance<=r-1)coverage=1;
  else if(distance<r+1){
    const d2=distance*distance;
    const a=Math.acos(clamp((d2+1-r*r)/(2*distance),-1,1));
    const b=Math.acos(clamp((d2+r*r-1)/(2*distance*r),-1,1));
    const lens=Math.sqrt(Math.max(0,(-distance+1+r)*(distance+1-r)*(distance-1+r)*(distance+1+r)))*.5;
    coverage=clamp((a+r*r*b-lens)/Math.PI);
  }
  return{active:true,progress:phase,offset,coverage,totality:smooth((coverage-.97)/.03),lightFactor:1-.985*coverage**3};
}

export function createSolarEclipse({random=Math.random}={}){
  let mode=DEFAULTS.sky.solarEclipse,observed=0,nextAt=DEFAULTS.sky.solarEclipse==='instant'?0:schedule.initialWait.min+random()*schedule.initialWait.range,age=-1,completedDay=-Infinity;
  function reset(){completedDay=-Infinity;age=-1;nextAt=observed+(mode==='instant'?0:schedule.initialWait.min+random()*schedule.initialWait.range);}
  function setMode(value){
    const next=DEFAULTS.sky.modes.includes(value)?value:DEFAULTS.sky.solarEclipse;
    if(next===mode)return;mode=next;reset();
  }
  function update(delta,env={}){
    const dt=Number.isFinite(delta)?clamp(delta,0,1):0;
    const sunHeight=env.sunDirection?.y??env.sun?.[1]??0;
    const dayIndex=env.dayIndex??0,hour=env.hour??12;
    const daytime=(env.daylight??0)>.15&&sunHeight>.025;
    const startDaytime=daytime&&(env.daylight??0)>.7&&sunHeight>.58&&hour>=9&&hour<=15.5;
    const clear=startDaytime
      &&Math.max(env.cloudiness??0,env.skyCloudCover??0)<.6&&(env.fog??0)<.25&&(env.rain??0)<.2&&(env.storm??0)<.1;
    if(mode==='off')return getSolarEclipseState();
    if(clear)observed+=dt;
    if(!daytime){
      if(age>=0){age=-1;nextAt=observed+(mode==='instant'?0:schedule.repeatWait.min+random()*schedule.repeatWait.range);}
      return getSolarEclipseState();
    }
    if(age>=0){
      age+=dt;
      if(age>=DURATION){completedDay=dayIndex;age=-1;nextAt=observed+(mode==='instant'?0:schedule.repeatWait.min+random()*schedule.repeatWait.range);return getSolarEclipseState();}
    }else if(completedDay!==dayIndex&&(mode==='instant'?startDaytime:clear)&&observed>=nextAt)age=0;
    return getSolarEclipseState(age>=0?age/DURATION:undefined);
  }
  return{setMode,update,reset};
}
