import {parseFilmScript,sampleFilmScript} from './film-script.js';
import config from './config/film.json' with {type:'json'};

export function createFilmPlayer({capabilities,capture=()=>({}),restore=()=>{},prepare=async()=>{},onFrame=()=>{},onSeek=()=>{},onStatus=()=>{}}={}) {
  let script,status='idle',time=0,rate=1,lastNow,snapshot,controller,revision=0,disposed=false,pauseAfterPrepare=false;
  const getState=()=>({status,time,rate,duration:script?.duration??0,script,active:snapshot!==undefined,paused:status==='paused'||status==='ended'});
  function notify(){onStatus(getState());}
  function cancel(){revision++;controller?.abort();controller=undefined;lastNow=undefined;}
  function exit(){if(disposed)return;cancel();const saved=snapshot;snapshot=undefined;status='idle';time=0;try{if(saved!==undefined)restore(saved);}finally{notify();}}
  function load(value){const next=parseFilmScript(value,{capabilities});if(disposed)return;if(snapshot!==undefined)exit();script=next;time=0;notify();}
  async function start(restart=false){
    if(disposed||!script)return false;
    if(!restart&&status==='playing')return true;
    if(!restart&&status==='paused'){resume();return true;}
    cancel();const token=revision;controller=new AbortController();
    try{
      if(snapshot===undefined)snapshot=capture(script);time=0;pauseAfterPrepare=false;status='preparing';notify();
      await prepare(script,{signal:controller.signal,restart});
      if(disposed||token!==revision)return false;
      status=pauseAfterPrepare?'paused':'playing';lastNow=undefined;onFrame(sampleFilmScript(script,0));notify();return true;
    }catch(error){if(token!==revision||disposed)return false;exit();throw error;}
  }
  function pause(){if(status==='preparing'){pauseAfterPrepare=true;return;}if(status!=='playing')return;status='paused';lastNow=undefined;notify();}
  function resume(){if(disposed||status!=='paused')return;status='playing';lastNow=undefined;notify();}
  function setRate(value){if(disposed||!config.playbackRates.includes(value))return;rate=value;lastNow=undefined;notify();}
  function seek(value){
    if(disposed||snapshot===undefined||status==='preparing'||!Number.isFinite(value))return;
    time=Math.max(0,Math.min(script.duration,value));lastNow=undefined;
    if(time>=script.duration)status='ended';else if(status==='ended')status='paused';
    try{const sample=sampleFilmScript(script,time);onSeek(sample);onFrame(sample);notify();}catch(error){exit();throw error;}
  }
  function update(nowMs){
    if(disposed||status!=='playing'||!Number.isFinite(nowMs))return;
    const delta=lastNow===undefined?0:Math.max(0,(nowMs-lastNow)/1000);lastNow=nowMs;time=Math.min(script.duration,time+delta*rate);
    try{onFrame(sampleFilmScript(script,time));if(time>=script.duration){status='ended';lastNow=undefined;notify();}}
    catch(error){exit();throw error;}
  }
  return {load,play:()=>start(),pause,resume,setRate,seek,restart:()=>start(true),exit,update,getState,dispose(){if(disposed)return;exit();disposed=true;script=undefined;}};
}
