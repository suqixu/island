import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio.js';

test('关闭音频后再次开启应重建可用的 AudioContext', async () => {
  let instances = 0;
  const param = () => ({value:0,setTargetAtTime(){}});
  const node = () => ({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),threshold:param(),ratio:param(),start(){},stop(){}});
  class Context {
    constructor(){ instances++; this.sampleRate=100; this.currentTime=0; this.state='suspended'; this.destination=node(); }
    createGain(){return node();} createDynamicsCompressor(){return node();}
    createBiquadFilter(){return node();} createConvolver(){return node();} createBufferSource(){return node();}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    async resume(){if(this.state==='closed')throw new Error('不能恢复已关闭的音频');this.state='running';}
    close(){this.state='closed';}
  }
  const originalWindow=globalThis.window;
  globalThis.window={AudioContext:Context};
  try {
    const audio=createAudio();
    await audio.start();audio.dispose();await audio.start();
    assert.equal(instances,2);
    audio.dispose();
  } finally {globalThis.window=originalWindow;}
});

test('播放设置在首次启用前保存，暂停音乐不停止环境声或音频上下文', async () => {
  const instances=[], media=[], noiseSources=[];
  const param=()=>({value:0,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
  const node=()=>({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),threshold:param(),ratio:param(),start(){this.started=true;},stop(){this.stopped=true;}});
  class Context {
    constructor(){instances.push(this);this.sampleRate=100;this.currentTime=0;this.state='suspended';this.destination=node();}
    createGain(){return node();}createDynamicsCompressor(){return node();}createBiquadFilter(){return node();}createConvolver(){return node();}
    createBufferSource(){const n=node();noiseSources.push(n);return n;}createMediaElementSource(){return node();}
    createBuffer(c,l){return{getChannelData:()=>new Float32Array(l)};}async resume(){this.state='running';}close(){this.state='closed';}
  }
  class Media {
    constructor(){media.push(this);this.paused=true;this.currentTime=0;this.handlers=new Map();}
    addEventListener(t,f){this.handlers.set(t,f);}removeEventListener(t){this.handlers.delete(t);}setAttribute(){}removeAttribute(){this.src='';}load(){}
    play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}
  }
  const original=globalThis.window;globalThis.window={AudioContext:Context,Audio:Media};
  const audio=createAudio({backgroundTracks:{nuerqing:{url:'/nuerqing.mp3',title:'女儿情'}}});
  const env={hour:22,daylight:0,weather:'sunny',wind:.2,storm:0,rain:0,moonLight:1};
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  try {
    audio.setMusicPlayback({mode:'single',trackId:'nuerqing',rate:1.25});
    assert.equal(media.length,0);await audio.start();audio.update(0,env);await settle();
    const el=media.find(e=>!e.paused);assert.equal(el.src,'/nuerqing.mp3');assert.equal(el.loop,true);assert.equal(el.playbackRate,1.25);
    el.currentTime=12;audio.setMusicPlayback({paused:true});audio.update(1,env);await settle();
    assert.ok(media.every(e=>e.paused));assert.equal(instances[0].state,'running');assert.ok(noiseSources.every(n=>n.started&&!n.stopped));
    audio.setMusicPlayback({paused:false});await settle();assert.equal(el.paused,false);assert.equal(el.currentTime,12);
  } finally {audio.dispose();globalThis.window=original;}
});
