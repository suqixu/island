import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/deferred-assets.js').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  assert.equal(typeof api.createDeferredAssets, 'function', '精细贴图需要受控加载队列');
  const scheduled = new Map(); let id = 0;
  const queue = api.createDeferredAssets({ schedule: callback => { scheduled.set(++id, callback); return id; }, cancel: key => scheduled.delete(key) });
  return { queue, scheduled, async tick() { const entry = scheduled.entries().next().value; assert.ok(entry); scheduled.delete(entry[0]); entry[1](); await flush(); } };
}
test('贴图派生串行让步，重复天气请求只加载一次且按需任务优先', async () => {
  const {queue,tick,scheduled} = setup(), calls = []; let finish;
  queue.enqueue('coast', () => { calls.push('coast'); return new Promise(resolve => finish = resolve); });
  queue.enqueue('cave', () => calls.push('cave'));
  await tick(); assert.deepEqual(calls,['coast']); assert.equal(scheduled.size,0);
  queue.enqueue('snow', () => calls.push('snow'), {priority:true});
  queue.enqueue('snow', () => calls.push('duplicate'));
  finish(); await flush(); await tick(); assert.deepEqual(calls,['coast','snow']);
  await tick(); assert.deepEqual(calls,['coast','snow','cave']);
  queue.enqueue('snow', () => calls.push('duplicate')); assert.equal(scheduled.size,0); queue.dispose();
});
test('失败不阻塞其他贴图，退出取消尚未开始的任务', async () => {
  const {queue,tick,scheduled} = setup(), calls=[], errors=[];
  queue.enqueue('bad', () => { throw new Error('decode'); }, {onError:error => errors.push(error.message)});
  queue.enqueue('good', () => calls.push('good')); await tick(); await tick();
  assert.deepEqual(errors,['decode']); assert.deepEqual(calls,['good']);
  queue.enqueue('later', () => calls.push('later')); assert.equal(scheduled.size,1);
  queue.dispose(); queue.dispose(); assert.equal(scheduled.size,0);
  queue.enqueue('after', () => calls.push('after')); assert.deepEqual(calls,['good']);
});
test('只有出现降雪或残留积雪才请求雪景贴图，晴天和冷季本身不请求', () => {
  assert.equal(typeof api.needsSnowTextures, 'function');
  for (const env of [{weather:'sunny',snow:0,snowCover:0},{seasonIndex:3,snow:0,snowCover:0}]) assert.equal(api.needsSnowTextures(env),false);
  for (const env of [{snow:1},{weather:'blizzard'},{snowCover:.1}]) assert.equal(api.needsSnowTextures(env),true);
});

test('空闲回调后同一轮退出时，不再启动尚未进入的贴图工作', async () => {
  const {queue,scheduled}=setup();let calls=0;
  queue.enqueue('detail',()=>calls++);
  const [id,callback]=scheduled.entries().next().value;scheduled.delete(id);callback();
  queue.dispose();await flush();assert.equal(calls,0);
});
