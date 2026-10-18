import config from './config/film.json' with {type:'json'};
import weather from './config/weather.json' with {type:'json'};
import music from './config/music.json' with {type:'json'};
import {validateFilmSchedule} from './scene-capabilities/sampling.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const bad=detail=>{throw new Error(`${config.labels.invalid}：${detail}`);};
const valid=(condition,detail)=>{if(!condition)bad(detail);};
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
function frames(values,length,kind) {
  valid(Array.isArray(values)&&values.length>0&&values.length<=config.limits.maxKeyframes,`${kind}关键点数量`);
  let previous=-1;
  for(const value of values){valid(value&&finite(value.at)&&value.at>=0&&value.at<=length&&value.at>previous,`${kind}关键点时间`);previous=value.at;}
  valid(values[0].at===0,`${kind}关键点须从零开始`);
}

export function parseFilmScript(input,{maxBytes=config.limits.maxBytes,capabilities}={}) {
  let source;
  try{source=typeof input==='string'?input:JSON.stringify(input);}catch{bad('无法读取数据');}
  valid(typeof source==='string','需要JSON脚本');
  if(new TextEncoder().encode(source).byteLength>maxBytes)throw new Error(config.labels.tooLarge);
  let value;try{value=JSON.parse(source);}catch{bad('无法解析JSON');}
  if(!value||value.format!=='isola-film'||![1,2].includes(value.schemaVersion))throw new Error(config.labels.unsupported);
  valid(text(value.title,160),'片名');valid(finite(value.duration)&&value.duration>=1&&value.duration<=config.limits.maxDuration,'片长');
  valid(Array.isArray(value.shots)&&value.shots.length>0&&value.shots.length<=config.limits.maxShots,'镜头数量');
  const ids=new Set();let end=0;
  for(const shot of value.shots){
    valid(shot&&text(shot.id,80)&&!ids.has(shot.id),'镜头名称重复或缺失');ids.add(shot.id);
    valid(finite(shot.start)&&finite(shot.end)&&Math.abs(shot.start-end)<1e-6&&shot.end>shot.start&&shot.end<=value.duration,'镜头时段须连续且不重叠');end=shot.end;
    valid(config.landmarks.includes(shot.landmark),'未知观看位置');const duration=shot.end-shot.start;
    frames(shot.camera,duration,'镜头');
    for(const frame of shot.camera){for(const key of ['position','target'])valid(Array.isArray(frame[key])&&frame[key].length===3&&frame[key].every(finite),'镜头坐标');valid(finite(frame.fov)&&frame.fov>=25&&frame.fov<=90,'镜头视野');}
    frames(shot.environment,duration,'环境');
    for(const env of shot.environment){valid(finite(env.hour)&&env.hour>=0&&env.hour<24,'一天中的时间');valid(Number.isInteger(env.season)&&env.season>=0&&env.season<4,'季节');valid(Object.hasOwn(weather.presets,env.weather),'未知天气');valid(finite(env.snowCover)&&env.snowCover>=0&&env.snowCover<=1,'积雪范围');}
  }
  valid(Math.abs(end-value.duration)<1e-6,'镜头须覆盖完整片长');
  value.captions??=[];valid(Array.isArray(value.captions)&&value.captions.length<=config.limits.maxCaptions,'字幕数量');
  for(const caption of value.captions)valid(caption&&finite(caption.start)&&finite(caption.end)&&caption.start>=0&&caption.end>caption.start&&caption.end<=value.duration&&text(caption.text,2000)&&['title','body','ending'].includes(caption.style??'body'),'字幕内容或时段');
  if(value.music){valid(music.tracks.some(track=>track.id===value.music.trackId),'未知音乐');for(const key of ['musicVolume','ambientVolume'])valid(finite(value.music[key])&&value.music[key]>=0&&value.music[key]<=1,'音量范围');for(const key of ['fadeIn','fadeOut'])valid(finite(value.music[key])&&value.music[key]>=0&&value.music[key]<=value.duration,'音乐渐变时间');}
  if(value.schemaVersion===2)validateFilmSchedule(value,capabilities);
  else valid(!value.tracks?.length&&!value.clips?.length,'调度轨道需要第二版脚本');
  return value;
}

export function getFilmKeyframes(frames,time) {
  let index=0;while(index<frames.length-1&&frames[index+1].at<=time)index++;
  const from=frames[index],to=frames[Math.min(index+1,frames.length-1)];
  return {from,to,index,progress:to.at>from.at?clamp((time-from.at)/(to.at-from.at),0,1):0};
}
export function sampleFilmScript(script,seconds) {
  const time=clamp(finite(seconds)?seconds:0,0,script.duration),ended=time>=script.duration;
  const shot=script.shots.find(shot=>time<shot.end)??script.shots.at(-1),local=time-shot.start;
  const {from,to,progress}=getFilmKeyframes(shot.environment,local);
  const hourDelta=((to.hour-from.hour+36)%24)-12;
  const environment={...from,hour:((from.hour+hourDelta*progress)%24+24)%24,snowCover:from.snowCover+(to.snowCover-from.snowCover)*progress};
  const transition=Math.min(config.transitionSeconds,(shot.end-shot.start)/3);
  const fade=Math.max(clamp(1-local/transition,0,1),ended?(script.schemaVersion===2?1:0):clamp(1-(shot.end-time)/transition,0,1));
  const gain=script.music?Math.min(script.music.fadeIn>0?time/script.music.fadeIn:1,script.music.fadeOut>0?(script.duration-time)/script.music.fadeOut:1,1):0;
  return {time,shot,progress:clamp(local/(shot.end-shot.start),0,1),environment,ended,fade,
    captions:script.captions.filter(c=>time>=c.start&&(time<c.end||(ended&&c.end===script.duration))),music:script.music?{...script.music,gain:clamp(gain,0,1)}:null};
}
