import { getSunsetMusicMix } from './sunset-music.js';
import musicConfig from './config/music.json' with { type: 'json' };

const sunsetPlaylist = musicConfig.playlists.sunset;

export function getScenicMusicSelection(env = {}) {
  if (getSunsetMusicMix(env) > sunsetPlaylist.mixThreshold) return { key: sunsetPlaylist.key, hold: true };
  const { key, label, excludeTrackIds } = musicConfig.playlists.scenic;
  return { key, label, tracks: musicConfig.tracks.filter(track => !excludeTrackIds.includes(track.id)).map(track => track.id) };
}

/** 复用两个流式媒体节点；准备下一首时保留旧曲，新曲在旧曲淡到零后才淡入。
 * 普通曲从完整曲库随机轮换；日落用同一播放器，避免独立音乐总线叠曲。 */
export function createScenicMusic(context, destination, {
  tracks = {}, onStatus, mediaFactory = () => new window.Audio(), clock = () => performance.now() / 1000, random = Math.random,
} = {}) {
  tracks = Object.fromEntries(Object.entries(tracks).map(([id, track]) => [id, { ...track }]));
  const playback = musicConfig.playback;
  const slots = [], offsets = new Map(), failed = new Set();
  let available = false, disposed = false, revision = 0, active, pending, selection;
  let candidate, candidateAt = 0, startedAt = -Infinity, outgoing, fadeEnd = 0;
  let lastStatus = '';
  let queuedNextId, sunsetSkipped = false;
  const playlistIds = () => musicConfig.tracks.map(track => track.id).filter(id => tracks[id]?.url);
  let permitted = false, musicPaused = playback.paused, mode = playback.defaultMode, playbackRate = playback.rate, requestedTrack, lastEnvironment = {};
  const modeLabels = Object.fromEntries(playback.modes.map(({ id, label }) => [id, label]));
  const hasRecordings = Object.values(tracks).some(track => track?.url);
  const eligible = desired => (desired?.tracks ?? []).filter(id => tracks[id]?.url && !failed.has(id));
  const loops = () => mode === 'single';
  function scenicSelection(env) {
    const next = getScenicMusicSelection(env);
    if (!next.hold) sunsetSkipped = false;
    return next.hold && sunsetSkipped ? getScenicMusicSelection({ ...env, hour: 11 }) : next;
  }
  function chooseTrack(desired, previous) {
    const options = eligible(desired);
    const alternatives = options.filter(id => id !== previous);
    const choices = alternatives.length ? alternatives : options;
    if ((mode === 'scenic' || mode === 'random') && choices.length > 1 && desired?.key !== sunsetPlaylist.key) {
      return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
    }
    return choices[0];
  }
  function report(state, slot = active) {
    const status = { state, id: slot?.id, title: tracks[slot?.id]?.title, label: slot?.label ?? selection?.label };
    const key = JSON.stringify(status);
    if (key !== lastStatus) { lastStatus = key; onStatus?.(status); }
  }
  function initialize() {
    if (slots.length) return;
    for (let i = 0; i < 2; i++) {
      const element = mediaFactory(); element.preload = 'none'; element.loop = false;
      element.setAttribute?.('playsinline', '');
      const source = context.createMediaElementSource(element), gain = context.createGain();
      gain.gain.value = 0; source.connect(gain); gain.connect(destination);
      const slot = { element, source, gain, id: null, playing: false, handlers: {} };
      slot.handlers.ended = () => {
        if (slot !== active || !available || disposed) return;
        slot.finished = true; slot.playing = false; slot.element.pause(); offsets.set(slot.id, 0);
        if (pending) return;
        const options = eligible(selection), at = slot.selectionKey === selection?.key ? options.indexOf(slot.id) : -1;
        const next = mode === 'scenic' || mode === 'random'
          ? chooseTrack(selection, slot.id)
          : mode === 'single' ? slot.id : options[(at + 1) % options.length];
        if (next) switchTrack(next, true);
      };
      slot.handlers.error = () => fail(slot);
      slot.handlers.pause = () => {
        if (slot !== active || !available || disposed || slot.finished || outgoing === slot) return;
        slot.playing = false; slot.interrupted = true; report('paused', slot);
      };
      slot.handlers.waiting = slot.handlers.stalled = () => {
        if (available && slot === active) report('buffering', slot);
      };
      slot.handlers.playing = () => {
        if (available && slot === active) { slot.playing = true; slot.interrupted = false; report('playing', slot); }
      };
      for (const [type, handler] of Object.entries(slot.handlers)) element.addEventListener(type, handler);
      slots.push(slot);
    }
  }
  function retire(slot) {
    if (!slot) return;
    if (slot.seek) slot.element.removeEventListener('loadedmetadata', slot.seek);
    slot.seek = undefined;
    if (slot.id) offsets.set(slot.id, !slot.finished && Number.isFinite(slot.element.currentTime) ? slot.element.currentTime : 0);
    slot.playing = false; slot.interrupted = false; slot.element.loop = false;
    slot.gain.gain.cancelScheduledValues(context.currentTime);
    slot.gain.gain.setValueAtTime(0, context.currentTime);
    slot.element.pause(); slot.element.removeAttribute('src'); slot.element.load(); slot.id = null;
  }
  function fail(slot, error) {
    if (disposed || (slot !== active && slot !== pending)) return;
    if (error?.name === 'AbortError' && !available) return;
    if (error?.name !== 'NotAllowedError') failed.add(slot.id);
    if (slot === pending) {
      pending = undefined; retire(slot);
      report(active?.playing ? 'playing' : 'error', active ?? slot);
    } else {
      slot.playing = false; slot.interrupted = false; slot.element.pause(); report('error', slot);
    }
  }
  function play(slot, token, after) {
    slot.playToken = token;
    Promise.resolve().then(() => {
      if (!available || disposed || token !== revision) return;
      return slot.element.play();
    }).then(() => {
      if (!available || disposed || token !== revision) {
        if (slot.playToken === token && (!available || disposed || (slot !== active && slot !== outgoing))) slot.element.pause();
        return;
      }
      slot.playing = true; slot.interrupted = false; after(); report('playing', slot);
    }).catch(error => { if (!disposed && token === revision) fail(slot, error); });
  }
  function switchTrack(id, restart = false) {
    if (!tracks[id]?.url || !available || disposed || pending) return;
    initialize();
    if (outgoing) { retire(outgoing); outgoing = undefined; }
    const previous = active, slot = slots.find(value => value !== previous), token = ++revision;
    slot.id = id; slot.label = selection?.label; slot.selectionKey = selection?.key; slot.playing = false; slot.finished = false;
    slot.element.loop = loops(); slot.element.playbackRate = playbackRate;
    slot.element.preservesPitch = true;
    slot.element.src = tracks[id].url;
    slot.gain.gain.cancelScheduledValues(context.currentTime); slot.gain.gain.setValueAtTime(0, context.currentTime);
    slot.element.load();
    // Safari 在元数据尚未到达时可能拒绝跳转，等元数据到达再恢复进度。
    const offset = restart ? 0 : offsets.get(id) ?? 0;
    const seek = () => { try { slot.element.currentTime = offset; } catch {} };
    slot.seek = seek; slot.element.addEventListener('loadedmetadata', seek); seek();
    pending = slot; report('loading', slot);
    play(slot, token, () => {
      slot.element.removeEventListener('loadedmetadata', slot.seek); slot.seek = undefined;
      pending = undefined; active = slot;
      const now = context.currentTime;
      const finish = previous?.playing && !previous.element.paused ? now + playback.transitionSeconds : now;
      slot.gain.gain.cancelScheduledValues(now); slot.gain.gain.setValueAtTime(0, now);
      // 两条音量包络不相交；即使渲染线程暂时忙碌，也由音频时钟完成交接。
      slot.gain.gain.setValueAtTime(0, finish); slot.gain.gain.linearRampToValueAtTime(1, finish + playback.transitionSeconds);
      startedAt = clock();
      if (previous) {
        if (finish > now) {
          previous.gain.gain.cancelScheduledValues(now);
          previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
          previous.gain.gain.linearRampToValueAtTime(0, finish);
          outgoing = previous; fadeEnd = finish;
        } else retire(previous);
      }
    });
  }
  function resume() {
    if (!active || pending || queuedNextId || failed.has(active.id) || (requestedTrack && requestedTrack !== active.id)) return;
    const slot = active, token = ++revision;
    slot.interrupted = false;
    play(slot, token, () => {
      const now = context.currentTime;
      const start = outgoing ? Math.max(now, fadeEnd) : now;
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(0, now);
      slot.gain.gain.setValueAtTime(0, start);
      slot.gain.gain.linearRampToValueAtTime(1, start + playback.resumeFadeSeconds);
    });
  }
  function applyAvailable(value) {
    const next = Boolean(value) && !disposed;
    if (next === available) { if (next && active?.element.paused) resume(); return; }
    available = next; revision++; candidate = undefined;
    if (!available) {
      if (active || pending) report('paused', active ?? pending);
      for (const slot of slots) { slot.playing = false; slot.element.pause(); }
      if (pending) {
        if (mode !== 'scenic' && !requestedTrack) requestedTrack = pending.id;
        const cancelled = pending; pending = undefined; retire(cancelled);
      }
      if (outgoing) { retire(outgoing); outgoing = undefined; }
    } else resume();
  }
  function setAvailable(value) {
    permitted = Boolean(value);
    applyAvailable(permitted && !musicPaused);
  }
  function setPlaybackOptions(options = {}) {
    if (disposed) return;
    const changedMode = Object.hasOwn(modeLabels, options.mode) && options.mode !== mode;
    if (changedMode || options.trackId) queuedNextId = undefined;
    if (changedMode) { mode = options.mode; candidate = undefined; }
    if (Number.isFinite(options.rate)) playbackRate = Math.min(playback.rateLimits.max, Math.max(playback.rateLimits.min, options.rate));
    if (options.trackId && tracks[options.trackId]?.url) {
      requestedTrack = options.trackId;
      failed.delete(options.trackId);
      if (mode === 'scenic') mode = 'sequence';
    }
    if (mode === 'scenic') requestedTrack = undefined;
    if (changedMode || (pending && requestedTrack && pending.id !== requestedTrack)) {
      if (pending) { revision++; const old = pending; pending = undefined; retire(old); }
    }
    for (const slot of slots) {
      slot.element.playbackRate = playbackRate;
      slot.element.loop = loops();
    }
    if (typeof options.paused === 'boolean') musicPaused = options.paused;
    applyAvailable(permitted && !musicPaused);
    update(lastEnvironment);
  }
  function cancelPending() {
    if (!pending) return;
    revision++; const old = pending; pending = undefined; retire(old);
  }
  function nextTrack() {
    if (disposed) return;
    const previous = queuedNextId ?? pending?.id ?? active?.id;
    requestedTrack = undefined;
    if (mode === 'scenic' && getSunsetMusicMix(lastEnvironment) > sunsetPlaylist.mixThreshold) sunsetSkipped = true;
    cancelPending();
    const next = scenicSelection(lastEnvironment);
    selection = mode === 'scenic' ? next : { key: mode, label: modeLabels[mode], tracks: playlistIds() };
    const options = eligible(selection);
    const alternatives = options.filter(id => id !== previous && id !== active?.id);
    const desired = alternatives.length ? { ...selection, tracks: alternatives } : selection;
    const id = mode === 'sequence' || mode === 'single'
      ? options[(options.indexOf(previous) + 1) % options.length] : chooseTrack(desired, previous);
    if (!id) return;
    queuedNextId = id; candidate = undefined;
    if (available) update(lastEnvironment);
    else report('paused', { id, label: selection.label });
  }
  function update(env) {
    lastEnvironment = env;
    if (!available || disposed) return;
    if (outgoing && context.currentTime >= fadeEnd) { const old = outgoing; outgoing = undefined; retire(old); }
    if (active?.interrupted && !pending) resume();
    if (queuedNextId) {
      const id = queuedNextId; queuedNextId = undefined;
      cancelPending(); switchTrack(id, true); return;
    }
    if (mode !== 'scenic') {
      selection = {key:mode, label:modeLabels[mode], tracks:playlistIds()};
      candidate = undefined;
      if (requestedTrack) {
        const id = requestedTrack; requestedTrack = undefined;
        if (active?.id !== id) switchTrack(id, true);
        else if (active.element.paused) resume();
      }
      if ((!active || failed.has(active.id)) && !pending) {
        const id = chooseTrack(selection, active?.id); if (id) switchTrack(id, true);
      } else if (active) {
        active.label = selection.label; active.selectionKey = selection.key;
        if (active.playing && !pending) report('playing', active);
      }
      return;
    }
    const next = scenicSelection(env);
    if (next.hold && !tracks[sunsetPlaylist.trackId]?.url && active) { candidate = undefined; return; }
    const desired = next.hold ? tracks[sunsetPlaylist.trackId]?.url
      ? { key: sunsetPlaylist.key, label: sunsetPlaylist.label, tracks: [sunsetPlaylist.trackId] }
      : getScenicMusicSelection({ ...env, hour: 11, daylight: 1 }) : next;
    if (!active || (!active.playing && failed.has(active.id))) {
      if (pending) return;
      selection = desired;
      const id = chooseTrack(desired, active?.id); if (id) switchTrack(id);
      return;
    }
    if (selection?.key === desired.key) { candidate = undefined; return; }
    const now = clock();
    if (candidate?.key !== desired.key) { candidate = desired; candidateAt = now; return; }
    if (now - candidateAt < playback.sceneHoldSeconds || pending || outgoing) return;
    const sunsetTransition = desired.key === sunsetPlaylist.key || active.id === sunsetPlaylist.trackId;
    if (sunsetTransition && (now - startedAt < playback.minSunsetTrackSeconds || !active.playing)) return;
    selection = desired; candidate = undefined;
    // 普通曲完整播放后随机换歌；落日进入或结束时才交接主题。
    if (sunsetTransition) {
      const id = chooseTrack(desired, active.id); if (id && id !== active.id) switchTrack(id);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; available = false; revision++;
    for (const slot of slots) {
      for (const [type, handler] of Object.entries(slot.handlers)) slot.element.removeEventListener(type, handler);
      if (slot.seek) slot.element.removeEventListener('loadedmetadata', slot.seek);
      retire(slot); slot.source.disconnect(); slot.gain.disconnect();
    }
    slots.length = 0; active = outgoing = pending = undefined; offsets.clear(); failed.clear();
  }
  function setTrackUrl(id, url) {
    if (disposed || !tracks[id] || tracks[id]?.url === url) return;
    tracks[id] = { ...tracks[id], url }; failed.delete(id);
    if (pending?.id === id) { revision++; const slot = pending; pending = undefined; retire(slot); }
    if (outgoing?.id === id) { const slot = outgoing; outgoing = undefined; retire(slot); }
    if (active?.id === id) { revision++; const slot = active; active = undefined; retire(slot); }
    offsets.delete(id);
  }
  // 有器乐主题时只播放这一条音乐链路，等待网络也不临时叠加振荡器旋律。
  return { setAvailable, setPlaybackOptions, nextTrack, update, dispose, setTrackUrl, shouldSynthesize: () => !hasRecordings };
}
