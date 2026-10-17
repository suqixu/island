import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio.js';

const evening = { hour: 17.8, daylight: .35, sunDirection: { y: .055 }, wind: .3, storm: 0, rain: 0 };
const noon = { ...evening, hour: 12, daylight: 1, sunDirection: { y: .9 } };

function harness(fetcher) {
  const saved = Object.fromEntries(['window', 'document', 'fetch', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
  const contexts = [], listeners = new Map(), timers = new Map(), media = [];
  let nextTimer = 0, wallTime = 0;
  function param(value = 0) {
    return { value, calls: [], setValueAtTime(value, time) { this.value = value; this.calls.push(['set', value, time]); },
      setTargetAtTime(value, time, duration) { this.value = value; this.calls.push(['target', value, time, duration]); },
      linearRampToValueAtTime(value, time) { this.value = value; this.calls.push(['linear', value, time]); },
      exponentialRampToValueAtTime(value, time) { this.value = value; this.calls.push(['exponential', value, time]); },
      cancelScheduledValues(time) { this.calls.push(['cancel', time]); } };
  }
  class Node {
    constructor(kind) { this.kind = kind; this.links = []; this.starts = []; this.stops = []; this.disconnected = false;
      for (const key of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'ratio']) this[key] = param();
    }
    connect(to) { this.links.push(to); }
    disconnect() { this.disconnected = true; }
    start(...args) { this.starts.push(args); }
    stop(...args) { this.stops.push(args); }
  }
  const decoded = { duration: 67, recording: true };
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
    createMediaElementSource(element) { const value = this.node('media'); value.element = element; return value; }
    addEventListener(type, handler) { (this.handlers ??= new Map()).set(type, handler); }
    removeEventListener(type) { this.handlers?.delete(type); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    async decodeAudioData(data) { assert.ok(data instanceof ArrayBuffer); return decoded; }
    async resume() { if (this.state === 'closed') throw new Error('closed'); this.state = 'running'; }
    async suspend() { if (this.state === 'closed') throw new Error('closed'); this.state = 'suspended'; }
    close() { this.state = 'closed'; }
  }
  const page = { hidden: false,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
  class Media {
    constructor() { this.paused = true; this.currentTime = 0; this.handlers = new Map(); media.push(this); }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    load() {}
    removeAttribute() { this.src = ''; }
  }
  globalThis.window = { AudioContext: Context, Audio: Media }; globalThis.document = page;
  globalThis.fetch = fetcher;
  globalThis.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay, due: wallTime + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  return { contexts, decoded, page, timers, media,
    async advance(milliseconds) {
      const target = wallTime + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        wallTime = next[1].due; timers.delete(next[0]); next[1].fn(); await settle();
      }
      wallTime = target; await settle();
    },
    hide(value) { page.hidden = value; for (const fn of listeners.get('visibilitychange') ?? []) fn(); },
    listenerCount() { return listeners.get('visibilitychange')?.size ?? 0; },
    restore() { for (const [key, value] of Object.entries(saved)) globalThis[key] = value; } };
}
const response = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(32) });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const recordings = context => context.nodes.filter(node => node.buffer?.recording);

// Removing the user-gesture gate or changing the afternoon branch would fail:
// sunrise has the same solar height, but must keep the normal background music.
test('日落录音只在用户开启后加载，午后低太阳才播放，晨光不会触发', async () => {
  const requested = [], states = [];
  const h = harness(async (...args) => { requested.push(args); return response(); });
  const audio = createAudio({ sunsetMusicUrl: '/audio/weather.mp3', onSunsetMusicStatus: status => states.push(status) });
  try {
    audio.update(1, evening);
    assert.equal(requested.length, 0); assert.equal(h.contexts.length, 0);
    await audio.start(); await settle();
    assert.equal(requested.length, 1, '用户开启后应请求真实录音');
    const ctx = h.contexts[0];
    audio.update(1, noon); audio.update(2, { ...evening, hour: 6.2 });
    assert.equal(recordings(ctx).length, 0, '白天和日出不能切换夕阳音乐');
    audio.update(3, evening);
    assert.equal(recordings(ctx).length, 1);
    assert.equal(recordings(ctx)[0].loop, true);
    for (let i = 0; i < 100; i++) audio.update(3 + i / 60, evening);
    assert.equal(recordings(ctx).length, 1, '连续帧不能重复建立录音音源');
    assert.ok(states.some(state => state.state === 'playing'));
  } finally { audio.dispose(); h.restore(); }
});

