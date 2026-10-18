/** 模块显式持有的绘制批次；不遍历场景，也不创建或替换几何。数量是活动上限，仍遵守天气与栖息地。 */
export function attachRuntimeOptions(api,channels){
 const update=api.update,setQuality=api.setQuality??(()=>{});let options={},quality='high',effectiveQuality='high',inputTime,motionTime;
 const restoreDraw=[];
 function unmask(){for(const restore of restoreDraw)restore();restoreDraw.length=0;}
 function syncQuality(){const next=Object.keys(channels).some(id=>options[id]?.count!==undefined)?'high':quality;if(next!==effectiveQuality){setQuality(next);effectiveQuality=next;}}
 api.getRuntimeCapabilities=()=>({speed:{type:'number',min:.1,max:4,default:1},channels:Object.fromEntries(Object.entries(channels).map(([id,c])=>[id,{capacity:c.capacity}]))});
 api.getRuntimeOptions=()=>structuredClone(options);
 api.getActivityLimit=(id,fallback)=>options[id]?.enabled===false?0:Math.min(options[id]?.count??fallback,fallback);
 api.setRuntimeOptions=patch=>{const next=structuredClone(options);for(const [id,value]of Object.entries(patch)){
  if(id==='speed'){if(!Number.isFinite(value)||value<.1||value>4)throw new Error('运动速度超出范围');next.speed=value;continue;}
  if(!channels[id]||!value||typeof value!=='object')throw new Error(`未知生物参数 ${id}`);
  for(const [key,v]of Object.entries(value))if(key==='count'?!Number.isInteger(v)||v<0||v>channels[id].capacity:key==='enabled'?typeof v!=='boolean':true)throw new Error(`生物参数超出范围 ${id}.${key}`);
  next[id]={...next[id],...value};
 }options=next;syncQuality();};
 api.restoreRuntimeOptions=saved=>{unmask();options=structuredClone(saved);syncQuality();};
 api.setQuality=value=>{unmask();quality=value;effectiveQuality='';syncQuality();};
 api.update=(time,...args)=>{unmask();if(Object.keys(options).length===0&&(motionTime===undefined||motionTime===inputTime)){inputTime=motionTime=time;update(time,...args);return;}let now=time;if(Number.isFinite(time)){
  if(inputTime===undefined){motionTime=time;inputTime=time;}
  else{motionTime+=Math.max(0,time-inputTime)*(options.speed??1);inputTime=time;}
  now=motionTime;
 }if(effectiveQuality!==quality&&args[0])args[0]={...args[0],quality:effectiveQuality};update(now,...args);
 for(const [id,channel]of Object.entries(channels)){
  const override=options[id];if(!override&&effectiveQuality===quality)continue;
  let remaining=override?.enabled===false?0:override?.count??channel.counts?.[quality]??channel.capacity;
  for(const batch of channel.batches??[]){
   const body=batch.body,raw=body.isPoints?body.geometry.drawRange.count:body.count;
   const capacity=body.isPoints?body.geometry.attributes.position.count:body.instanceMatrix?.count??0;
   const count=Math.min(Number.isFinite(raw)?raw:capacity,remaining);remaining-=count;
   if(body.isPoints){const start=body.geometry.drawRange.start;restoreDraw.push(()=>body.geometry.setDrawRange(start,raw));body.geometry.setDrawRange(start,count);}
   else{restoreDraw.push(()=>body.count=raw);body.count=count;}
   for(const {mesh,ratio=1}of batch.parts??[]){const previous=mesh.count;restoreDraw.push(()=>mesh.count=previous);mesh.count=Math.min(previous,count*ratio);}
  }
  let left=override?.enabled===false?0:override?.count??channel.capacity;
  for(const object of channel.objects??[]){const visible=object.visible;restoreDraw.push(()=>object.visible=visible);object.visible=visible&&left-->0;}
  if(override?.enabled===false||override?.count===0)for(const object of channel.effects??[]){const visible=object.visible;restoreDraw.push(()=>object.visible=visible);object.visible=false;}
 }
 };
 return api;
}
