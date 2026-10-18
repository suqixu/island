import {getArtificialLightControls} from '../artificial-light-controls.js';
export function createPresentationCapabilityBindings({getQuality=()=> 'high',applyQuality=()=>{},poetry,lights={getMode:()=> 'auto',setMode(){}},getAudio=()=>undefined}={}){
 let values={};
 return {
  capture:()=>({quality:getQuality(),poetry:poetry?.enabled,lights:lights.getMode(),values:{...values}}),begin(){values={};},
  restore(saved){values=saved.values;applyQuality(saved.quality);if(saved.poetry!==undefined)poetry.setEnabled(saved.poetry);lights.setMode(saved.lights);},
  read(id){if(id==='render.quality')return getQuality();if(id==='presentation.poetry')return poetry?.enabled;if(id==='lights.mode')return lights.getMode();return undefined;},
  apply(id,value){values[id]=value;if(id==='render.quality')applyQuality(value);else if(id==='presentation.poetry')poetry?.setEnabled(value);else if(id==='lights.mode')lights.setMode(value);},
  getMusicOptions(){return Object.fromEntries(Object.entries(values).filter(([id])=>id.startsWith('audio.')).map(([id,v])=>[id.slice(6),v]));},
  composeEnvironment(env){const next={...env};if(values['lights.mode']!==undefined)Object.assign(next,getArtificialLightControls(values['lights.mode']));
   for(const name of ['lighthouse','path','pavilion','dock'])next[`${name}LightIntensity`]=(values[`lights.${name}.enabled`]===false?0:1)*(values[`lights.${name}.intensity`]??1);
   return next;},
 };
}
