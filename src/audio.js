import { createSunsetMusic } from './sunset-music.js';
import { createScenicMusic } from './scenic-music.js';
import { getAnimationRate } from './animation-time.js';

const WILDLIFE_SOUNDS = {
  'whale-blow': { duration: 1.8, frequency: 1000, volume: .24, attack: .16 },
  splash: { duration: .8, frequency: 2800, volume: .15, attack: .025 },
  'flying-fish': { duration: .28, frequency: 4200, volume: .075, attack: .018 },
  dolphin: { duration: .48, frequency: 1600, volume: .055, attack: .04, tonal: true },
};

export function getWildlifeSoundProfile(event = {}) {
  if (!Object.hasOwn(WILDLIFE_SOUNDS, event.type)) return null;
  const preset = WILDLIFE_SOUNDS[event.type];
  const distance = Number.isFinite(event.distance) ? Math.max(0, event.distance) : 60;
  const strength = Number.isFinite(event.strength) ? Math.max(0, Math.min(1, event.strength)) : 1;
  // Visible offshore events can be almost a kilometre away; retain a faint
  // sound for the full scene range while leaving more distant events silent.
  if (distance > 1100 || strength === 0) return null;
  return { ...preset, volume: preset.volume * strength / (1 + (distance / 70) ** 2),
    pan: Number.isFinite(event.pan) ? Math.max(-1, Math.min(1, event.pan)) : 0 };
}

const CHIME_PITCHES = [659.25, 783.99, 880, 1046.5, 1174.66];
export function getChimeSoundProfile(event = {}) {
  const distance = Number.isFinite(event.distance) ? Math.max(0, event.distance) : 30;
  const strength = Number.isFinite(event.strength) ? Math.max(0, Math.min(1, event.strength)) : .6;
  if (distance > 220 || strength === 0) return null;
  const variant = Number.isFinite(event.variant) ? Math.trunc(event.variant) : 0;
  const index = ((variant % CHIME_PITCHES.length) + CHIME_PITCHES.length) % CHIME_PITCHES.length;
  return { frequency: CHIME_PITCHES[index], duration: 2.8 + strength * 1.2,
    volume: .082 * Math.sqrt(strength) / (1 + (distance / 45) ** 2),
    pan: Number.isFinite(event.pan) ? Math.max(-1, Math.min(1, event.pan)) : 0 };
}

