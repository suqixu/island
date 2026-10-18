import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/resource-loading.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const load=(...args)=>{assert.equal(typeof module.loadOptionalResource,'function');return module.loadOptionalResource(...args);};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function timers(){const tasks=new Map();let id=0;return {tasks,schedule:fn=>{tasks.set(++id,fn);return id;},cancel:key=>tasks.delete(key),tick(){const ready=[...tasks.values()];tasks.clear();ready.forEach(fn=>fn());}};}
test('临时资源失败会重试，成功不触发回退且取消超时任务',async()=>{
  let calls=0;const clock=timers(),warnings=[];
  const value=await load(()=>{if(++calls===1)throw new Error('temporary');return 42;},{...clock,onFallback:error=>warnings.push(error)});
  assert.equal(value,42);assert.equal(calls,2);assert.equal(warnings.length,0);assert.equal(clock.tasks.size,0);
});
test('坏资源不会中断其他资源，所有重试失败后使用可选回退',async()=>{
  let calls=0;const warnings=[];
  const [good,bad]=await Promise.all([load(()=>Promise.resolve('moon')),load(()=>{calls++;return Promise.reject(new Error('404'));},{fallback:undefined,onFallback:error=>warnings.push(error)})]);
  assert.equal(good,'moon');assert.equal(bad,undefined);assert.equal(calls,2);assert.equal(warnings.length,1);
});
test('永不返回的资源会超时回退，迟到纹理立即释放且不覆盖回退',async()=>{
  const clock=timers();let complete,freed=0;
  const pending=load(()=>new Promise(resolve=>complete=resolve),{...clock,retries:0,fallback:null,dispose:map=>map.dispose()});
  await settle();clock.tick();assert.equal(await pending,null);assert.equal(clock.tasks.size,0);
  complete({dispose(){freed++;}});await settle();assert.equal(freed,1);
});
test('页面退出取消等待和重试，已返回或迟到的资源不泄漏',async()=>{
  const clock=timers(),controller=new AbortController();let calls=0,complete,freed=0;
  const pending=load(()=>{calls++;return new Promise(resolve=>complete=resolve);},{...clock,signal:controller.signal,dispose:()=>freed++});
  await settle();controller.abort();assert.equal(await pending,null);assert.equal(clock.tasks.size,0);assert.equal(calls,1);
  complete({});await settle();assert.equal(freed,1);
});
test('默认加载预算传给调度器，耗尽后按配置次数重试',async()=>{
  const defaults=(await import('../src/config/defaults.json',{with:{type:'json'}})).default;
  const delays=[];let calls=0;
  const value=await load(()=>{calls++;throw new Error('unavailable');},{
    schedule(callback,delay){delays.push(delay);return delays.length;},cancel(){},fallback:'plain',
  });
  assert.equal(value,'plain');
  assert.equal(calls,defaults.loading.optional.retries+1);
  assert.deepEqual(delays,Array(calls).fill(defaults.loading.optional.timeoutMs));
});
