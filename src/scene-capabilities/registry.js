const clone=value=>value===undefined?undefined:structuredClone(value);
const fail=message=>{throw new Error(`场景能力：${message}`);};
export function validateCapabilityValue(def,value,label=def.id??'参数'){
  const type=def.valueType??def.type;
  const ok=type==='boolean'?typeof value==='boolean':type==='enum'?def.values.includes(value):type==='string'?typeof value==='string'&&value.length<=160:
    type==='number'||type==='integer'?typeof value==='number'&&Number.isFinite(value)&&(type!=='integer'||Number.isInteger(value))&&!(def.min!==undefined&&value<def.min)&&!(def.max!==undefined&&value>def.max):
    type==='vector2'||type==='vector3'?Array.isArray(value)&&value.length===(type==='vector2'?2:3)&&value.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e5):false;
  if(!ok)fail(`${label} 类型或范围不正确`);return clone(value);
}
export function createCapabilityRegistry(){
  const definitions=new Map(),bindings=new Map(),owners=new Map();
  function get(id){const d=definitions.get(id);if(!d)fail(`未知能力 ${id}`);return d;}
  return {
    owners,
    registerOwner(id,owner){if(owners.has(id))fail(`所有者重复 ${id}`);owners.set(id,owner);},
    register(definition,binding={}){const d=clone(definition);if(!d.id||definitions.has(d.id))fail(`名称重复或缺失 ${d.id}`);if(!owners.has(d.owner))fail(`未知所有者 ${d.owner}`);definitions.set(d.id,Object.freeze(d));bindings.set(d.id,binding);},
    get,getBinding:id=>bindings.get(id),listCapabilities:()=>[...definitions.values()].map(clone),
    validateValue(id,value){const d=get(id);if(d.kind!=='property')fail(`${id} 不是属性`);return validateCapabilityValue(d,value,id);},
    validateParameters(id,parameters={}){const d=get(id);if(d.kind!=='clip'||!parameters||typeof parameters!=='object'||Array.isArray(parameters))fail(`${id} 片段参数不正确`);const result={};
      for(const key of Object.keys(parameters))if(!Object.hasOwn(d.parameters??{},key))fail(`${id} 未知参数 ${key}`);
      for(const [key,schema] of Object.entries(d.parameters??{})){const value=Object.hasOwn(parameters,key)?parameters[key]:schema.default;if(value!==undefined)result[key]=validateCapabilityValue(schema,value,`${id}.${key}`);}return result;},
  };
}
