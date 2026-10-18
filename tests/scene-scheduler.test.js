import test from 'node:test';
import assert from 'node:assert/strict';
const registryApi=await import('../src/scene-capabilities/registry.js').catch(()=>({}));
const api=await import('../src/scene-capabilities/scheduler.js').catch(()=>({}));
test('调度优先级、零值、仅变更应用、片段释放、会话恢复幂等',()=>{
 assert.equal(typeof api.createSceneScheduler,'function');const r=registryApi.createCapabilityRegistry();let value=9,applies=0,restores=0,samples=0,releases=0;
 r.registerOwner('test',{capture:()=>value,restore(v){value=v;restores++;}});
 r.register({id:'test.count',owner:'test',kind:'property',valueType:'integer',default:9,min:0,max:32},{read:()=>value,apply(v){value=v;applies++;}});
 r.register({id:'test.effect',owner:'test',kind:'clip',parameters:{}},{sampleClip(){samples++;},releaseClip(){releases++;}});
 const scheduler=api.createSceneScheduler({registry:r,random:()=>.2});scheduler.begin({});
 const sample={time:0,properties:{'test.count':0},clips:[{id:'one',capability:'test.effect',parameters:{},localTime:0}]};
 scheduler.apply(sample,{});scheduler.apply(sample,{});assert.equal(value,0);assert.equal(applies,1);assert.equal(samples,2);
 scheduler.apply({time:1,properties:{},clips:[]},{});assert.equal(value,9);assert.equal(releases,1);scheduler.end({});scheduler.end({});assert.equal(restores,1);
});
test('一个模块恢复失败仍继续恢复其他模块，恢复不会重复执行',()=>{const r=registryApi.createCapabilityRegistry(),restored=[];r.registerOwner('first',{capture:()=>1,restore(){restored.push('first');throw new Error('first')}});r.registerOwner('second',{capture:()=>2,restore(){restored.push('second')}});const scheduler=api.createSceneScheduler({registry:r});scheduler.begin();assert.throws(()=>scheduler.end(),AggregateError);assert.deepEqual(restored,['first','second']);scheduler.end();assert.equal(restored.length,2);});
test('部分begin失败会回滚已经捕获的全部模块',()=>{const r=registryApi.createCapabilityRegistry(),restored=[];for(const id of ['a','b'])r.registerOwner(id,{capture:()=>id,begin(){if(id==='b')throw new Error('begin')},restore:()=>restored.push(id)});const scheduler=api.createSceneScheduler({registry:r});assert.throws(()=>scheduler.begin());assert.deepEqual(restored,['a','b']);scheduler.end();});
