import {createScenicMusic} from '../src/scenic-music.js';
import chunjiang from '../src/assets/music/chunjiang-synth.mp3?url';
import caiyun from '../src/assets/music/caiyun-synth.mp3?url';
import pingsha from '../src/assets/music/pingsha-synth.mp3?url';
import mengjiang from '../src/assets/music/mengjiang-synth.mp3?url';
import shange from '../src/assets/music/shange-synth.mp3?url';
import zuguo from '../src/assets/music/zuguo-synth.mp3?url';
import liangzhu from '../src/assets/music/liangzhu-synth.mp3?url';
import nuerqing from '../src/assets/music/nuerqing-synth.mp3?url';
import wangningmei from '../src/assets/music/wangningmei-synth.mp3?url';
import molihua from '../src/assets/music/molihua-synth.mp3?url';
import yueer from '../src/assets/music/yueer-synth.mp3?url';
import sunset from '../src/assets/music/yuzhou-changwan-weather.mp3?url';
const tracks={sunset:{url:sunset,title:'渔舟唱晚'},chunjiang:{url:chunjiang,title:'春江花月夜'},caiyun:{url:caiyun,title:'彩云追月'},pingsha:{url:pingsha,title:'平沙落雁'},mengjiang:{url:mengjiang,title:'孟姜女哭长城'},shange:{url:shange,title:'山歌好比春江水'},zuguo:{url:zuguo,title:'我的祖国'},liangzhu:{url:liangzhu,title:'梁祝'},nuerqing:{url:nuerqing,title:'女儿情'},wangningmei:{url:wangningmei,title:'枉凝眉'}};
tracks.molihua={url:molihua,title:'茉莉花'};
tracks.yueer={url:yueer,title:'月儿明风儿静'};
// 自动收录资产目录中的全部格式，新增音频文件后无需再手动添加试听控件。
const audioFiles=import.meta.glob('../src/assets/music/*.{mp3,ogg,wav}',{eager:true,query:'?url',import:'default'});
const groups=[['合成纯音乐 · MP3',[]],['合成源文件 · Ogg',[]],['其他音频',[]]];
for(const [path,url]of Object.entries(audioFiles)){
 const file=path.split('/').at(-1),stem=file.replace(/\.[^.]+$/,''),format=file.split('.').at(-1);
 const id=stem==='yuzhou-changwan-weather'?'sunset':stem.replace(/-synth$/,'');
 const title=tracks[id]?.title??stem;
 const group=format==='ogg'?1:format==='mp3'?0:2;
 groups[group][1].push({url,file,id,title,format});
}
function pauseAuditions(){document.querySelectorAll('[data-audition]').forEach(e=>e.pause());}
const audition=document.querySelector('#auditions');
document.querySelector('#audio-count').textContent=`共 ${Object.keys(audioFiles).length} 个音频文件，点击试听或播放器的播放按钮即可。切换音频自动暂停上一首。`;
for(const [label,files]of groups){
 if(!files.length)continue;
 const section=document.createElement('section'),heading=document.createElement('h2');
 heading.textContent=`${label}（${files.length}）`;section.append(heading);audition.append(section);
 for(const {url,file,id,title,format}of files){
  const row=document.createElement('div'),button=document.createElement('button'),audio=document.createElement('audio'),filename=document.createElement('small'),error=document.createElement('span');
  const displayTitle=tracks[id]&&['molihua','yueer'].includes(id)?`${title} · 完整版`:title;
  row.className='audio-row';button.textContent=`试听${displayTitle}`;button.setAttribute('aria-label',`试听${displayTitle}（${label}）`);
  audio.controls=true;audio.preload='none';audio.src=url;audio.dataset.track=id;audio.dataset.audition=format;
  audio.setAttribute('aria-label',`${displayTitle}（${label}）`);filename.textContent=file;
  error.className='audio-error';error.setAttribute('role','status');
  audio.addEventListener('play',()=>{music?.setAvailable(false);document.querySelectorAll('audio').forEach(e=>{if(e!==audio)e.pause();});error.textContent='';});
  audio.addEventListener('error',()=>{error.textContent=`加载失败：${audio.error?.message||'浏览器未能读取此音频'}`;});
  button.onclick=async()=>{try{await audio.play();}catch(reason){error.textContent=`播放失败：${reason.message}`;}};
  row.append(button,audio,filename,error);section.append(row);
 }
}
let context,music,status,env={hour:12,daylight:1,moonLight:0,weather:'sunny',season:'summer',cloudiness:.12};
const elements=[], gains=[];
document.querySelector('#start').onclick=async()=>{
 pauseAuditions();
 if(context){music.setAvailable(true);return;}
 context=new AudioContext();await context.resume();
 const createGain=context.createGain.bind(context);
 context.createGain=()=>{const gain=createGain();gains.push(gain);return gain;};
 const destination=context.createGain();destination.gain.value=.4;destination.connect(context.destination);
 music=createScenicMusic(context,destination,{tracks,onStatus:value=>status=value,
 mediaFactory(){const element=document.createElement('audio');element.controls=true;document.querySelector('#media').append(element);elements.push(element);return element;}});
 music.setAvailable(true);
};
document.querySelector('#day').onclick=()=>{env={...env,hour:12,daylight:1,moonLight:0,weather:'sunny'};};
document.querySelector('#night').onclick=()=>{env={...env,hour:22,daylight:0,moonLight:1,weather:'sunny'};};
document.querySelector('#sunset').onclick=()=>{env={...env,hour:18,daylight:.2,sun:[0,.02,1],weather:'sunny'};};
document.querySelector('#quiet').onclick=()=>{env={...env,hour:12,daylight:1,moonLight:0,weather:'rain'};};
document.querySelector('#mute').onclick=()=>music?.setAvailable(false);
document.querySelector('#resume').onclick=()=>{pauseAuditions();music?.setAvailable(true);};
document.querySelector('#tail').onclick=()=>{const element=elements.find(e=>!e.paused&&Number.isFinite(e.duration));if(element)element.currentTime=Math.max(0,element.duration-1);};
setInterval(()=>{if(!context)return;music.update(env);document.querySelector('#result').textContent=JSON.stringify({context:context.state,time:context.currentTime,status,gains:gains.map(g=>g.gain.value),media:elements.map(e=>({src:e.currentSrc,time:e.currentTime,paused:e.paused,ready:e.readyState,error:e.error?.message}))},null,2);},250);
window.addEventListener('pagehide',()=>{music?.dispose();context?.close();});
