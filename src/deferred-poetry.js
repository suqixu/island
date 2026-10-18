import { DEFAULTS } from './runtime-config.js';

/** Keep the font parser and 3D lettering out of startup until explicitly enabled. */
export function createDeferredPoetry({load,onError=()=>{},onChange=()=>{},initialEnabled=DEFAULTS.interface.poetryEnabled}) {
  const controller=new AbortController();
  let enabled=Boolean(initialEnabled),disposed=false,instance,pending,restartQueued=false;
  function setEnabled(value) {
    if(disposed)return;
    enabled=Boolean(value);instance?.setEnabled(enabled);onChange();
    if(!enabled||instance||pending)return;
    pending=Promise.resolve().then(()=>load(controller.signal)).then(resource=>{
      if(disposed){resource?.dispose();return;}
      if(!resource)throw new Error('Poetry resources unavailable');
      instance=resource;instance.setEnabled(enabled);
      if(restartQueued){instance.restart();restartQueued=false;}
    }).catch(error=>{
      if(!disposed){enabled=false;onError(error);}
    }).finally(()=>{pending=undefined;if(!disposed)onChange();});
  }
  if(enabled)queueMicrotask(()=>setEnabled(enabled));
  function dispose(){if(disposed)return;disposed=true;enabled=false;controller.abort();instance?.dispose();instance=undefined;}
  return {
    get enabled(){return enabled;}, get active(){return enabled&&Boolean(instance?.active);},
    get loading(){return Boolean(pending);},
    setEnabled,
    restart(){if(instance)instance.restart();else restartQueued=true;},
    reframe(){instance?.reframe();},
    update(...args){if(!disposed)instance?.update(...args);},
    dispose,
  };
}
