import {getSolarEclipseState} from '../solar-eclipse.js';
import {getLunarEclipseState,getLunarEclipseEnvironment} from '../lunar-eclipse.js';
export function createSkyCapabilityBindings({atmosphere}){
 let clips={},values={},context={};
 return {
  capture:()=>atmosphere?.getRuntimeOptions?.(),begin(){values={};clips={};atmosphere?.beginFilm?.();},restore(){atmosphere?.endFilm?.();clips={};values={};},
  read(id){const [,name,key]=id.split('.'),options=atmosphere?.getRuntimeOptions?.();return name==='constellation'?options?.constellation:options?.[name]?.[key];},
  apply(id,value,ctx){context=ctx;const [,name,key]=id.split('.');values[id]=value;if(['solarEclipse','lunarEclipse','moon','sun','rainbow'].includes(name)||key==='mode'&&name!=='constellation')return;atmosphere?.setRuntimeOptions?.(name==='constellation'?{constellation:value}:{[name]:{[key]:value}});},
  sampleClip(frame,ctx){context=ctx;clips[frame.capability.slice(4)]=frame;},releaseClip(id){delete clips[id.slice(4)];},
  composeEnvironment(env,ctx){context={...context,...ctx};const frames={...clips};
   for(const name of ['meteor','comet','aurora','solarEclipse','lunarEclipse'])if(!frames[name]&&values[`sky.${name}.mode`]&&values[`sky.${name}.mode`]!=='off'){
    const duration=name==='lunarEclipse'?96:name==='solarEclipse'?48:name==='comet'?(values['sky.comet.duration']??16):30;
    const time=context.filmTime??0;const cycle=values[`sky.${name}.mode`]==='default'?Math.floor(time/(duration+20)):0;
    const start=cycle*(duration+20),localTime=time-start;if(localTime<duration)frames[name]={id:`mode-${name}-${cycle}`,capability:`sky.${name}`,start,end:start+duration,localTime,progress:localTime/duration,parameters:{}};
   }
   const parameters=name=>Object.fromEntries(Object.entries(values).filter(([id])=>id.startsWith(`sky.${name}.`)&&!id.endsWith('.mode')).map(([id,v])=>[id.split('.').at(-1),v]));
   for(const [name,frame]of Object.entries(frames))frames[name]={...frame,parameters:{...parameters(name),...frame.parameters}};
   const clear=Math.max(env.cloudiness??0,env.skyCloudCover??0)<.6&&(env.fog??0)<.25&&(env.rain??0)<.2&&(env.storm??0)<.1;
   const lunar=frames.lunarEclipse,solar=frames.solarEclipse;
   const lunarVisible=clear&&(env.daylight??1)<.08&&(env.moonAltitude??-1)>.08&&(env.moonIllumination??0)>=.995;
   const solarVisible=clear&&(env.daylight??0)>.15&&(env.sun?.[1]??0)>.025;
   const moonEnv={...env};if(values['sky.moon.enabled']===false)moonEnv.moonVisibility=0;if(values['sky.moon.size']!==undefined)moonEnv.moonDiscSize=values['sky.moon.size'];if(values['sky.moon.framing'])moonEnv.moonFraming=values['sky.moon.framing'];
   if(values['sky.sun.size']!==undefined)moonEnv.sunDiscSize=values['sky.sun.size'];
   if(values['sky.rainbow.strength']!==undefined)moonEnv.rainbowStrength=values['sky.rainbow.strength'];
   const next=getLunarEclipseEnvironment(moonEnv,getLunarEclipseState(lunar&&lunarVisible?lunar.localTime/(lunar.parameters.duration??96):undefined));
   next.eclipse=getSolarEclipseState(solar&&solarVisible?solar.localTime/(solar.parameters.duration??48):undefined);
   delete frames.lunarEclipse;delete frames.solarEclipse;atmosphere?.sampleFilm?.(frames,context);return next;
  },
 };
}
