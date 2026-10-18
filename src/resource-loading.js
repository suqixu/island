import { DEFAULTS } from './runtime-config.js';

/** Bounded optional loading. A late successful texture is discarded, never
 * attached after its fallback or after page cleanup has already taken over.
 */
export async function loadOptionalResource(load,options={}) {
  const {timeoutMs=DEFAULTS.loading.optional.timeoutMs,retries=DEFAULTS.loading.optional.retries,signal,dispose=()=>{},onFallback=()=>{},
    schedule=globalThis.setTimeout.bind(globalThis),cancel=globalThis.clearTimeout.bind(globalThis)}=options;
  const fallback='fallback' in options?options.fallback:null;
  let error;
  const discard=value=>{try{dispose(value);}catch{/* Cleanup cannot revive a failed request. */}};
  for(let retry=0;retry<=retries&&!signal?.aborted;retry++) {
    try {
      return await new Promise((resolve,reject)=>{
        let waiting=true,timer;
        const finish=(done,value)=>{
          if(!waiting)return false;
          waiting=false;cancel(timer);signal?.removeEventListener('abort',abort);done(value);return true;
        };
        const abort=()=>finish(reject,new Error('Resource loading cancelled'));
        signal?.addEventListener('abort',abort,{once:true});
        timer=schedule(()=>finish(reject,new Error(`Resource timed out after ${timeoutMs}ms`)),timeoutMs);
        Promise.resolve().then(()=>load(signal)).then(value=>{
          if(!finish(resolve,value))discard(value);
        },cause=>finish(reject,cause));
        if(signal?.aborted)abort();
      });
    } catch(cause){error=cause;}
  }
  if(!signal?.aborted)onFallback(error);
  return fallback;
}
