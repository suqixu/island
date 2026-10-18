import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../src/deferred-poetry.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const create=options=>{assert.equal(typeof module.createDeferredPoetry,'function');return module.createDeferredPoetry(options);};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function poem(){return {enabled:true,active:true,restarts:0,frames:[],setEnabled(value){this.enabled=value;},restart(){this.restarts++;},reframe(){},update(...args){this.frames.push(args);},dispose(){this.disposed=true;}};}
test('诗句默认关闭且不加载字体，首次开启后沿用当前时间，之后复用实例',async()=>{
  let loads=0;const resource=poem();const poetry=create({load:async()=>{loads++;return resource;}});
  poetry.update(200,{hour:22});assert.equal(poetry.enabled,false);assert.equal(poetry.active,false);assert.equal(loads,0);
  poetry.setEnabled(true);await settle();assert.equal(loads,1);assert.equal(poetry.enabled,true);
  poetry.update(201,{hour:22});assert.equal(resource.frames.at(-1)[0],201);
  poetry.setEnabled(false);poetry.setEnabled(true);await settle();assert.equal(loads,1);poetry.dispose();assert.equal(resource.disposed,true);
});
test('字体加载中关诗或退出，迟到结果不能重新开启或泄漏',async()=>{
  let complete;const resource=poem();const poetry=create({load:()=>new Promise(resolve=>complete=resolve)});
  poetry.setEnabled(true);await settle();poetry.setEnabled(false);complete(resource);await settle();assert.equal(poetry.enabled,false);assert.equal(resource.enabled,false);
  poetry.dispose();assert.equal(resource.disposed,true);
  let late;const second=poem(),other=create({load:()=>new Promise(resolve=>late=resolve)});other.setEnabled(true);await settle();other.dispose();late(second);await settle();assert.equal(second.disposed,true);
});
test('字体失败只关闭诗句，重试可恢复，不拒绝海岛更新',async()=>{
  let calls=0,errors=0;const resource=poem();const poetry=create({load:async()=>{if(++calls===1)throw new Error('font failed');return resource;},onError:()=>errors++});
  poetry.setEnabled(true);await settle();assert.equal(poetry.enabled,false);assert.equal(errors,1);assert.doesNotThrow(()=>poetry.update(10,{}));
  poetry.setEnabled(true);await settle();assert.equal(poetry.enabled,true);assert.equal(calls,2);poetry.dispose();
});
test('默认启用配置在调用方完成初始化后延迟加载，释放后不会复活',async()=>{
  let loads=0,initialized=false;
  const resource=poem();
  const poetry=create({initialEnabled:true,load:async()=>{assert.equal(initialized,true);loads++;return resource;}});
  initialized=true;
  assert.equal(poetry.enabled,true);assert.equal(loads,0);
  await settle();assert.equal(loads,1);assert.equal(resource.enabled,true);
  poetry.dispose();
  const cancelled=create({initialEnabled:true,load:async()=>{throw new Error('disposed request must not load');}});
  cancelled.dispose();await settle();assert.equal(cancelled.enabled,false);
});
