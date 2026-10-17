const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (value, low, high) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/** 跟随物理太阳高度，只在下午的夕阳及短暂余晖中切换音乐。 */
export function getSunsetMusicMix(environment = {}) {
  const hour = environment.hour;
  if (!Number.isFinite(hour) || hour < 12 || hour >= 21) return 0;
  const height = Number.isFinite(environment.sunDirection?.y) ? environment.sunDirection.y
    : Number.isFinite(environment.sun?.[1]) ? environment.sun[1]
      : Math.sin((hour - 6) / 24 * Math.PI * 2);
  const daylight = Number.isFinite(environment.daylight) ? clamp(environment.daylight)
    : clamp((height + .12) / .5);
  return (1 - smooth(height, .15, .52)) * smooth(daylight, .01, .12);
}

/**
 * Owns one decoded recording and at most one looping source. The caller
 * creates this only after a user gesture; a failed recording never ducks the
 * existing background music. Both paths finish in the same music volume bus.
 */
export function createSunsetMusic(context, musicBus, synthBus, { url, onStatus } = {}) {
  const recordingGain = context.createGain(); recordingGain.gain.value = 0; recordingGain.connect(musicBus);
  let currentUrl = '', buffer, source, startedAt = 0, offset = 0, fadeEnd = null;
  let available = false, disposed = false, generation = 0, abortController;
  let targetMix = 0, state = 'idle', error;
  function report(next, problem) {
    if (state === next && error === problem) return;
    state = next; error = problem;
    onStatus?.({ state, url: currentUrl, ...(error ? { error } : {}) });
  }
  function setMix(value, immediate = false) {
    const next = clamp(value), now = context.currentTime;
    if (!immediate && Math.abs(next - targetMix) < .005) return;
    if (immediate && next === targetMix && recordingGain.gain.value === next && synthBus.gain.value === 1 - next) return;
    targetMix = next;
    for (const [param, target] of [[recordingGain.gain, next], [synthBus.gain, 1 - next]]) {
      param.cancelScheduledValues?.(now);
      if (immediate) param.setValueAtTime(target, now);
      else param.setTargetAtTime(target, now, .65);
    }
  }
  function stopSource(preserveOffset = true) {
    fadeEnd = null;
    if (!source) return;
    const stopped = source; source = undefined;
    if (preserveOffset && buffer) offset = (offset + Math.max(0, context.currentTime - startedAt)) % buffer.duration;
    else offset = 0;
    stopped.onended = null;
    try { stopped.stop(); } catch {}
    stopped.disconnect();
  }
  function load() {
    if (disposed || !available || !currentUrl || buffer || state === 'loading' || state === 'error') return;
    const token = generation, requestUrl = currentUrl;
    const request = new AbortController(); abortController = request;
    report('loading');
    (async () => {
      try {
        const response = await fetch(requestUrl, { signal: request.signal });
        if (!response.ok) throw new Error(`录音请求失败（${response.status}）`);
        const bytes = await response.arrayBuffer();
        if (disposed || token !== generation) return;
        const decoded = await context.decodeAudioData(bytes);
        if (disposed || token !== generation) return;
        if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('录音无法解码');
        buffer = decoded; abortController = undefined;
        report(available ? 'ready' : 'paused');
      } catch (problem) {
        if (disposed || token !== generation) return;
        abortController = undefined; buffer = undefined;
        setMix(0, true); report('error', problem?.message || '录音加载失败');
      }
    })();
  }
  function setUrl(value) {
    const next = typeof value === 'string' ? value.trim() : '';
    if (next === currentUrl && state !== 'error') return;
    generation++; abortController?.abort(); abortController = undefined;
    stopSource(false); setMix(0, true); buffer = undefined; currentUrl = next;
    report(currentUrl ? 'idle' : 'missing'); load();
  }
  function setAvailable(value) {
    available = Boolean(value) && !disposed;
    if (!available) {
      stopSource(); setMix(0, true);
      if (buffer) report('paused');
    } else load();
  }
  function update(environment) {
    if (!available || disposed) return;
    const desired = buffer && state !== 'error' ? getSunsetMusicMix(environment) : 0;
    if (desired > .01) {
      fadeEnd = null;
      if (!source) {
        const next = context.createBufferSource(); next.buffer = buffer; next.loop = true;
        next.connect(recordingGain); startedAt = context.currentTime;
        next.onended = () => { next.disconnect(); if (source === next) { source = undefined; setMix(0, true); report('ready'); } };
        try { next.start(startedAt, offset); source = next; }
        catch (problem) { next.disconnect(); setMix(0, true); report('error', problem.message || '录音无法播放'); return; }
      }
      setMix(desired); report('playing');
    } else {
      setMix(0);
      if (source) {
        fadeEnd ??= context.currentTime + 3;
        if (context.currentTime >= fadeEnd) { stopSource(); report('ready'); }
      } else if (buffer && state !== 'error') report('ready');
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; available = false; generation++;
    abortController?.abort(); abortController = undefined;
    stopSource(false); setMix(0, true); buffer = undefined; recordingGain.disconnect(); report('idle');
  }
  setUrl(url);
  return { setUrl, setAvailable, update, dispose, shouldSynthesize: () => targetMix < .98 };
}
