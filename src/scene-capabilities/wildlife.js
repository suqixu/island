export function createWildlifeCapabilityBindings({providers={}}={}){
 const entries=Object.entries(providers),channels=new Map();for(const [group,provider]of entries)for(const name of Object.keys(provider.getRuntimeCapabilities().channels))channels.set(name,provider);
 return {
  capture:()=>entries.map(([id,p])=>[id,p.getRuntimeOptions()]),restore(saved){for(const [id,value]of saved){providers[id].sampleFilm?.(null);providers[id].restoreRuntimeOptions(value);}},
  sampleClip(frame,context){const provider=channels.get(frame.capability.split('.')[1]);if(!provider?.sampleFilm)throw new Error(`生物过程尚未加载 ${frame.capability}`);provider.sampleFilm(frame,context);},
  releaseClip(id){channels.get(id.split('.')[1])?.sampleFilm?.(null);},
  capacities:Object.fromEntries(entries.flatMap(([,p])=>Object.entries(p.getRuntimeCapabilities().channels).map(([id,c])=>[id,c.capacity]))),
  speedGroups:entries.map(([group,p])=>Object.keys(p.getRuntimeCapabilities().channels).length===1?Object.keys(p.getRuntimeCapabilities().channels)[0]:group),
  read(id){const [,name,key]=id.split('.'),p=channels.get(name)??providers[name];return key==='speed'?p?.getRuntimeOptions().speed:p?.getRuntimeOptions()[name]?.[key];},
  apply(id,value){const [,name,key]=id.split('.'),p=channels.get(name)??providers[name];if(!p)throw new Error(`生物能力尚未加载 ${name}`);p.setRuntimeOptions(key==='speed'?{speed:value}:{[name]:{[key]:value}});},
 };
}
