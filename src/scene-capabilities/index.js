import {createCapabilityRegistry} from './registry.js';
import {createCapabilityCatalog} from './catalog.js';
import {createEnvironmentCapabilityBindings} from './environment.js';
import {createPresentationCapabilityBindings} from './presentation.js';
import {createWildlifeCapabilityBindings} from './wildlife.js';
import {createSkyCapabilityBindings} from './sky.js';
export function createSceneCapabilities(dependencies){
 const registry=createCapabilityRegistry();
 const owners={environment:createEnvironmentCapabilityBindings(dependencies),presentation:createPresentationCapabilityBindings(dependencies),wildlife:createWildlifeCapabilityBindings(dependencies),sky:createSkyCapabilityBindings(dependencies)};
 for(const [name,owner]of Object.entries(owners))registry.registerOwner(name,owner);
 for(const d of createCapabilityCatalog({capacities:owners.wildlife.capacities,speedGroups:owners.wildlife.speedGroups})){
  const owner=owners[d.owner];registry.register(d,d.kind==='property'?{read:()=>owner.read?.(d.id),apply:(v,ctx)=>owner.apply?.(d.id,v,ctx)}:{sampleClip:(frame,ctx)=>owner.sampleClip?.(frame,ctx),releaseClip:()=>owner.releaseClip?.(d.id)});
 }
 registry.getMusicOptions=owners.presentation.getMusicOptions;return registry;
}
