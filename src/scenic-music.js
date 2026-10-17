import { getSunsetMusicMix } from './sunset-music.js';
import { getAnimationRate } from './animation-time.js';
import { isExclusiveMusicTrack, LIGHTHOUSE_MUSIC_IDS } from './music-scene-effects.js';

export function getScenicMusicSelection(env = {}) {
  if (getSunsetMusicMix(env) > .05) return { key: 'sunset', hold: true };
  const quiet = ['cloudy','rain','fog','storm','snow'].includes(env.weather)
    || (env.fog ?? 0) > .45 || (env.cloudiness ?? 0) > .65;
  if (!quiet && (env.daylight ?? 1) < .2 && (env.moonLight ?? 0) > .12) {
    return { key: 'moon', label: '月夜', tracks: ['chunjiang','caiyun','liangzhu','nuerqing','wangningmei'] };
  }
  if (quiet || env.season === 'autumn' || (env.daylight ?? 1) < .2) {
    return { key: 'quiet', label: '静景', tracks: ['pingsha','mengjiang','liangzhu','wangningmei'] };
  }
  return { key: 'clear', label: '晴日', tracks: ['caiyun','shange','zuguo'] };
}

/** 复用两个流式媒体节点；准备下一首时保留旧曲，新曲在旧曲淡到零后才淡入。
 * 普通天气变化只更新下一首的选择；日落用同一播放器，避免独立音乐总线叠曲。 */
