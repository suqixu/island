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

test('台风以更沉的拍岸低频和更强风雨响应，解除后恢复原有声场且复用音源', async () => {
  const sources = [];
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connections: [], connect(destination) { this.connections.push(destination); }, disconnect() {},
    gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(), start() {}, stop() {} });
  class Context {
    constructor() { this.sampleRate = 100; this.currentTime = 0; this.state = 'suspended'; this.destination = node(); }
    createGain() { return node(); } createDynamicsCompressor() { return node(); }
    createBiquadFilter() { return node(); } createConvolver() { return node(); }
    createBufferSource() { const source = node(); sources.push(source); return source; }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    async resume() { this.state = 'running'; } close() { this.state = 'closed'; }
  }
  const previous = globalThis.window; globalThis.window = { AudioContext: Context };
  const audio = createAudio();
  const env = { hour: 0, daylight: 0, wind: 1, rain: 1, storm: 1, swell: .8, typhoon: 0 };
  const snapshot = () => sources.map(source => {
    const filter = source.connections[0];
    return { frequency: filter.frequency.value, gain: filter.connections[0].gain.value };
  });
  try {
    await audio.start(); audio.update(-100, env); const ordinary = snapshot();
    audio.update(-100, { ...env, typhoon: 1 }); const typhoon = snapshot();
    assert.ok(typhoon[0].frequency < ordinary[0].frequency * .7, '拍岸低频更沉');
    assert.ok(typhoon[0].gain > ordinary[0].gain * 1.3);
    assert.ok(typhoon[2].gain > ordinary[2].gain * 1.5, '更强的风声');
    assert.ok(typhoon[3].gain > ordinary[3].gain * 1.3, '更密集的暴雨声');
    audio.update(-100, env); assert.deepEqual(snapshot(), ordinary);
    assert.equal(sources.length, 4, '持续复用原有四个环境噪声音源');
  } finally { audio.dispose(); globalThis.window = previous; }
});
