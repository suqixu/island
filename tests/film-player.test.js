import test from 'node:test';
import assert from 'node:assert/strict';
import preset from '../src/assets/data/films/isola-four-seasons.json' with {type:'json'};
const api=await import('../src/film-player.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function create(options={}){assert.equal(typeof api.createFilmPlayer,'function');const world={value:'漫游'},frames=[];const player=api.createFilmPlayer({capture:()=>({...world}),restore:snapshot=>Object.assign(world,snapshot),onFrame:sample=>{world.value=sample.shot.id;frames.push(sample);},...options});player.load(preset);return {player,world,frames};}
test('唯一外部时钟推进，暂停与恢复不追赶时间，片尾与重播保留原快照',async()=>{const {player,world}=create();await player.play();assert.equal(player.getState().status,'playing');player.update(1000);player.update(6000);assert.equal(player.getState().time,5);player.pause();player.update(20000);assert.equal(player.getState().time,5);player.resume();player.update(30000);player.update(32000);assert.equal(player.getState().time,7);player.update(300000);assert.equal(player.getState().time,180);assert.equal(player.getState().status,'ended');await player.restart();assert.equal(player.getState().time,0);player.exit();assert.equal(world.value,'漫游');player.dispose();});
test('准备中退出和卸载使迟到准备失效，恢复一次且不会重新播放',async()=>{let release,restores=0;const {player}=create({prepare:()=>new Promise(resolve=>release=resolve),restore:()=>restores++});const waiting=player.play();assert.equal(player.getState().status,'preparing');player.exit();release();await waiting;assert.equal(player.getState().status,'idle');assert.equal(restores,1);player.dispose();assert.equal(restores,1);});
test('非法脚本不替换当前影片，准备失败恢复漫游并可再次播放',async()=>{let fails=true;const {player,world}=create({prepare:async()=>{if(fails)throw new Error('资源暂未就绪');}});assert.throws(()=>player.load({format:'bad'}));assert.equal(player.getState().script.title,preset.title);await assert.rejects(player.play(),/资源/);assert.equal(world.value,'漫游');assert.equal(player.getState().active,false);fails=false;await player.play();assert.equal(player.getState().status,'playing');player.dispose();assert.equal(world.value,'漫游');});
test('重复播放准备由最后一轮拥有，旧准备不能覆盖新影片',async()=>{const pending=[];const {player}=create({prepare:()=>new Promise(resolve=>pending.push(resolve))});const a=player.play(),b=player.restart();pending[0]();await a;assert.equal(player.getState().status,'preparing');pending[1]();await b;assert.equal(player.getState().status,'playing');player.dispose();});
test('准备期间切后台会在准备完成后保持暂停，明确继续才推进',async()=>{
  let release;const {player}=create({prepare:()=>new Promise(resolve=>release=resolve)});
  const waiting=player.play();player.pause();release();await waiting;
  assert.equal(player.getState().status,'paused');player.update(1000);player.update(5000);assert.equal(player.getState().time,0);
  player.resume();player.update(9000);player.update(10000);assert.equal(player.getState().time,1);player.dispose();
});
test('播放倍速作用于时间线，前后拖动立即定位，暂停与片尾可以继续',async()=>{
  const seeks=[],{player,frames}=create({onSeek:sample=>seeks.push(sample.time)});await player.play();
  assert.equal(typeof player.setRate,'function');assert.equal(typeof player.seek,'function');player.setRate(2);player.update(1000);player.update(3000);assert.equal(player.getState().time,4);
  player.seek(140);assert.equal(frames.at(-1).time,140);assert.equal(frames.at(-1).environment.season,3);player.update(4000);assert.equal(player.getState().time,140);
  player.pause();player.seek(20);player.update(5000);assert.equal(player.getState().time,20);assert.equal(player.getState().status,'paused');
  player.seek(999);assert.equal(player.getState().status,'ended');player.seek(10);assert.equal(player.getState().status,'paused');player.resume();player.update(6000);player.update(7000);assert.equal(player.getState().time,12);assert.deepEqual(seeks,[140,20,180,10]);player.dispose();
});
test('恢复回调异常仍通知界面退出，后续退出不会重复恢复',async()=>{let restored=0,statuses=[];const player=api.createFilmPlayer({restore(){restored++;throw Error('恢复失败')},onStatus:s=>statuses.push(s.status)});player.load(preset);await player.play();assert.throws(()=>player.exit(),/恢复失败/);assert.equal(player.getState().active,false);assert.equal(statuses.at(-1),'idle');player.exit();assert.equal(restored,1);});