// Failing the fetch/decode or using the ambient bus would otherwise mute the
// fallback, or make the music volume unable to silence the sunset recording.
test('音源未就绪或请求失败保留原音乐，录音与旧背景音乐共享音乐音量', async () => {
  let resolveFetch;
  const states = [], h = harness(() => new Promise(resolve => { resolveFetch = resolve; }));
  const audio = createAudio({ sunsetMusicUrl: '/audio/weather.mp3', onSunsetMusicStatus: value => states.push(value) });
  try {
    await audio.start();
    const ctx = h.contexts[0];
    audio.update(0, evening);
    assert.equal(recordings(ctx).length, 0);
    const synth = ctx.nodes.find(node => node.kind === 'oscillator')?.links[0]?.links[0]?.links[0];
    assert.ok(synth && synth.gain.value === 1, '未就绪时合成音乐不能被静音');
    resolveFetch({ ok: false, status: 404 }); await settle();
    audio.update(4, evening);
    assert.equal(recordings(ctx).length, 0); assert.equal(synth.gain.value, 1);
    assert.ok(states.some(state => state.state === 'error'));
    globalThis.fetch = async () => response();
    audio.setSunsetMusicUrl('/audio/replacement.wav'); await settle();
    audio.update(8, evening);
    const recording = recordings(ctx)[0]; assert.ok(recording);
    assert.ok(synth.gain.value < 1, '可播放后才淡出旧音乐');
    const musicBus = recording.links[0].links[0];
    assert.ok(synth.links.includes(musicBus), '录音与合成音乐须汇入同一个音乐总线');
    audio.setMusicVolume(0); assert.equal(musicBus.gain.value, 0);
    audio.setAmbientVolume(.23);
    assert.equal(musicBus.gain.value, 0, '环境音量不应改变夕阳音乐音量');
  } finally { audio.dispose(); h.restore(); }
});

// Missing transport cleanup would overlap two copies after hide/show, jumps,
// or reopening sound; losing the offset would restart the tune every time.
test('隐藏与静音暂停录音并保留进度，时间快速回拨不叠加，退出日落后释放', async () => {
  const h = harness(async () => response()), audio = createAudio({ sunsetMusicUrl: '/audio/weather.mp3' });
  try {
    await audio.start(); await settle();
    const ctx = h.contexts[0]; audio.update(0, evening);
    const first = recordings(ctx)[0];
    ctx.currentTime = 15; h.hide(true);
    assert.ok(first.stops.length > 0 && first.disconnected);
    audio.update(1, evening); assert.equal(recordings(ctx).length, 1);
    h.hide(false); audio.update(2, evening);
    const second = recordings(ctx)[1]; assert.equal(second.starts[0][1], 5);
    audio.update(3, noon); audio.update(3.1, evening);
    assert.equal(recordings(ctx).length, 2, '短暂拖离夕阳后仍应继续同一音源');
    ctx.currentTime = 18; audio.setEnabled(false);
    assert.ok(second.stops.length > 0 && second.disconnected);
    await audio.start(); audio.update(4, evening);
    const third = recordings(ctx)[2]; assert.equal(third.starts[0][1], 8);
    audio.update(5, noon); ctx.currentTime += 4; audio.update(9, noon);
    assert.ok(third.disconnected, '离开日落淡出后要释放循环音源');
    assert.equal(h.listenerCount(), 1);
    audio.dispose(); assert.equal(h.listenerCount(), 0);
    assert.ok(recordings(ctx).every(node => node.disconnected));
    await audio.start(); await settle(); audio.update(10, evening);
    assert.equal(h.contexts.length, 2); assert.equal(recordings(h.contexts[1]).length, 1);
  } finally { audio.dispose(); h.restore(); }
});

// An obsolete request completing after disposal must neither start a source
// nor replace the recording chosen by a newer URL.
test('销毁和更换音源会作废旧请求，延迟解码不得重启旧录音', async () => {
  const pending = [], requested = [], states = [];
  const h = harness((url, options) => { requested.push([url, options]); return new Promise(resolve => pending.push(resolve)); });
  const audio = createAudio({ sunsetMusicUrl: '/audio/old.mp3', onSunsetMusicStatus: value => states.push(value) });
  try {
    await audio.start(); const ctx = h.contexts[0]; audio.update(0, evening);
    audio.setSunsetMusicUrl('/audio/new.mp3');
    assert.equal(requested.length, 2); assert.equal(requested[0][1].signal.aborted, true);
    pending[0](response()); await settle(); audio.update(1, evening);
    assert.equal(recordings(ctx).length, 0);
    pending[1](response()); await settle(); audio.update(2, evening);
    assert.equal(recordings(ctx).length, 1);
    audio.setSunsetMusicUrl('/audio/later.mp3'); audio.dispose();
    assert.equal(requested[2][1].signal.aborted, true);
    pending[2](response()); await settle();
    assert.ok(recordings(ctx).every(node => node.disconnected));
    assert.equal(states.at(-1).state, 'idle');
  } finally { audio.dispose(); h.restore(); }
});