// 环境声本地合成；场景音乐仅在点击开启后加载。
export function createAudio({ sunsetMusicUrl, lighthouseMusicUrl, dockMusicUrl, caveMusicUrl, caveChantMusicUrl, caveDreamMusicUrl, caveBoruMusicUrl, lighthouseLubinghuaUrl, lighthouseHualianUrl, lighthouseTuogaoUrl, southPavilionMusicUrl, eastPavilionMusicUrl, islandSongMusicUrl, onSunsetMusicStatus, backgroundTracks, onBackgroundMusicStatus } = {}) {
  let context, master, music, synthMusic, ambient, reverb, chimeReverb, sunsetMusic, scenicMusic, enabled = false, initialized = false;
  let musicVolume = .8, ambientVolume = .3, lastNote = -10, lastBird = -20;
  let musicPlayback = { mode: 'scenic', rate: 1, paused: false };
  let waveGain, foamGain, foamFilter, windGain, rainGain, windFilter, rainFilter;
  let waveBuffer, noiseBuffer;
  let lifecycle = 0, listeningForVisibility = false, playbackRevision = 0, suspendTimer;
  let transportQueue = Promise.resolve();
  let fastMode = false, lastFastEffect = -Infinity;
  onSunsetMusicStatus?.({ state: sunsetMusicUrl ? 'idle' : 'missing', url: sunsetMusicUrl ?? '' });
  const sources = [];
  const effects = new Set();
  const chimeVoices = new Set();
  const notes = [130.81, 196, 261.63, 329.63, 392, 440, 523.25, 659.25];
  function gain(value, destination) {
    const node = context.createGain(); node.gain.value = value; node.connect(destination); return node;
  }
  function noise(seconds, brown = false) {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0); let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const random = Math.random() * 2 - 1;
      previous = brown ? (previous + .02 * random) / 1.02 : random;
      data[i] = brown ? previous * 3.5 : random;
    }
    return buffer;
  }
  function noiseLoop(buffer, frequency, volume, type = 'lowpass') {
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = .3;
    const node = gain(volume, ambient); source.connect(filter); filter.connect(node); source.start(); sources.push(source);
    return { node, filter };
  }
  function softNote(frequency, duration, volume) {
    const start = context.currentTime;
    const note = gain(0, synthMusic); note.connect(reverb);
    note.gain.setValueAtTime(0, start);
    note.gain.linearRampToValueAtTime(volume, start + .6);
    note.gain.exponentialRampToValueAtTime(.0001, start + duration);
    for (const [ratio, level] of [[1,1],[2,.16],[3,.025]]) {
      const osc = context.createOscillator(); osc.type = 'sine'; osc.frequency.value = frequency * ratio;
      const partial = gain(level, note); osc.connect(partial); osc.start(start); osc.stop(start + duration + .1);
      osc.onended = () => { osc.disconnect(); partial.disconnect(); };
    }
    setTimeout(() => note.disconnect(), (duration + 1) * 1000);
  }
  function bird() {
    const start = context.currentTime;
    const panner = context.createStereoPanner?.();
    if (panner) { panner.pan.value = (Math.random() - .5) * 1.3; panner.connect(ambient); }
    const chirpGain = gain(0, panner ?? ambient);
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 3300; filter.connect(chirpGain);
    const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.connect(filter);
    const pitch = 1050 + Math.random() * 500;
    oscillator.frequency.setValueAtTime(pitch, start);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * 1.45, start + .16);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * .74, start + .43);
    chirpGain.gain.setValueAtTime(.0001, start);
    chirpGain.gain.exponentialRampToValueAtTime(.022, start + .06);
    chirpGain.gain.exponentialRampToValueAtTime(.0001, start + .5);
    oscillator.start(start); oscillator.stop(start + .6);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); chirpGain.disconnect(); panner?.disconnect(); };
  }
  function wildlife(event) {
    if (!initialized || !enabled || context.state !== 'running' || (typeof document !== 'undefined' && document.hidden)) return false;
    const sound = getWildlifeSoundProfile(event);
    if (!sound) return false;
    if (!allowEffect()) return false;
    const start = context.currentTime;
    const panner = context.createStereoPanner?.();
    if (panner) { panner.pan.setValueAtTime(sound.pan, start); panner.connect(ambient); }
    const envelope = gain(.0001, panner ?? ambient);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(sound.volume, start + sound.attack);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, sound.volume * .3), start + sound.duration * .52);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + sound.duration);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = .55;
    filter.frequency.setValueAtTime(sound.frequency, start);
    filter.frequency.exponentialRampToValueAtTime(sound.frequency * .32, start + sound.duration);
    filter.connect(envelope);
    const source = context.createBufferSource(); source.buffer = noiseBuffer;
    const noiseLevel = gain(sound.tonal ? .16 : 1, filter); source.connect(noiseLevel);
    source.start(start); source.stop(start + sound.duration + .03); effects.add(source);
    source.onended = () => {
      source.disconnect(); noiseLevel.disconnect(); filter.disconnect(); envelope.disconnect(); panner?.disconnect(); effects.delete(source);
    };
    if (sound.tonal) {
      const tone = context.createOscillator(); tone.type = 'sine'; tone.connect(envelope);
      tone.frequency.setValueAtTime(900, start);
      tone.frequency.exponentialRampToValueAtTime(1850, start + .13);
      tone.frequency.exponentialRampToValueAtTime(680, start + .4);
      tone.start(start); tone.stop(start + .43); effects.add(tone);
      tone.onended = () => { tone.disconnect(); effects.delete(tone); };
    }
    return true;
  }
  function chime(event) {
    if (!initialized || !enabled || context.state !== 'running'
      || (typeof document !== 'undefined' && document.hidden) || chimeVoices.size >= 8) return false;
    const sound = getChimeSoundProfile(event);
    if (!sound) return false;
    if (!allowEffect()) return false;
    const start = context.currentTime, nodes = [];
    const panner = context.createStereoPanner?.();
    if (panner) { panner.pan.setValueAtTime(sound.pan, start); panner.connect(ambient); nodes.push(panner); }
    const envelope = gain(.0001, panner ?? ambient); nodes.push(envelope);
    if (chimeReverb) envelope.connect(chimeReverb);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(sound.volume, start + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + sound.duration);
    let remaining = 4, cleaned = false;
    const voice = { cleanup() {
      if (cleaned) return;
      cleaned = true;
      for (const node of nodes) { node.disconnect(); effects.delete(node); }
      chimeVoices.delete(voice);
    } };
    chimeVoices.add(voice);
    // A soft fundamental and quickly fading metal modes keep the strike light.
    for (const [ratio, level, decay] of [[1, .72, 1], [2, .16, .72], [2.76, .085, .51], [4.07, .035, .34]]) {
      const oscillator = context.createOscillator(); oscillator.type = 'sine';
      oscillator.frequency.value = sound.frequency * ratio;
      const partial = gain(level, envelope);
      partial.gain.setValueAtTime(level, start);
      partial.gain.exponentialRampToValueAtTime(.0001, start + sound.duration * decay);
      oscillator.connect(partial); nodes.push(oscillator, partial); effects.add(oscillator);
      oscillator.start(start); oscillator.stop(start + sound.duration + .025);
      oscillator.onended = () => { effects.delete(oscillator); if (--remaining === 0) voice.cleanup(); };
    }
    return true;
  }
  function thunder() {
    if (!initialized || !enabled || context.state !== 'running') return;
    if (!allowEffect()) return;
    const start = context.currentTime;
    const source = context.createBufferSource(); source.buffer = waveBuffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 430;
    const node = gain(.0001, ambient); source.connect(filter); filter.connect(node);
    node.gain.exponentialRampToValueAtTime(.62, start + .18);
    node.gain.exponentialRampToValueAtTime(.22, start + 1.1);
    node.gain.exponentialRampToValueAtTime(.0001, start + 6);
    filter.frequency.exponentialRampToValueAtTime(65, start + 6);
    source.start(); source.stop(start + 6.2);
    source.onended = () => { source.disconnect(); filter.disconnect(); node.disconnect(); };
  }
  async function start() {
    if (!initialized) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('当前浏览器不支持音频');
      context = new AudioContext();
      context.addEventListener?.('statechange', audioContextChanged);
      master = gain(0, context.destination);
      const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -15; compressor.ratio.value = 3; compressor.connect(master);
      music = gain(musicVolume, compressor); synthMusic = gain(1, music); ambient = gain(ambientVolume, compressor);
      const impulse = context.createBuffer(2, context.sampleRate * 4, context.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3) * .35;
      }
      reverb = context.createConvolver(); reverb.buffer = impulse; const wet = gain(.45, synthMusic); reverb.connect(wet);
      chimeReverb = context.createConvolver(); chimeReverb.buffer = impulse;
      chimeReverb.connect(gain(.14, ambient));
      noiseBuffer = noise(9); waveBuffer = noise(10, true);
      waveGain = noiseLoop(waveBuffer, 650, .22).node;
      // 拍岸低频之后延迟出现的细碎浪花，复用噪声与滤波节点。
      const foam = noiseLoop(noiseBuffer, 1900, .018); foamGain = foam.node; foamFilter = foam.filter;
      const wind = noiseLoop(noiseBuffer, 390, .015); windGain = wind.node; windFilter = wind.filter;
      const rain = noiseLoop(noiseBuffer, 3500, 0, 'lowpass'); rainGain = rain.node; rainFilter = rain.filter;
      if (backgroundTracks && Object.values(backgroundTracks).some(track=>track?.url)) {
        let sunsetStreaming = false;
        scenicMusic = createScenicMusic(context, synthMusic, {
          tracks: { ...backgroundTracks, sunset: { url: sunsetMusicUrl, title: '渔舟唱晚' },
            lighthouse: { url: lighthouseMusicUrl, title: '月儿明风儿静' },
            islandSong: { url: islandSongMusicUrl, title: '山歌好比春江水' },
            dock: { url: dockMusicUrl, title: '送别' },
            cave: { url: caveMusicUrl, title: '桔梗花' },
            caveChant: { url: caveChantMusicUrl, title: '大悲咒' },
            caveDream: { url: caveDreamMusicUrl, title: '梦中的额吉' },
            caveBoru: { url: caveBoruMusicUrl, title: '波如来' },
            lighthouseLubinghua: { url: lighthouseLubinghuaUrl, title: '鲁冰花' },
            lighthouseHualian: { url: lighthouseHualianUrl, title: '花恋' },
            lighthouseTuogao: { url: lighthouseTuogaoUrl, title: '驼糕之歌' },
            southPavilion: { url: southPavilionMusicUrl, title: '功德宝山咒' },
            eastPavilion: { url: eastPavilionMusicUrl, title: '心经' } },
          onStatus(status) {
            if (status.id === 'sunset') {
              sunsetStreaming = true;
              onSunsetMusicStatus?.({ state: status.state, url: sunsetMusicUrl });
            } else if (sunsetStreaming) {
              sunsetStreaming = false; onSunsetMusicStatus?.({ state: 'ready', url: sunsetMusicUrl });
            }
            onBackgroundMusicStatus?.(status);
          },
        });
        scenicMusic.setPlaybackOptions(musicPlayback);
      } else sunsetMusic = createSunsetMusic(context, music, synthMusic, { url: sunsetMusicUrl, onStatus: onSunsetMusicStatus });
      if (!listeningForVisibility && typeof document !== 'undefined') {
        document.addEventListener?.('visibilitychange', visibilityChanged); listeningForVisibility = true;
      }
      initialized = true;
    }
    enabled = true;
    await requestPlayback(.5);
  }
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  function synchronizePlayback(duration = .3) {
    if (!context) return;
    const active = enabled && !hidden() && context.state === 'running';
    master.gain.setTargetAtTime(active ? .82 : 0, context.currentTime, duration);
    sunsetMusic?.setAvailable(active);
    scenicMusic?.setAvailable(active);
  }
  function cancelPendingSuspension() {
    if (suspendTimer !== undefined) clearTimeout(suspendTimer);
    suspendTimer = undefined;
  }
  function queueContextOperation(operation, revision, duration) {
    const selectedContext = context, token = lifecycle;
    const task = transportQueue.catch(() => {}).then(async () => {
      if (token !== lifecycle || context !== selectedContext || revision !== playbackRevision) return;
      await selectedContext[operation]?.();
      if (token === lifecycle && context === selectedContext && revision === playbackRevision) synchronizePlayback(duration);
    });
    // Serialize an in-flight suspend and a later resume. A late suspend must
    // never win over the user's more recent decision to turn sound back on.
    transportQueue = task.catch(() => {});
    return task;
  }
  function requestPlayback(duration = .3) {
    cancelPendingSuspension();
    const revision = ++playbackRevision;
    if (!context) return Promise.resolve();
    if (enabled && !hidden()) {
      synchronizePlayback(duration);
      return queueContextOperation('resume', revision, duration);
    }
    synchronizePlayback(hidden() ? .02 : duration);
    const delay = hidden() ? 100 : 900;
    const selectedContext = context, token = lifecycle;
    suspendTimer = setTimeout(() => {
      suspendTimer = undefined;
      if (token !== lifecycle || selectedContext !== context || revision !== playbackRevision || (enabled && !hidden())) return;
      queueContextOperation('suspend', revision, duration).catch(() => {});
    }, delay);
    return Promise.resolve();
  }
  function visibilityChanged() { requestPlayback(hidden() ? .02 : .3).catch(() => {}); }
  function audioContextChanged() {
    if (!context || !enabled || hidden()) return;
    if (context.state === 'running') synchronizePlayback(.3);
    else if (context.state === 'interrupted' || context.state === 'suspended') {
      scenicMusic?.setAvailable(false);
      requestPlayback(.3).catch(() => {});
    }
  }
  function setEnabled(value) {
    enabled = Boolean(value);
    requestPlayback().catch(() => {});
  }
  function setSunsetMusicUrl(value) {
    sunsetMusicUrl = typeof value === 'string' ? value.trim() : undefined;
    if (sunsetMusic) sunsetMusic.setUrl(sunsetMusicUrl);
    else if (scenicMusic) scenicMusic.setTrackUrl('sunset', sunsetMusicUrl);
    else onSunsetMusicStatus?.({ state: sunsetMusicUrl ? 'idle' : 'missing', url: sunsetMusicUrl ?? '' });
  }
  function setMusicVolume(value) { musicVolume = value; if (music) music.gain.setTargetAtTime(value, context.currentTime, .15); }
  function setMusicPlayback(options) {
    musicPlayback = { ...musicPlayback, ...options };
    scenicMusic?.setPlaybackOptions(options);
  }
  function setAmbientVolume(value) { ambientVolume = value; if (ambient) ambient.gain.setTargetAtTime(value, context.currentTime, .15); }
  function setAnimationRate(rate) {
    const next = rate === 16;
    if (next !== fastMode) lastFastEffect = -Infinity;
    fastMode = next;
  }
  function allowEffect() {
    if (!fastMode) return true;
    const now = context.currentTime;
    if (now - lastFastEffect < 3) return false;
    lastFastEffect = now; return true;
  }
  function update(time, env) {
    setAnimationRate(getAnimationRate(env));
    if (!initialized || !enabled || context.state !== 'running' || hidden()) return;
    const now = context.currentTime;
    if (fastMode) time = now;
    sunsetMusic?.update(env);
    scenicMusic?.update(env);
    const pulse = Math.pow(.5 + .5 * Math.sin(time * .48 + Math.sin(time * .13) + .3 * Math.sin(time * .037)), 2);
    const backwash = Math.pow(.5 + .5 * Math.sin(time * .48 - .95 + Math.sin(time * .13)), 2);
    const swell = Number.isFinite(env.swell) ? env.swell * (.65 + pulse * .35) : pulse;
    const foam = backwash * (.3 + swell * .7);
    waveGain.gain.setTargetAtTime(.14 + swell * .24 + env.wind * .06 + env.storm * .08, now, .35);
    foamGain.gain.setTargetAtTime(.018 + foam * .13 + env.wind * .05 + env.storm * .04, now, .45);
    foamFilter.frequency.setTargetAtTime(1250 + foam * 1600 + env.wind * 450, now, .5);
    windGain.gain.setTargetAtTime(.015 + env.wind * .095, now, .3);
    windFilter.frequency.setTargetAtTime(250 + env.wind * 650, now, .4);
    rainGain.gain.setTargetAtTime(env.rain * .17, now, .4);
    rainFilter.frequency.setTargetAtTime(2400 + env.rain * 1200, now, .4);
    if (time - lastNote > 3.4 && sunsetMusic?.shouldSynthesize() !== false && scenicMusic?.shouldSynthesize() !== false) {
      lastNote = time;
      const step = Math.floor(time / 3.4);
      const progression = [[0,2,3],[0,4,6],[1,3,5],[0,3,6]];
      const chord = progression[Math.floor(step / 4) % progression.length];
      softNote(notes[chord[step % 3]], 8, .045);
      if (step % 4 === 0) softNote(notes[chord[0]] / 2, 13, .055);
      if (step % 3 === 0) softNote(notes[6 + step % 2], 5, .012);
    }
    if (env.daylight > .3 && env.storm < .2 && time - lastBird > (fastMode ? 35 : 11 + Math.sin(time) * 4)) { bird(); lastBird = time; }
  }
  function dispose() {
    lifecycle++; playbackRevision++; cancelPendingSuspension(); transportQueue = Promise.resolve();
    sunsetMusic?.dispose(); sunsetMusic = undefined;
    scenicMusic?.dispose(); scenicMusic = undefined;
    if (listeningForVisibility) document.removeEventListener?.('visibilitychange', visibilityChanged);
    listeningForVisibility = false;
    for (const source of effects) { try { source.stop(); } catch {} }
    effects.clear();
    for (const voice of [...chimeVoices]) voice.cleanup();
    for (const source of sources) { try { source.stop(); } catch {} }
    sources.length = 0;
    if (context) { context.removeEventListener?.('statechange', audioContextChanged); context.close(); }
    context = undefined; initialized = false; enabled = false; lastNote = -10; lastBird = -20;
    master = music = synthMusic = ambient = reverb = chimeReverb = waveGain = foamGain = foamFilter = windGain = rainGain = windFilter = rainFilter = undefined;
    waveBuffer = noiseBuffer = undefined;
  }
  return { start, setEnabled, setMusicVolume, setMusicPlayback, setAmbientVolume, setSunsetMusicUrl, setAnimationRate, update, thunder, wildlife, chime, dispose };
}
