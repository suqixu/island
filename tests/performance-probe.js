// Test-only instrumentation, installed before the normal application starts.
// Records rendered animation callbacks, including simulation and render submission.
const nativeRequest = window.requestAnimationFrame.bind(window);
const samples = [];
let latest, longTasks = 0;
let longTaskObserver;
try {
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver(list => { longTasks += list.getEntries().length; });
    longTaskObserver.observe({ type: 'longtask' });
  }
} catch {longTaskObserver=undefined;}
window.requestAnimationFrame = callback => nativeRequest(time => {
  const app = window.isola, renderer = app?.renderer;
  if (renderer) { renderer.info.autoReset = false; renderer.info.reset(); }
  const before = renderer?.info.render.frame, started = performance.now();
  try { callback(time); }
  finally {
    if (renderer && renderer.info.render.frame !== before) {
      latest = renderer;
      samples.push({ time, ms: performance.now() - started, calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0,
        heap: performance.memory?.usedJSHeapSize ?? null });
      if (samples.length > 1200) samples.shift();
    }
  }
});
const quantile = (values, q) => values.length ? values.sort((a,b) => a-b)[Math.floor((values.length-1)*q)] : null;
window.performanceProbe = {
  reset() { samples.length = 0; longTasks = 0; },
  snapshot() {
    const last = samples.at(-1);
    const cloudMaps=new Set();
    window.isola?.scene.traverse(object=>{
      const map=object.material?.map;
      if(map?.userData.cloudId!=null)cloudMaps.add(map);
    });
    return { ready: !!window.isola, frames: samples.length,
      cloudForms:cloudMaps.size,cloudAtlases:new Set([...cloudMaps].map(map=>map.source)).size,
      fps: samples.length > 1 ? (samples.length-1)*1000/(last.time-samples[0].time) : null,
      callbackP50: quantile(samples.map(s=>s.ms),.5), callbackP95: quantile(samples.map(s=>s.ms),.95),
      calls: last?.calls, triangles: last?.triangles, geometries: last?.geometries,
      textures: last?.textures, programs: last?.programs, heapMiB: last?.heap ? last.heap/1048576 : null,
      longTasks: longTaskObserver ? longTasks : null };
  },
  cleanup() {
    longTaskObserver?.disconnect();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return { appRemoved: !window.isola, geometries: latest?.info.memory.geometries,
      textures: latest?.info.memory.textures, programs: latest?.info.programs?.length ?? 0,
      contextLost:latest?.getContext().isContextLost(),
      canvasCount: document.querySelectorAll('#scene canvas').length };
  },
};