// Without the breaking/foam layer, the three old noise loops are only surf,
// wind and rain; music must never control these shoreline sound layers.
test('拍岸与退潮浪花使用独立复用噪声层，环境音量控制全部海浪并可重开', async () => {
  const h = harness(async () => response()), audio = createAudio();
  try {
    await audio.start(); const ctx = h.contexts[0];
    const loops = ctx.nodes.filter(node => node.kind === 'buffer' && node.loop);
    assert.ok(loops.length >= 4, '拍岸低声与退潮沙沙应分别存在，另有风和雨');
    const buses = new Set(loops.map(source => source.links[0].links[0].links[0]));
    assert.equal(buses.size, 1);
    const ambient = [...buses][0];
    assert.equal(ambient.gain.value, .3, '环境声总线默认30%，与滑块一致');
    audio.setAmbientVolume(0); audio.setMusicVolume(.8);
    assert.equal(ambient.gain.value, 0);
    audio.setAmbientVolume(.9); assert.equal(ambient.gain.value, .9);
    audio.update(1, { ...noon, swell: .1, wind: 0 });
    const quiet = loops.map(source => source.links[0].links[0].gain.value);
    audio.update(2, { ...noon, swell: .9, wind: 1 });
    const rough = loops.map(source => source.links[0].links[0].gain.value);
    assert.ok(rough.filter((value, index) => value > quiet[index] + .025).length >= 3,
      '风变强时拍岸、退水浪花和风声应各自加强');
    audio.dispose(); assert.ok(loops.every(source => source.stops.length > 0));
    await audio.start(); assert.equal(h.contexts.length, 2);
    assert.ok(h.contexts[1].nodes.filter(node => node.kind === 'buffer' && node.loop).length >= 4);
  } finally { audio.dispose(); h.restore(); }
});

test('未提供音源不请求网络，坏录音解码失败后继续原背景音乐', async () => {
  let requests = 0, resolveFetch;
  const states = [], h = harness(() => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); });
  const audio = createAudio({ onSunsetMusicStatus: status => states.push(status) });
  try {
    await audio.start(); const ctx = h.contexts[0];
    audio.update(0, evening); assert.equal(requests, 0); assert.equal(recordings(ctx).length, 0);
    assert.ok(states.some(value => value.state === 'missing'));
    ctx.decodeAudioData = async () => { throw new Error('unsupported recording'); };
    audio.setSunsetMusicUrl('/audio/broken.mp3'); resolveFetch(response()); await settle();
    audio.update(4, evening); assert.equal(recordings(ctx).length, 0);
    assert.equal(states.at(-1).state, 'error');
    assert.ok(ctx.nodes.filter(node => node.kind === 'oscillator').length > 0, '加载失败仍应保留可听的原背景音乐');
  } finally { audio.dispose(); h.restore(); }
});

test('浏览器无法启动录音时仅报告一次错误，不逐帧建立失败音源', async () => {
  const states = [], h = harness(async () => response());
  const audio = createAudio({ sunsetMusicUrl: '/audio/weather.mp3', onSunsetMusicStatus: status => states.push(status) });
  try {
    await audio.start(); await settle(); const ctx = h.contexts[0];
    const createBufferSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = createBufferSource(); source.start = () => { throw new Error('source refused'); }; return source;
    };
    for (let i = 0; i < 100; i++) audio.update(i / 60, evening);
    assert.equal(recordings(ctx).length, 1, '失败后必须停下录音切换，而不是每帧继续尝试');
    assert.ok(recordings(ctx)[0].disconnected);
    assert.equal(states.filter(status => status.state === 'error').length, 1);
  } finally { audio.dispose(); h.restore(); }
});

// A zero master gain alone leaves every loop running. Suspending after the
// audible fade saves their processing without rebuilding them on re-enable.
test('手动静音在淡出后暂停音频计算，快速开启取消等待且复用原音源', async () => {
  const h = harness(async () => response()), audio = createAudio();
  try {
    await audio.start(); const ctx = h.contexts[0];
    const initialSources = ctx.nodes.filter(node => node.kind === 'buffer' && node.loop);
    audio.setEnabled(false); await h.advance(899);
    assert.equal(ctx.state, 'running', '手动静音应先完成淡出');
    await h.advance(1); assert.equal(ctx.state, 'suspended', '淡出后必须暂停海浪等持续音频计算');
    audio.setEnabled(true); await settle(); assert.equal(ctx.state, 'running');
    assert.ok(initialSources.every(source => source.starts.length === 1 && source.stops.length === 0));
    audio.setEnabled(false); await h.advance(200); audio.setEnabled(true); await settle();
    await h.advance(1000); assert.equal(ctx.state, 'running', '旧静音计时器不能暂停重新开启的声音');
    assert.equal(h.contexts.length, 1);
  } finally { audio.dispose(); h.restore(); }
});

