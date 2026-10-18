import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/scene-capabilities/registry.js').catch(()=>({}));
test('能力目录校验0、false、容量、未知字段并允许注册未来能力',()=>{
  assert.equal(typeof api.createCapabilityRegistry,'function');const r=api.createCapabilityRegistry();
  r.registerOwner('test',{capture:()=>({}),restore(){}});
  r.register({id:'test.count',owner:'test',kind:'property',valueType:'integer',min:0,max:32,default:9});
  r.register({id:'test.enabled',owner:'test',kind:'property',valueType:'boolean',default:true});
  assert.equal(r.validateValue('test.count',0),0);assert.equal(r.validateValue('test.enabled',false),false);
  for(const value of [33,-1,NaN,1.5])assert.throws(()=>r.validateValue('test.count',value));
  assert.throws(()=>r.register({id:'test.count',owner:'test'}));assert.throws(()=>r.register({id:'bad',owner:'missing'}));
  r.register({id:'test.futureLevel',owner:'test',kind:'property',valueType:'number',min:0,max:1,default:0});assert.equal(r.validateValue('test.futureLevel',.5),.5);
  assert.equal(JSON.parse(JSON.stringify(r.listCapabilities())).length,3);
  r.register({id:'test.effect',owner:'test',kind:'clip',parameters:{count:{type:'integer',min:0,max:32,default:9}}});
  assert.deepEqual(r.validateParameters('test.effect',{count:18}),{count:18});assert.throws(()=>r.validateParameters('test.effect',{unknown:1}));
});
