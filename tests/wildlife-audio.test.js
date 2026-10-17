import test from 'node:test';
import assert from 'node:assert/strict';
import * as audioModule from '../src/audio.js';

function profile(event) {
  assert.equal(typeof audioModule.getWildlifeSoundProfile, 'function', '动物声应共享距离和方位控制');
  return audioModule.getWildlifeSoundProfile(event);
}

test('鲸鱼呼气、水花、飞鱼和海豚有不同的短声音轮廓', () => {
  const whale = profile({ type: 'whale-blow', distance: 10 });
  const splash = profile({ type: 'splash', distance: 10 });
  const flying = profile({ type: 'flying-fish', distance: 10 });
  const dolphin = profile({ type: 'dolphin', distance: 10 });
  assert.ok(whale.duration > splash.duration && splash.duration > flying.duration);
  assert.ok(whale.frequency < splash.frequency);
  assert.ok(dolphin.tonal, '海豚有短促音调，区别于落水噪声');
  for (const sound of [whale, splash, flying, dolphin]) {
    assert.ok(sound.volume > 0 && sound.volume < .4);
    assert.ok(sound.duration > 0 && sound.duration < 3);
  }
});

test('远处动物轻声、近处清晰，左右方位保持且过远不播放', () => {
  const near = profile({ type: 'whale-blow', distance: 10, pan: -.7 });
  const far = profile({ type: 'whale-blow', distance: 300, pan: .6 });
  assert.ok(near.volume > far.volume * 5);
  assert.equal(near.pan, -.7);
  assert.equal(far.pan, .6);
  const distantWhale = profile({ type: 'whale-blow', distance: 650 });
  assert.ok(distantWhale && distantWhale.volume > 0 && distantWhale.volume < far.volume);
  assert.equal(profile({ type: 'splash', distance: 1200 }), null);
  assert.equal(profile({ type: 'unknown' }), null);
  for (const type of ['toString', 'constructor', '__proto__']) assert.equal(profile({ type }), null);
});

test('声效异常输入不会产生无效频率、音量或方位，零强度不播放', () => {
  for (const event of [{ distance: NaN, strength: Infinity, pan: NaN }, { distance: -20, strength: 8, pan: -5 }]) {
    const result = profile({ type: 'splash', ...event });
    for (const key of ['volume', 'frequency', 'duration', 'pan']) assert.ok(Number.isFinite(result[key]));
    assert.ok(result.pan >= -1 && result.pan <= 1);
    assert.ok(result.volume > 0 && result.volume < .4);
  }
  assert.equal(profile({ type: 'splash', strength: 0 }), null);
});

test('未开启、静音和关闭后动物事件不创建音源，开启后才播放', async () => {
  let contexts = 0, started = 0;
  const param = () => ({ value: 0, setTargetAtTime(){}, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} });
  const node = () => ({ connect(){}, disconnect(){}, gain: param(), frequency: param(), Q: param(), pan: param(), threshold: param(), ratio: param(), start(){started++;}, stop(){} });
  class Context {
    constructor(){contexts++; this.sampleRate=100; this.currentTime=0; this.state='suspended'; this.destination=node();}
    createGain(){return node();} createDynamicsCompressor(){return node();} createBiquadFilter(){return node();}
    createConvolver(){return node();} createBufferSource(){return node();} createOscillator(){return node();} createStereoPanner(){return node();}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    async resume(){this.state='running';} close(){this.state='closed';}
  }
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  globalThis.window = { AudioContext: Context }; globalThis.document = { hidden: false };
  try {
    const audio = audioModule.createAudio();
    assert.equal(typeof audio.wildlife, 'function');
    assert.equal(audio.wildlife({type:'splash'}), false);
    assert.equal(contexts, 0);
    await audio.start();
    const before = started;
    assert.equal(audio.wildlife({type:'whale-blow',distance:15}), true);
    assert.ok(started > before);
    audio.setEnabled(false); const muted = started;
    assert.equal(audio.wildlife({type:'splash'}), false); assert.equal(started, muted);
    audio.dispose();
    assert.equal(audio.wildlife({type:'dolphin'}), false); assert.equal(contexts, 1);
  } finally { globalThis.window = originalWindow; globalThis.document = originalDocument; }
});

test('16倍速使用真实音频时钟限制动物、雷声和风铃，退出立即恢复事件声效', async () => {
  let started = 0, context;
  const param = () => ({value:0,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node = () => ({connect(){},disconnect(){},gain:param(),frequency:param(),Q:param(),pan:param(),threshold:param(),ratio:param(),start(){started++;},stop(){}});
  class Context {
    constructor(){context=this;this.sampleRate=100;this.currentTime=0;this.state='suspended';this.destination=node();}
    createGain(){return node();} createDynamicsCompressor(){return node();} createBiquadFilter(){return node();}
    createConvolver(){return node();} createBufferSource(){return node();} createOscillator(){return node();} createStereoPanner(){return node();}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    async resume(){this.state='running';} close(){this.state='closed';}
  }
  const originalWindow=globalThis.window, originalDocument=globalThis.document;
  globalThis.window={AudioContext:Context};globalThis.document={hidden:false};
  const audio=audioModule.createAudio();
  try {
    assert.equal(typeof audio.setAnimationRate,'function');audio.setAnimationRate(16);await audio.start();
    assert.equal(audio.wildlife({type:'splash'}),true);
    const before=started;
    for(let i=0;i<20;i++){audio.wildlife({type:'dolphin'});audio.chime({});audio.thunder();}
    assert.equal(started,before,'三种事件共享冷却，不能被加速触发堆叠');
    context.currentTime=3.1;assert.equal(audio.chime({}),true);
    audio.setAnimationRate(1);assert.equal(audio.wildlife({type:'dolphin'}),true);
    assert.ok(started>before);
  } finally {audio.dispose();globalThis.window=originalWindow;globalThis.document=originalDocument;}
});