test('隐藏页面快速淡出并暂停，页面恢复只恢复用户仍开启的声音', async () => {
  const h = harness(async () => response()), audio = createAudio();
  try {
    await audio.start(); const ctx = h.contexts[0];
    h.hide(true); await h.advance(99); assert.equal(ctx.state, 'running');
    await h.advance(1); assert.equal(ctx.state, 'suspended');
    h.hide(false); await settle(); assert.equal(ctx.state, 'running');
    audio.setEnabled(false); h.hide(true); await h.advance(100);
    assert.equal(ctx.state, 'suspended');
    h.hide(false); await settle(); await h.advance(1000);
    assert.equal(ctx.state, 'suspended', '页面显示不能撤销用户的静音选择');
  } finally { audio.dispose(); h.restore(); }
});

test('已开始的异步暂停晚于开启完成时，最终恢复声音且销毁后不影响新上下文', async () => {
  const h = harness(async () => response()), audio = createAudio();
  try {
    await audio.start(); const old = h.contexts[0];
    let finishSuspend;
    old.suspend = () => new Promise(resolve => { finishSuspend = () => { if (old.state !== 'closed') old.state = 'suspended'; resolve(); }; });
    audio.setEnabled(false); await h.advance(900);
    assert.equal(typeof finishSuspend, 'function');
    audio.setEnabled(true); await settle();
    finishSuspend(); await settle(); assert.equal(old.state, 'running', '晚完成的暂停不能覆盖最新的开启请求');
    audio.setEnabled(false); await h.advance(900); const oldFinish = finishSuspend;
    audio.dispose(); await audio.start(); const fresh = h.contexts[1];
    oldFinish(); await settle(); await h.advance(1000);
    assert.equal(old.state, 'closed'); assert.equal(fresh.state, 'running');
  } finally { audio.dispose(); h.restore(); }
});

test('延迟恢复期间再次静音时最终保持暂停，旧恢复完成不得重新开启声音', async () => {
  const h = harness(async () => response()), audio = createAudio();
  try {
    await audio.start(); const ctx = h.contexts[0];
    audio.setEnabled(false); await h.advance(900); assert.equal(ctx.state, 'suspended');
    let finishResume;
    ctx.resume = () => new Promise(resolve => { finishResume = () => { if (ctx.state !== 'closed') ctx.state = 'running'; resolve(); }; });
    audio.setEnabled(true); await settle(); assert.equal(typeof finishResume, 'function');
    audio.setEnabled(false); await h.advance(900);
    finishResume(); await settle(); assert.equal(ctx.state, 'suspended');
    assert.equal(audio.chime({ strength: 1 }), false, '迟到的恢复不能撤销用户再次静音');
    audio.setEnabled(true); await settle(); const obsoleteResume = finishResume;
    audio.dispose(); await audio.start(); const fresh = h.contexts[1];
    obsoleteResume(); await settle(); assert.equal(ctx.state, 'closed'); assert.equal(fresh.state, 'running');
  } finally { audio.dispose(); h.restore(); }
});

test('实际声场把日落曲接入同一流式播放器，不预加载第二条录音或叠加合成旋律', async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return response(); });
  const statuses = [], audio = createAudio({ sunsetMusicUrl: '/weather.mp3',
    backgroundTracks: { caiyun: { url: '/caiyun.mp3', title: '彩云追月' } },
    onSunsetMusicStatus: value => statuses.push(value) });
  try {
    await audio.start(); audio.update(0, { ...evening, daylight: .2 }); await settle();
    const ctx = h.contexts[0];
    assert.equal(requests, 0, '不再解码另一路日落录音');
    assert.equal(h.media.find(element => !element.paused)?.src, '/weather.mp3');
    assert.equal(ctx.nodes.filter(node => node.kind === 'oscillator').length, 0);
    assert.equal(recordings(ctx).length, 0);
    assert.ok(statuses.some(status => status.state === 'playing'));
  } finally { audio.dispose(); h.restore(); }
});

test('手机音频上下文被系统中断后恢复原曲，保留播放进度', async () => {
  const h = harness(async () => response()), audio = createAudio({
    backgroundTracks: { caiyun: { url: '/caiyun.mp3', title: '彩云追月' } } });
  try {
    await audio.start(); audio.update(0, noon); await settle();
    const ctx = h.contexts[0], current = h.media.find(element => !element.paused);
    current.currentTime = 38; ctx.state = 'interrupted';
    assert.equal(typeof ctx.handlers?.get('statechange'), 'function');
    ctx.handlers.get('statechange')(); await settle();
    assert.equal(ctx.state, 'running');
    assert.equal(current.src, '/caiyun.mp3'); assert.equal(current.currentTime, 38);
    assert.equal(h.media.filter(element => !element.paused).length, 1);
  } finally { audio.dispose(); h.restore(); }
});
