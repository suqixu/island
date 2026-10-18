import {createSceneScheduler} from './scene-capabilities/scheduler.js';
import {sampleFilmSchedule,integrateFilmMotion} from './scene-capabilities/sampling.js';
import {sampleFilmScript} from './film-script.js';
/** 播放器与场景之间的薄接入层；第一版影片保持原语义。 */
export function createFilmSceneScheduling({registry,filmCamera,random}){
 const scheduler=registry?createSceneScheduler({registry,random}):null;let script,lastTime=0;const poses=new Map();
 const context=()=>({filmTime:lastTime,environmentAt(time){const sample=sampleFilmScript(script,time),properties=sampleFilmSchedule(script,time,{registry}).properties;return {...sample.environment,hour:properties['scene.hour']??sample.environment.hour};},frameAt(time){const key=`${time}:${filmCamera.aspect??''}`;if(!poses.has(key))poses.set(key,filmCamera.getPoseAt(sampleFilmScript(script,time)));return poses.get(key);}});
 return {
  begin(value){if(value.schemaVersion!==2||!scheduler)return;script=value;poses.clear();scheduler.begin(context());},
  apply(sample){if(!script)return;lastTime=sample.time;scheduler.apply(sampleFilmSchedule(script,sample.time,{registry}),context());},
  getModelTime(time){return script?integrateFilmMotion(script,time):time;},
  composeEnvironment(env,options={}){return script?scheduler.composeEnvironment(env,{...context(),...options}):env;},
  end(){if(!script)return;try{scheduler.end(context());}finally{script=undefined;poses.clear();}},
  get active(){return Boolean(script);},get seed(){return scheduler?.seed;},
 };
}
