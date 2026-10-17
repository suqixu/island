import {createScenicMusic} from '../src/scenic-music.js';
import chunjiang from '../src/assets/audio/chunjiang-synth.mp3?url';
import caiyun from '../src/assets/audio/caiyun-synth.mp3?url';
import pingsha from '../src/assets/audio/pingsha-synth.mp3?url';
import mengjiang from '../src/assets/audio/mengjiang-synth.mp3?url';
import shange from '../src/assets/audio/shange-synth.mp3?url';
import zuguo from '../src/assets/audio/zuguo-synth.mp3?url';
import liangzhu from '../src/assets/audio/liangzhu-synth.mp3?url';
import nuerqing from '../src/assets/audio/nuerqing-synth.mp3?url';
import wangningmei from '../src/assets/audio/wangningmei-synth.mp3?url';
import sunset from '../src/assets/audio/yuzhou-changwan-weather.mp3?url';
const tracks={sunset:{url:sunset,title:'渔舟唱晚'},chunjiang:{url:chunjiang,title:'春江花月夜'},caiyun:{url:caiyun,title:'彩云追月'},pingsha:{url:pingsha,title:'平沙落雁'},mengjiang:{url:mengjiang,title:'孟姜女哭长城'},shange:{url:shange,title:'山歌好比春江水'},zuguo:{url:zuguo,title:'我的祖国'},liangzhu:{url:liangzhu,title:'梁祝'},nuerqing:{url:nuerqing,title:'女儿情'},wangningmei:{url:wangningmei,title:'枉凝眉'}};
const audition=document.createElement('section');audition.innerHTML='<h2>新增器乐主题试听</h2>';document.body.append(audition);
for(const id of ['mengjiang','shange','zuguo','liangzhu','nuerqing','wangningmei']){
 const row=document.createElement('div'),button=document.createElement('button'),audio=document.createElement('audio');
 button.textContent=`试听${tracks[id].title}`;audio.controls=true;audio.preload='none';audio.src=tracks[id].url;audio.dataset.track=id;
 button.onclick=async()=>{document.querySelectorAll('audio').forEach(e=>e.pause());try{await audio.play();}catch(error){row.dataset.error=error.message;}};
 row.append(button,audio);audition.append(row);
}
let context,music,status,env={hour:12,daylight:1,moonLight:0,weather:'sunny',season:'summer',cloudiness:.12};
const elements=[], gains=[];
document.querySelector('#start').onclick=async()=>{
 if(context)return;
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
document.querySelector('#resume').onclick=()=>music?.setAvailable(true);
document.querySelector('#tail').onclick=()=>{const element=elements.find(e=>!e.paused&&Number.isFinite(e.duration));if(element)element.currentTime=Math.max(0,element.duration-1);};
setInterval(()=>{if(!context)return;music.update(env);document.querySelector('#result').textContent=JSON.stringify({context:context.state,time:context.currentTime,status,gains:gains.map(g=>g.gain.value),media:elements.map(e=>({src:e.currentSrc,time:e.currentTime,paused:e.paused,ready:e.readyState,error:e.error?.message}))},null,2);},250);
window.addEventListener('pagehide',()=>{music?.dispose();context?.close();});
