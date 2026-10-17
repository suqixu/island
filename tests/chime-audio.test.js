import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, getChimeSoundProfile } from '../src/audio.js';

test('风铃采用轻柔五声音高，近处清楚、远处减弱，并限制无效声场参数', () => {
  const pitches = new Set();
  for (let variant = 0; variant < 5; variant++) {
    const close = getChimeSoundProfile({ variant, strength: .7, distance: 12, pan: -8 });
    const far = getChimeSoundProfile({ variant, strength: .7, distance: 120 });
    pitches.add(close.frequency);
    assert.ok(close.volume > far.volume && close.volume < .12);
    assert.ok(close.duration > 2 && close.duration < 6);
    assert.equal(close.pan, -1);
  }
  assert.equal(pitches.size, 5);
  assert.equal(getChimeSoundProfile({ strength: 0 }), null);
  assert.equal(getChimeSoundProfile({ distance: 221 }), null);
  const fallback = getChimeSoundProfile({ distance: NaN, variant: Infinity, strength: NaN, pan: NaN });
  assert.ok(Number.isFinite(fallback.frequency) && Number.isFinite(fallback.volume));
});

function audioHarness() {
  const contexts = [];
  const param = value => ({ value, scheduled: [],
    setValueAtTime(value, time) { this.scheduled.push([value, time]); },
    setTargetAtTime(value, time) { this.scheduled.push([value, time]); },
    linearRampToValueAtTime(value, time) { this.scheduled.push([value, time]); },
    exponentialRampToValueAtTime(value, time) { this.scheduled.push([value, time]); },
  });
  class Node {
    constructor(kind) { this.kind = kind; this.links = []; this.disconnected = false; this.starts = []; this.stops = [];
      for (const key of ['gain','frequency','Q','pan','threshold','ratio']) this[key] = param(0);
    }
    connect(to) { this.links.push(to); }
    disconnect() { this.disconnected = true; }
    start(time) { this.starts.push(time); }
    stop(time) { this.stops.push(time); }
  }
  class Context {
    constructor() { this.sampleRate = 100; this.currentTime = 10; this.state = 'suspended'; this.nodes = []; this.destination = new Node('destination'); contexts.push(this); }
    node(kind) { const value = new Node(kind); this.nodes.push(value); return value; }
    createGain() { return this.node('gain'); }
    createDynamicsCompressor() { return this.node('compressor'); }
    createBiquadFilter() { return this.node('filter'); }
    createConvolver() { return this.node('convolver'); }
    createBufferSource() { return this.node('buffer'); }
    createOscillator() { return this.node('oscillator'); }
    createStereoPanner() { return this.node('panner'); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    async resume() { this.state = 'running'; }
    close() { this.state = 'closed'; }
  }
  return { contexts, Context };
}

test('风铃仅在声音开启后建立有限音源，按环境音量播放并释放结束的节点', async () => {
  const harness = audioHarness(), originalWindow = globalThis.window;
  globalThis.window = { AudioContext: harness.Context };
  const audio = createAudio();
  try {
    assert.equal(audio.chime({ strength: .7 }), false);
    assert.equal(harness.contexts.length, 0);
    await audio.start();
    const context = harness.contexts[0];
    audio.setAmbientVolume(.23); audio.setMusicVolume(0);
    const ambientBus = context.nodes.find(node => node.kind === 'gain'
      && node.gain.scheduled.some(([value]) => value === .23));
    assert.ok(ambientBus);
    const before = context.nodes.length;
    assert.equal(audio.chime({ strength: .7, distance: 12, variant: 2, pan: .6 }), true);
    const voice = context.nodes.slice(before), tones = voice.filter(node => node.kind === 'oscillator');
    assert.equal(tones.length, 4);
    for (const tone of tones) {
      assert.ok(tone.frequency.value > 400 && tone.frequency.value < 8000);
      assert.ok(tone.stops[0] > tone.starts[0] && tone.stops[0] < tone.starts[0] + 6);
    }
    assert.equal(voice.find(node => node.kind === 'panner').pan.scheduled[0][0], .6);
    assert.ok(voice.find(node => node.kind === 'panner').links.includes(ambientBus),
      '铃声必须由环境音滑块控制，音乐音量为零也仍可听到');
    audio.setEnabled(false);
    const disabledCount = context.nodes.length;
    assert.equal(audio.chime({ strength: 1 }), false);
    assert.equal(context.nodes.length, disabledCount);
    tones.forEach(tone => tone.onended());
    assert.ok(voice.every(node => node.disconnected), '鸣响结束后音源、音量包络与声像节点必须全部断开');
    await audio.start();
    for (let i = 0; i < 100; i++) audio.chime({ strength: 1, variant: i });
    const activeTones = context.nodes.filter(node => node.kind === 'oscillator' && !node.disconnected);
    assert.ok(activeTones.length <= 32, '强风或重复事件不能无限叠加音源');
    audio.dispose();
    assert.equal(context.state, 'closed');
    assert.ok(activeTones.every(node => node.disconnected && node.stops.length >= 2));
  } finally {
    audio.dispose(); globalThis.window = originalWindow;
  }
});
