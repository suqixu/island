import config from '../config/scene-capabilities.json' with {type:'json'};
import {defaultCapabilities} from './catalog.js';
const bad=message=>{throw new Error(`影片调度：${message}`);};
export function validateFilmSchedule(script,registry=defaultCapabilities){
 const tracks=script.tracks??[],clips=script.clips??[];
 if(!Array.isArray(tracks)||tracks.length>config.limits.maxTracks||!Array.isArray(clips)||clips.length>config.limits.maxClips)bad('轨道或片段数量');
 const names=new Set(),ids=new Set(),ranges=new Map();
 for(const [index,track]of tracks.entries()){
  const label=`轨道${index+1} ${track?.capability}`;if(!track||names.has(track.capability))bad(`${label} 重复`);names.add(track.capability);const def=registry.get(track.capability);
  const interpolation=track.interpolation??'step';if(!['step','linear','smooth'].includes(interpolation)||interpolation!=='step'&&!['number','vector2','vector3'].includes(def.valueType))bad(`${label} 插值方式`);
  if(!Array.isArray(track.keyframes)||!track.keyframes.length||track.keyframes.length>128||track.keyframes[0].at!==0)bad(`${label} 关键点须从0开始`);
  let previous=-1;for(const point of track.keyframes){if(!Number.isFinite(point.at)||point.at<=previous||point.at>script.duration)bad(`${label} 关键点时间`);previous=point.at;const mode=point.interpolation??interpolation;if(!['step','linear','smooth'].includes(mode)||mode!=='step'&&!['number','vector2','vector3'].includes(def.valueType))bad(`${label} 关键点插值方式`);registry.validateValue(track.capability,point.value);}
 }
 for(const [index,clip]of clips.entries()){
  const label=`片段${index+1}`;if(!clip||typeof clip.id!=='string'||!clip.id||clip.id.length>80||ids.has(clip.id))bad(`${label} ID重复或缺失`);ids.add(clip.id);
  const def=registry.get(clip.capability);if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>script.duration)bad(`${label} 时间范围`);
  registry.validateParameters(clip.capability,clip.parameters);
  const existing=ranges.get(clip.capability)??[];if(!def.allowOverlap&&existing.some(other=>clip.start<other.end&&other.start<clip.end))bad(`${label} ${clip.capability} 重叠`);existing.push(clip);ranges.set(clip.capability,existing);
 }
}
export function sampleFilmSchedule(script,time,{registry=defaultCapabilities,baseline={}}={}){
 time=Math.max(0,Math.min(script.duration,Number.isFinite(time)?time:0));
 const properties={...baseline};
 for(const track of script.tracks??[]){let i=0;while(i<track.keyframes.length-1&&track.keyframes[i+1].at<=time)i++;const a=track.keyframes[i],b=track.keyframes[Math.min(i+1,track.keyframes.length-1)],mode=a.interpolation??track.interpolation??'step';let value=a.value;
  if(mode!=='step'&&b.at>a.at){let p=Math.max(0,Math.min(1,(time-a.at)/(b.at-a.at)));if(mode==='smooth')p=p*p*(3-2*p);const period=registry.get(track.capability).period;
   const lerp=(x,y)=>{let delta=y-x;if(period){delta=((delta%period)+period)%period;if(delta>period/2)delta-=period;}const result=x+delta*p;return period?((result%period)+period)%period:result;};value=Array.isArray(a.value)?a.value.map((v,j)=>lerp(v,b.value[j])):lerp(a.value,b.value);}
  properties[track.capability]=value;
 }
 const clips=(script.clips??[]).filter(c=>time>=c.start&&time<c.end).map(c=>{const defaults=registry.validateParameters(c.capability,c.parameters),parameters=Object.fromEntries(Object.keys(c.parameters??{}).map(key=>[key,defaults[key]]));return {...c,parameters,localTime:time-c.start,progress:Math.min(1,(time-c.start)/(defaults.duration??(c.end-c.start)))};});
 return {time,properties,clips};
}

/** 积分运动速度轨道；直接定位与顺序推进得到相同的累计运动时间。 */
export function integrateFilmMotion(script,time){
 time=Math.max(0,Math.min(script.duration,Number.isFinite(time)?time:0));
 const track=script.tracks?.find(t=>t.capability==='scene.motionRate');if(!track)return time;
 let total=0;for(let i=0;i<track.keyframes.length;i++){
  const a=track.keyframes[i],b=track.keyframes[i+1],end=Math.min(time,b?.at??script.duration);if(end<=a.at)break;
  const duration=(b?.at??script.duration)-a.at,p=(end-a.at)/duration,mode=a.interpolation??track.interpolation??'step';
  const blend=mode==='smooth'?p*p*p-.5*p*p*p*p:mode==='linear'?p*p*.5:0;
  total+=duration*(a.value*p+((b?.value??a.value)-a.value)*blend);if(end===time)break;
 }return total;
}
