export function createSceneScheduler({registry,random=Math.random}){
 let snapshots,baseline={},applied=new Map(),active=new Map(),seed;
 function end(context={}){if(!snapshots)return;const saved=snapshots;snapshots=undefined;const errors=[];
  for(const clip of active.values())try{registry.getBinding(clip.capability)?.releaseClip?.(context);}catch(e){errors.push(e);}active.clear();applied.clear();
  for(const [id,snapshot]of saved)try{registry.owners.get(id).restore(snapshot,context);}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'场景状态恢复失败');
 }
 return {
  begin(context={}){if(snapshots)return;seed=Math.floor(random()*4294967296);baseline={};snapshots=new Map();try{
   for(const d of registry.listCapabilities())if(d.kind==='property')baseline[d.id]=registry.getBinding(d.id)?.read?.()??d.default;
   for(const [id,owner]of registry.owners){snapshots.set(id,owner.capture());owner.begin?.({...context,seed});}
  }catch(error){try{end(context);}catch(restoreError){throw new AggregateError([error,restoreError],'场景接管失败，部分恢复也失败');}throw error;}},
  apply(sample,context={}){if(!snapshots)return;context={...context,seed,filmTime:sample.time};const values={...Object.fromEntries([...applied.keys()].map(id=>[id,baseline[id]])),...sample.properties};
   for(const [id,value]of Object.entries(values)){const encoded=JSON.stringify(value);if(applied.get(id)===encoded&&!id.startsWith('scene.'))continue;registry.getBinding(id)?.apply?.(value,context);applied.set(id,encoded);}
   const next=new Map(sample.clips.map(c=>[c.id,c]));for(const [id,c]of active)if(!next.has(id))registry.getBinding(c.capability)?.releaseClip?.(context);
   for(const c of next.values())registry.getBinding(c.capability)?.sampleClip?.(c,context);active=next;
  },
  composeEnvironment(env,context={}){for(const [id,owner]of registry.owners){if(context.phase==='base'&&id==='sky'||context.phase==='sky'&&id!=='sky')continue;env=owner.composeEnvironment?.(env,{...context,seed})??env;}return env;},
  end,dispose:end,get seed(){return seed;},
 };
}