export function createScenicMusic(context, destination, {
  tracks = {}, onStatus, mediaFactory = () => new window.Audio(), clock = () => performance.now() / 1000, random = Math.random,
} = {}) {
  const slots = [], offsets = new Map(), failed = new Set();
  let available = false, disposed = false, revision = 0, active, pending, selection;
  let candidate, candidateAt = 0, startedAt = -Infinity, outgoing, fadeEnd = 0;
  let lastStatus = '';
  let fixedSelection;
  let proximityActive, proximityCandidate, proximityCandidateAt = 0;
  let completedProximity;
  let proximityReturnId, proximityReturnSelection, proximityReturnFixedSelection;
  const playlistIds = () => Object.keys(tracks).filter(id => !isExclusiveMusicTrack(id));
  let permitted = false, musicPaused = false, mode = 'scenic', playbackRate = 1, requestedTrack, restoreRequestedTrack = false, lastEnvironment = {};
  const modeLabels = { single: '单曲循环', sequence: '顺序播放', random: '随机播放' };
  const hasRecordings = Object.values(tracks).some(track => track?.url);
  const eligible = desired => (desired?.tracks ?? []).filter(id => tracks[id]?.url && !failed.has(id));
  const loops = () => selection?.key === 'fast16' || (mode === 'single' && !isExclusiveMusicTrack(selection?.key));
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
        if (isExclusiveMusicTrack(slot.id) && proximityActive) {
          completedProximity = { key: proximityActive, revision: lastEnvironment.viewMusicRevision ?? 0 };
          report('ended', slot);
          update(lastEnvironment);
          return;
        }
        const options = eligible(selection), at = slot.selectionKey === selection?.key ? options.indexOf(slot.id) : -1;
        const alternatives = options.filter(id => id !== slot.id);
        const next = mode === 'random' && alternatives.length
          ? alternatives[Math.min(alternatives.length - 1, Math.floor(random() * alternatives.length))]
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
      const finish = previous?.playing && !previous.element.paused ? now + 1.5 : now;
      slot.gain.gain.cancelScheduledValues(now); slot.gain.gain.setValueAtTime(0, now);
      // 两条音量包络不相交；即使渲染线程暂时忙碌，也由音频时钟完成交接。
      slot.gain.gain.setValueAtTime(0, finish); slot.gain.gain.linearRampToValueAtTime(1, finish + 1.5);
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
    if (!active || pending || failed.has(active.id) || (requestedTrack && requestedTrack !== active.id)) return;
    const slot = active, token = ++revision;
    slot.interrupted = false;
    play(slot, token, () => {
      const now = context.currentTime;
      const start = outgoing ? Math.max(now, fadeEnd) : now;
      slot.gain.gain.cancelScheduledValues(now);
      slot.gain.gain.setValueAtTime(0, now);
      slot.gain.gain.setValueAtTime(0, start);
      slot.gain.gain.linearRampToValueAtTime(1, start + .5);
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
    const changedMode = ['scenic','single','sequence','random'].includes(options.mode) && options.mode !== mode;
    if (changedMode) { mode = options.mode; fixedSelection = undefined; candidate = undefined; }
    if (Number.isFinite(options.rate)) playbackRate = Math.min(2, Math.max(.5, options.rate));
    if (options.trackId && tracks[options.trackId]?.url) {
      requestedTrack = options.trackId; restoreRequestedTrack = false;
      failed.delete(options.trackId);
      if (mode === 'scenic') mode = 'sequence';
    }
    if ((changedMode || options.trackId) && proximityActive) {
      completedProximity = { key: proximityActive, revision: lastEnvironment.viewMusicRevision ?? 0 };
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
  function updateProximity(env) {
    const lighthouseClicked = LIGHTHOUSE_MUSIC_IDS.find(id => env[`${id}Music`] === true && tracks[id]?.url && !failed.has(id));
    const clickedMusic = lighthouseClicked ?? (env.southPavilionMusic === true && tracks.southPavilion?.url && !failed.has('southPavilion') ? 'southPavilion'
      : env.eastPavilionMusic === true && tracks.eastPavilion?.url && !failed.has('eastPavilion') ? 'eastPavilion'
      : env.caveDreamMusic === true && tracks.caveDream?.url && !failed.has('caveDream') ? 'caveDream'
      : env.caveBoruMusic === true && tracks.caveBoru?.url && !failed.has('caveBoru') ? 'caveBoru'
      : env.caveChantMusic === true && tracks.caveChant?.url && !failed.has('caveChant') ? 'caveChant'
      : env.caveMusic === true && tracks.cave?.url && !failed.has('cave') ? 'cave'
      : env.dockMusic === true && tracks.dock?.url && !failed.has('dock') ? 'dock'
      : env.islandSongMusic === true && tracks.islandSong?.url && !failed.has('islandSong') ? 'islandSong' : undefined);
    const scenicAllowed = mode === 'scenic' && getAnimationRate(env) !== 16;
    const requested = clickedMusic;
    if (completedProximity && (requested !== completedProximity.key || (env.viewMusicRevision ?? 0) !== completedProximity.revision)) completedProximity = undefined;
    const completed = completedProximity?.key === requested && requested !== undefined;
    const allowed = Boolean(clickedMusic && !completed) || scenicAllowed;
    const desired = completed ? undefined : requested;
    const now = clock();
    if (desired !== proximityCandidate) { proximityCandidate = desired; proximityCandidateAt = now; }
    // 用户改为手动播放、16倍速或音源失败时立即交还原播放器。
    if (desired !== proximityActive && (completed || clickedMusic || !allowed || failed.has(proximityActive) || now - proximityCandidateAt >= 1.2)) {
      if (desired) {
        if (!proximityActive) {
          proximityReturnId = active?.id;
          proximityReturnSelection = selection?.key === 'fast16' ? undefined : selection;
          proximityReturnFixedSelection = fixedSelection;
        }
        fixedSelection = undefined;
        cancelPending(); proximityActive = desired;
        selection = {key:desired,label:({lighthouse:'灯塔夜曲',lighthouseLubinghua:'灯塔夜曲',lighthouseHualian:'灯塔夜曲',lighthouseTuogao:'灯塔夜曲',islandSong:'全岛歌声',dock:'码头送别',cave:'山洞花歌',caveDream:'洞中梦曲',caveBoru:'洞中清歌',southPavilion:'南峰亭',eastPavilion:'东峰亭',caveChant:'洞中梵音'})[desired],tracks:[desired]};
        candidate = undefined;
        switchTrack(desired, true);
      } else {
        proximityActive = undefined; cancelPending(); candidate = undefined;
        if (allowed) {
          const next = getScenicMusicSelection(env);
          selection = proximityReturnSelection ?? (next.hold
            ? {key:'sunset',label:'夕阳',tracks:['sunset']} : next);
          const id = tracks[proximityReturnId]?.url && !failed.has(proximityReturnId)
            ? proximityReturnId : eligible(selection)[0];
          if (id && active?.id !== id) switchTrack(id);
          else if (active) { active.label = selection.label; active.selectionKey = selection.key;
            active.element.loop = false; report(active.playing ? 'playing' : 'paused',active); }
        }
        if (!allowed && mode !== 'scenic' && !requestedTrack) {
          requestedTrack = tracks[proximityReturnId]?.url ? proximityReturnId : eligible({tracks:playlistIds()})[0];
          restoreRequestedTrack = true;
        }
        if (mode === 'scenic' && getAnimationRate(env) === 16) fixedSelection = proximityReturnFixedSelection;
        proximityReturnId = proximityReturnSelection = proximityReturnFixedSelection = undefined;
      }
    }
    if (proximityActive && !pending && (!selection.tracks.includes(active?.id) || failed.has(active?.id))) {
      const options = eligible(selection);
      const next = options[0];
      if (next) switchTrack(next, true);
    }
  }
  function update(env) {
    lastEnvironment = env;
    if (!available || disposed) return;
    if (outgoing && context.currentTime >= fadeEnd) { const old = outgoing; outgoing = undefined; retire(old); }
    if (active?.interrupted && !pending) resume();
    updateProximity(env);
    if (proximityActive) return;
    if (mode !== 'scenic') {
      selection = {key:mode, label:modeLabels[mode], tracks:playlistIds()};
      candidate = undefined;
      if (requestedTrack) {
        const id = requestedTrack, restart = !restoreRequestedTrack; requestedTrack = undefined; restoreRequestedTrack = false;
        if (active?.id !== id) switchTrack(id, restart);
        else if (active.element.paused) resume();
      }
      if ((!active || failed.has(active.id)) && !pending) {
        const id = eligible(selection)[0]; if (id) switchTrack(id, true);
      } else if (active) {
        active.label = selection.label; active.selectionKey = selection.key;
        if (active.playing && !pending) report('playing', active);
      }
      return;
    }
    if (getAnimationRate(env) === 16) {
      if (!fixedSelection || !eligible(fixedSelection).length) {
        const options = eligible({tracks:playlistIds()});
        const id = options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))];
        fixedSelection = {key:'fast16',label:'16×单曲循环',tracks:id ? [id] : []};
        // A scene track still loading cannot later take over the fixed loop.
        if (pending) { revision++; const old = pending; pending = undefined; retire(old); }
      }
      selection = fixedSelection; candidate = undefined;
      const id = eligible(selection)[0];
      if (active && active.id === id) {
        active.element.loop = true; active.label = selection.label; active.selectionKey = selection.key;
        if (active.playing) report('playing', active);
      } else if (id && !pending) switchTrack(id, true);
      return;
    }
    if (fixedSelection) {
      fixedSelection = undefined; candidate = undefined;
      for (const slot of slots) slot.element.loop = false;
      if (pending?.selectionKey === 'fast16') { revision++; const old = pending; pending = undefined; retire(old); }
      if (active) { active.label = '随景音乐'; report(active.playing ? 'playing' : 'paused', active); }
    }
    const next = getScenicMusicSelection(env);
    if (next.hold && !tracks.sunset?.url && active) { candidate = undefined; return; }
    const desired = next.hold ? tracks.sunset?.url
      ? { key: 'sunset', label: '夕阳', tracks: ['sunset'] }
      : getScenicMusicSelection({ ...env, hour: 11, daylight: 1 }) : next;
    if (!active || (!active.playing && failed.has(active.id))) {
      if (pending) return;
      selection = desired;
      const id = eligible(desired)[0]; if (id) switchTrack(id);
      return;
    }
    if (selection?.key === desired.key) { candidate = undefined; return; }
    const now = clock();
    if (candidate?.key !== desired.key) { candidate = desired; candidateAt = now; return; }
    if (now - candidateAt < 4 || pending || outgoing) return;
    const sunsetTransition = desired.key === 'sunset' || active.id === 'sunset';
    if (sunsetTransition && (now - startedAt < 20 || !active.playing)) return;
    selection = desired; candidate = undefined;
    // 天气、季节、昼夜只是更新后续曲目，正在播放的主题保持完整。
    if (sunsetTransition) {
      const id = eligible(desired)[0]; if (id && id !== active.id) switchTrack(id);
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
  return { setAvailable, setPlaybackOptions, update, dispose, setTrackUrl, shouldSynthesize: () => !hasRecordings };
}
