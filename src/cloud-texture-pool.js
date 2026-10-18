/** Loaded maps transfer to the atmosphere through apply(), which owns disposal.
 * A late result after disposal stays here and is released immediately.
 */
export function createCloudTexturePool({defaultMaps,loadAdditional,apply}) {
  let wanted=false,disposed=false,pending,allMaps;
  function select(useAll) {
    if(disposed)return;
    wanted=useAll;
    if(!useAll){apply(defaultMaps);return;}
    if(allMaps){apply(allMaps);return;}
    if(pending)return pending;
    pending=Promise.resolve(loadAdditional()).then(additional=>{
      if(!additional?.length)return;
      if(disposed){new Set(additional).forEach(map=>map.dispose());return;}
      allMaps=[...(defaultMaps??[]),...additional];
      // Adopt every texture even if the selection changed while loading.
      apply(allMaps);
      if(!wanted)apply(defaultMaps);
    }).catch(()=>{}).finally(()=>{pending=undefined;});
    return pending;
  }
  return {select,dispose(){disposed=true;allMaps=undefined;}};
}
