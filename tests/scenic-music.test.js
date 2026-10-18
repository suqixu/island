import test from 'node:test';
import assert from 'node:assert/strict';

let module;
try { module = await import('../src/scenic-music.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const api = () => { assert.equal(typeof module?.createScenicMusic,'function','需要根据场景轮换音乐的播放器'); return module; };
const day = {hour:12,daylight:1,moonLight:0,weather:'sunny',season:'summer',cloudiness:.12,fog:0,rain:0,storm:0,snow:0};
const night = {...day,hour:22,daylight:0,moonLight:1};
const tracks = Object.fromEntries(Object.entries({chunjiang:'春江花月夜',caiyun:'彩云追月',pingsha:'平沙落雁',mengjiang:'孟姜女哭长城',shange:'山歌好比春江水',zuguo:'我的祖国',liangzhu:'梁祝',nuerqing:'女儿情',wangningmei:'枉凝眉'}).map(([id,title])=>[id,{url:`/${id}.ogg`,title}]));
const settle = async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function harness({ sunset = false, lighthouse = false, lighthousePlaylist = false, dock = false, cave = false, caveChant = false, caveSongs = false, pavilion = false, eastPavilion = false, islandSong = false, instrumentals = false, random = () => .15 } = {}){
  const elements=[],nodes=[];
  const context={currentTime:0,createGain(){const n={gain:{value:0,calls:[],cancelScheduledValues(){},setValueAtTime(v,t){this.value=v;this.calls.push(['set',v,t]);},linearRampToValueAtTime(v,t){this.value=v;this.calls.push(['ramp',v,t]);}},connect(){},disconnect(){this.disconnected=true;}};nodes.push(n);return n;},
    createMediaElementSource(element){const n={element,connect(){},disconnect(){this.disconnected=true;}};nodes.push(n);return n;}};
  function mediaFactory(){const listeners=new Map();const el={src:'',currentTime:0,paused:true,plays:0,loads:0,
    addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},
    play(){this.paused=false;this.plays++;return Promise.resolve();},pause(){this.paused=true;},load(){this.loads++;},removeAttribute(){this.src='';},fire(type){listeners.get(type)?.();}};elements.push(el);return el;}
  const statuses=[];
  const additions={...(instrumentals?{molihua:{url:'/molihua-synth.mp3',title:'茉莉花'},yueer:{url:'/yueer-synth.mp3',title:'月儿明风儿静'}}:{}),...(islandSong?{islandSong:{url:'/island-shange.mp3',title:'山歌好比春江水'}}:{}),...(caveSongs?{caveDream:{url:'/eji.mp3',title:'梦中的额吉'},caveBoru:{url:'/boru.mp3',title:'波如来'}}:{}),
    ...(lighthousePlaylist?{lighthouseLubinghua:{url:'/lubinghua.mp3',title:'鲁冰花'},lighthouseHualian:{url:'/hualian.mp3',title:'花恋'},lighthouseTuogao:{url:'/tuogao.mp3',title:'驼糕之歌'}}:{})};
  const music=api().createScenicMusic(context,{}, {tracks:{...tracks,...additions,...(caveChant?{caveChant:{url:'/dabei.mp3',title:'大悲咒'}}:{}),...(eastPavilion?{eastPavilion:{url:'/xinjing.mp3',title:'心经'}}:{}),...(pavilion?{southPavilion:{url:'/gongde.mp3',title:'功德宝山咒'}}:{}),...(cave?{cave:{url:'/jiegenghua.mp3',title:'桔梗花'}}:{}),...(dock?{dock:{url:'/songbie.mp3',title:'送别'}}:{}),...(lighthouse?{lighthouse:{url:'/yueer.mp3',title:'月儿明风儿静'}}:{}),...(sunset?{sunset:{url:'/sunset.mp3',title:'渔舟唱晚'}}:{})},mediaFactory,random,clock:()=>context.wallTime??context.currentTime,onStatus:s=>statuses.push(s)});
  return {context,elements,nodes,statuses,music};
}

test('除落日外，各种天气昼夜均从完整普通曲库随机选第一首', async () => {
  for (const env of [day, night, {...day,weather:'rain'}, {...day,weather:'typhoon'}, {...day,season:'autumn'}]) {
    const h = harness({ sunset:true, instrumentals:true, lighthouse:true, random:()=>.75 });
    h.music.setAvailable(true); h.music.update(env); await settle();
    assert.equal(h.statuses.at(-1).id, 'wangningmei');
    assert.equal(h.elements.find(e=>!e.paused).loop, false);
    h.music.dispose();
  }
});

test('普通音乐每次播完重新随机，不按原列表顺序，也不连续重复', async () => {
  const rolls = [.2,.999,0,0];
  const h = harness({sunset:true, random:()=>rolls.shift() ?? 0});
  h.music.setAvailable(true); h.music.update(day); await settle();
  assert.equal(h.statuses.at(-1).id, 'caiyun');
  for (const id of ['wangningmei','chunjiang','caiyun']) {
    h.context.currentTime += 4; h.music.update(day);
    h.elements.find(e=>!e.paused).fire('ended'); await settle();
    assert.equal(h.statuses.at(-1).id, id);
  }
  h.music.dispose();
});

test('点击下一首立即换另一首，连续点击可取消尚在准备的曲目', async () => {
  const h=harness({random:()=>0});h.music.setAvailable(true);h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.music.nextTrack();h.music.nextTrack();await settle();
  assert.equal(h.statuses.at(-1).id,'pingsha');
  h.context.currentTime=4;h.music.update(day);
  h.music.nextTrack();await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.context.currentTime=8;h.music.update(day);
  assert.equal(h.elements.filter(e=>!e.paused).length,1);assert.equal(h.elements.length,2);h.music.dispose();
});

test('暂停时点击下一首保持静音，继续播放时从新曲开头开始', async () => {
  const h=harness({random:()=>0});h.music.setAvailable(true);h.music.update(day);await settle();
  h.music.setPlaybackOptions({paused:true});h.music.nextTrack();await settle();
  assert.ok(h.elements.every(e=>e.paused));assert.equal(h.statuses.at(-1).id,'caiyun');
  h.music.setPlaybackOptions({paused:false});await settle();
  const playing=h.elements.find(e=>!e.paused);assert.equal(playing.src,'/caiyun.ogg');assert.equal(playing.currentTime,0);
  h.music.dispose();
});

test('暂停时切歌后重新指定歌曲，以最后一次选曲为准', async () => {
  const h=harness({random:()=>0});h.music.setAvailable(true);h.music.update(day);await settle();
  h.music.setPlaybackOptions({paused:true});h.music.nextTrack();
  h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing'});
  h.music.setPlaybackOptions({paused:false});await settle();
  assert.equal(h.statuses.at(-1).id,'nuerqing');h.music.dispose();
});

test('落日也可手动跳过渔舟唱晚，本次落日不立即抢回，下一次落日恢复主题', async () => {
  const h=harness({sunset:true,random:()=>0});const sunset={...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.music.setAvailable(true);h.music.update(sunset);await settle();h.music.nextTrack();await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.context.currentTime=30;h.music.update(sunset);h.context.currentTime=35;h.music.update(sunset);await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.music.update(night);h.context.currentTime=60;h.music.update(sunset);h.context.currentTime=65;h.music.update(sunset);await settle();
  assert.equal(h.statuses.at(-1).id,'sunset');h.music.dispose();
});

test('落日固定渔舟唱晚，结束后仍保留落日曲，夜晚再恢复随机', async () => {
  const h = harness({sunset:true, random:()=>.999});
  const sunset = {...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.music.setAvailable(true); h.music.update(sunset); await settle();
  assert.equal(h.statuses.at(-1).id, 'sunset');
  h.elements.find(e=>!e.paused).fire('ended'); await settle();
  assert.equal(h.statuses.at(-1).id, 'sunset');
  h.context.currentTime=25; h.music.update(night);
  h.context.currentTime=30; h.music.update(night); await settle();
  assert.equal(h.statuses.at(-1).id, 'wangningmei');
  h.music.dispose();
});

test('16倍场景也随机换普通曲，进入落日仍播放渔舟唱晚', async () => {
  const h = harness({sunset:true, random:()=>.999});
  h.music.setAvailable(true); h.music.update({...day,animationRate:16}); await settle();
  const first = h.elements.find(e=>!e.paused);
  assert.equal(first.loop, false);
  first.fire('ended'); await settle();
  assert.equal(h.statuses.at(-1).id, 'nuerqing');
  const sunset={...day,hour:18,daylight:.2,sun:[0,.02,1],animationRate:16};
  h.context.currentTime=25; h.music.update(sunset);
  h.context.currentTime=30; h.music.update(sunset); await settle();
  assert.equal(h.statuses.at(-1).id, 'sunset');
  h.music.dispose();
});

test('16倍速没有可播放录音时安静等待，不会访问不存在的媒体', () => {
  const music=api().createScenicMusic({}, {}, {tracks:{missing:{title:'不可用'}},random:()=>0});
  music.setAvailable(true);
  assert.doesNotThrow(()=>music.update({...day,animationRate:16}));music.dispose();
});

test('普通器乐曲库保留茉莉花与月儿明风儿静',()=>{
  const {getScenicMusicSelection}=api();
  assert.ok(getScenicMusicSelection(day).tracks.includes('molihua'));
  assert.ok(getScenicMusicSelection(night).tracks.includes('yueer'));
  assert.ok(getScenicMusicSelection({...day,weather:'rain'}).tracks.includes('yueer'));
  assert.ok(!getScenicMusicSelection(night).tracks.includes('lighthouse'));
});

test('普通器乐顺序播放后回到首曲，暂停保持原进度',async()=>{
  const h=harness({instrumentals:true});
  h.music.setPlaybackOptions({mode:'sequence',trackId:'molihua'});
  h.music.setAvailable(true);h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).title,'茉莉花');
  h.context.currentTime=4;h.music.update(day);h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.equal(h.statuses.at(-1).id,'yueer');
  const lullaby=h.elements.find(e=>e.src==='/yueer-synth.mp3');
  assert.ok(lullaby&&!lullaby.loop);
  h.context.currentTime=8;h.music.update(day);lullaby.currentTime=27;
  h.music.setPlaybackOptions({paused:true});assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});await settle();assert.equal(lullaby.currentTime,27);
  lullaby.fire('ended');await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');
  assert.equal(h.elements.length,2);h.music.dispose();
});

test('用户开启后才加载流式音乐，暂停保留进度，释放媒体和节点',async()=>{
  const h=harness();h.music.update(day);assert.equal(h.elements.length,0);
  h.music.setAvailable(true);h.music.update(day);await settle();
  assert.equal(h.elements.length,2);assert.equal(h.elements.filter(e=>!e.paused).length,1);
  const playing=h.elements.find(e=>!e.paused);assert.equal(playing.src,'/caiyun.ogg');playing.currentTime=25;
  h.music.setAvailable(false);assert.ok(h.elements.every(e=>e.paused));assert.equal(playing.currentTime,25);
  h.music.setAvailable(true);await settle();assert.equal(playing.currentTime,25);
  h.music.dispose();h.music.dispose();assert.ok(h.elements.every(e=>e.paused&&e.src===''));assert.ok(h.nodes.every(n=>n.disconnected));
});

test('天气昼夜变化不截断当前曲，结束后随机切歌且复用两媒体节点',async()=>{
  const rolls=[.2,0,0,0];const h=harness({random:()=>rolls.shift()??0});
  h.music.setAvailable(true);h.music.update(day);await settle();
  const first=h.elements.find(e=>!e.paused);first.currentTime=80;
  for(const env of [night,{...day,weather:'rain'},day]) {h.context.currentTime+=10;h.music.update(env);await settle();}
  assert.equal(first.plays,1);assert.equal(first.src,'/caiyun.ogg');assert.equal(first.currentTime,80);
  first.fire('ended');await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.context.currentTime+=4;h.music.update(night);h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');assert.equal(h.elements.find(e=>!e.paused).currentTime,0);
  assert.equal(h.elements.length,2);h.music.dispose();
});

test('加载中和失败时不叠加另一层合成曲，静音后不再请求曲目',async()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(night);await settle();
  const playing=h.elements.find(e=>!e.paused);playing.fire('error');assert.equal(h.music.shouldSynthesize(),false);
  h.music.setAvailable(false);h.context.currentTime=50;h.music.update(day);assert.ok(h.elements.every(e=>e.paused));
  h.music.dispose();
});

test('等待播放许可时关闭声音，迟到的 Promise 不能重新开启音乐',async()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(day);
  let resolve;
  const incoming=h.elements[0];
  incoming.play=function(){this.plays++;return new Promise(done=>{resolve=()=>{this.paused=false;done();};});};
  await settle();h.music.setAvailable(false);resolve();await settle();
  assert.ok(h.elements.every(e=>e.paused));assert.equal(h.statuses.at(-1).state,'paused');
  h.music.dispose();
});

test('下一曲加载失败时保留仍在播放的上一曲，避免叠加合成底乐',async()=>{
  const h=harness({sunset:true});h.music.setAvailable(true);h.music.update(day);await settle();
  const previous=h.elements.find(e=>!e.paused);
  const incoming=h.elements.find(e=>e!==previous);
  incoming.play=()=>Promise.reject(new Error('音源不可用'));
  const sunset={...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.context.currentTime=20;h.music.update(sunset);h.context.currentTime=25;h.music.update(sunset);await settle();
  assert.equal(previous.paused,false);assert.equal(incoming.src,'');assert.equal(h.music.shouldSynthesize(),false);
  h.music.dispose();
});

test('音频设备时钟暂停前进时，稳定场景仍以真实时间选择曲目',async()=>{
  const h=harness();h.context.wallTime=0;h.music.setAvailable(true);h.music.update(day);await settle();
  h.context.wallTime=20;h.music.update(night);h.context.wallTime=25;h.music.update(night);await settle();
  assert.equal(h.context.currentTime,0);assert.ok(h.elements.some(e=>e.src==='/caiyun.ogg'&&!e.paused));
  h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.ok(h.elements.some(e=>e.src==='/pingsha.ogg'&&!e.paused));
  h.music.dispose();
});

test('随机曲目加载失败后从其余普通曲中重新抽取',async()=>{
  const rolls=[.23,.30,0];const h=harness({random:()=>rolls.shift()??0});
  const env={...day,weather:'fog'};h.music.setAvailable(true);h.music.update(env);await settle();
  const first=h.elements.find(e=>!e.paused);assert.equal(first.src,'/pingsha.ogg');first.fire('ended');await settle();
  const second=h.elements.find(e=>!e.paused);assert.equal(second.src,'/mengjiang.ogg');
  second.fire('error');h.context.currentTime=10;h.music.update(env);await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');assert.equal(h.elements.length,2);h.music.dispose();
});

test('日落时首次开启声音，保留真实低太阳方向也能初始化背景组且不重复重启',async()=>{
  for(const weather of ['sunny','rain']){
    const h=harness();
    const sunset={...day,hour:17,daylight:.8,sun:[0,.25,1],sunDirection:{y:.25},weather};
    h.music.setAvailable(true);
    assert.doesNotThrow(()=>h.music.update(sunset));await settle();
    const playing=h.elements.find(e=>!e.paused);
    assert.equal(playing?.src,'/caiyun.ogg');
    for(let i=0;i<5;i++){h.context.currentTime++;h.music.update(sunset);}
    assert.equal(playing.plays,1);assert.equal(h.elements.length,2);
    h.music.dispose();
  }
});

test('日落使用同一播放器，旧曲淡到零后新曲才开始淡入',async()=>{
  const h=harness({sunset:true});h.music.setAvailable(true);h.music.update(day);await settle();
  const previous=h.elements.find(e=>!e.paused),previousGain=h.nodes[1].gain;
  const sunset={...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.context.currentTime=20;h.music.update(sunset);h.context.currentTime=25;h.music.update(sunset);await settle();
  const incoming=h.elements.find(e=>e!==previous),incomingGain=h.nodes[3].gain;
  assert.equal(incoming.src,'/sunset.mp3');
  const oldZero=previousGain.calls.findLast(call=>call[0]==='ramp'&&call[1]===0);
  const newZero=incomingGain.calls.findLast(call=>call[0]==='set'&&call[1]===0);
  const newOne=incomingGain.calls.findLast(call=>call[0]==='ramp'&&call[1]===1);
  assert.ok(oldZero&&newZero&&newOne);
  assert.ok(newZero[2]>=oldZero[2],'新曲必须保持静音直到旧曲完全淡出');
  assert.ok(newOne[2]>newZero[2]);
  h.context.currentTime=30;h.music.update(sunset);assert.equal(previous.paused,true);
  assert.equal(h.elements.filter(e=>!e.paused).length,1);
  h.music.dispose();
});

test('等待媒体加载时不启动合成旋律，避免数秒后叠曲',()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(day);
  assert.equal(h.music.shouldSynthesize(),false);
  h.music.dispose();
});

test('设备中断后恢复原曲和进度，不切换到另一首',async()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(day);await settle();
  const current=h.elements.find(e=>!e.paused);current.currentTime=31;current.pause();current.fire('pause');
  assert.ok(h.statuses.some(s=>s.state==='paused'));
  h.music.setAvailable(false);h.music.setAvailable(true);await settle();
  assert.equal(current.src,'/caiyun.ogg');assert.equal(current.currentTime,31);
  assert.equal(h.elements.filter(e=>!e.paused).length,1);
  h.music.dispose();
});

test('切歌途中媒体暂停再恢复，仍等待旧曲淡出再淡入',async()=>{
  const h=harness({sunset:true});h.music.setAvailable(true);h.music.update(day);await settle();
  const previous=h.elements.find(e=>!e.paused);
  const sunset={...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.context.currentTime=20;h.music.update(sunset);h.context.currentTime=25;h.music.update(sunset);await settle();
  const incoming=h.elements.find(e=>e!==previous),incomingGain=h.nodes[3].gain;
  h.context.currentTime=25.2;incoming.pause();incoming.fire('pause');h.music.update(sunset);await settle();
  const zero=incomingGain.calls.findLast(call=>call[0]==='set'&&call[1]===0);
  assert.ok(zero[2]>=26.5,'恢复仍须保持静音直到旧曲淡出结束');
  h.music.dispose();
});

test('更换同一曲目的音源后，新音源从头播放',async()=>{
  const h=harness({sunset:true}),sunset={...day,hour:18,daylight:.2,sun:[0,.02,1]};
  h.music.setAvailable(true);h.music.update(sunset);await settle();
  const current=h.elements.find(e=>!e.paused);current.currentTime=31;
  h.music.setTrackUrl('sunset','/new.mp3');h.music.update(sunset);await settle();
  const replaced=h.elements.find(e=>!e.paused);
  assert.equal(replaced.src,'/new.mp3');assert.equal(replaced.currentTime,0);
  h.music.dispose();
});

test('关闭后立即开启，旧播放请求迟到不能暂停复用槽位的新请求',async()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(day);
  const slot=h.elements[0], resolves=[];
  slot.play=function(){this.paused=false;return new Promise(resolve=>resolves.push(resolve));};
  await settle();h.music.setAvailable(false);h.music.setAvailable(true);h.music.update(day);await settle();
  assert.equal(resolves.length,2);assert.equal(slot.paused,false);
  resolves[0]();await settle();assert.equal(slot.paused,false,'旧回调不能暂停新请求');
  resolves[1]();await settle();assert.equal(slot.paused,false);
  h.music.dispose();
});

test('手动选曲、单曲循环和音乐倍速独立于16倍场景及天气', async () => {
  const h=harness({sunset:true});
  h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing',rate:1.5});
  h.music.setAvailable(true);h.music.update({...day,animationRate:16});await settle();
  const el=h.elements.find(e=>!e.paused);
  assert.equal(el.src,'/nuerqing.ogg');assert.equal(el.loop,true);assert.equal(el.playbackRate,1.5);
  h.music.update({...night,weather:'storm',animationRate:16});await settle();
  assert.equal(el.plays,1);
  h.music.setPlaybackOptions({rate:.75});assert.equal(el.playbackRate,.75);
  h.music.dispose();
});

test('顺序播放覆盖全部曲目并在末曲后回到首曲，随机播放避免连续重复', async () => {
  const h=harness({sunset:true,random:()=>0});
  h.music.setPlaybackOptions({mode:'sequence',trackId:'sunset'});
  h.music.setAvailable(true);h.music.update(day);await settle();
  let el=h.elements.find(e=>!e.paused);assert.equal(el.loop,false);el.fire('ended');await settle();
  el=h.elements.find(e=>!e.paused);assert.equal(el.src,'/chunjiang.ogg');
  h.music.setPlaybackOptions({mode:'random'});el.fire('ended');await settle();
  assert.equal(h.elements.find(e=>!e.paused).src,'/caiyun.ogg');
  h.music.dispose();
});

test('音乐独立暂停保留进度，天气更新和音频恢复不会取消暂停', async () => {
  const h=harness();h.music.setPlaybackOptions({mode:'sequence',trackId:'liangzhu'});
  h.music.setAvailable(true);h.music.update(day);await settle();
  const el=h.elements.find(e=>!e.paused);el.currentTime=35;
  h.music.setPlaybackOptions({paused:true});
  h.music.setAvailable(true);h.music.update(night);await settle();assert.ok(h.elements.every(e=>e.paused));
  h.music.setAvailable(false);h.music.setAvailable(true);await settle();assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});await settle();assert.equal(el.currentTime,35);assert.equal(el.paused,false);
  h.music.dispose();
});

test('暂停期间选曲不发声，恢复直接播放新曲，回到随景后恢复原场景策略', async () => {
  const h=harness();h.music.setAvailable(true);h.music.update(day);await settle();
  h.music.setPlaybackOptions({paused:true});h.music.setPlaybackOptions({mode:'single',trackId:'pingsha'});
  h.music.update(night);await settle();assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});h.music.update(night);await settle();
  const el=h.elements.find(e=>!e.paused);assert.equal(el.src,'/pingsha.ogg');assert.equal(el.loop,true);
  h.music.setPlaybackOptions({mode:'scenic',rate:1});h.music.update({...day,animationRate:16});await settle();
  assert.equal(h.elements.find(e=>!e.paused).loop,false);
  h.music.dispose();
});

test('快速重新选曲取消旧申请，迟到许可不会覆盖新曲', async () => {
  const h=harness();h.music.setPlaybackOptions({mode:'single',trackId:'chunjiang'});h.music.setAvailable(true);h.music.update(day);
  const old=h.elements[0];let resolve, requests=0;
  old.play=function(){if(++requests>1){this.paused=false;return Promise.resolve();}return new Promise(done=>{resolve=()=>{this.paused=false;done();};});};
  await settle();h.music.setPlaybackOptions({trackId:'liangzhu'});await settle();
  // 已被取消的槽位可复用，新请求的许可必须对应当前曲。
  old.play=function(){this.paused=false;return Promise.resolve();};
  resolve();await settle();h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).id,'liangzhu');
  assert.ok(h.elements.filter(e=>!e.paused).every(e=>e.src==='/liangzhu.ogg'));
  h.music.dispose();
});

test('新曲尚未加载时暂停后继续仍播放选定的新曲', async () => {
  const h=harness();h.music.setAvailable(true);h.music.update(day);await settle();
  h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing'});
  h.music.setPlaybackOptions({paused:true});await settle();assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});await settle();
  assert.equal(h.statuses.at(-1).id,'nuerqing');assert.ok(h.elements.some(e=>!e.paused&&e.src==='/nuerqing.ogg'));
  h.music.dispose();
});


test('历史地标音乐信号不再打断普通音乐或启动专属录音',async()=>{
  const h=harness({lighthouse:true,dock:true,cave:true,caveChant:true,pavilion:true});
  h.music.setAvailable(true);h.music.update(day);await settle();
  const original=h.statuses.at(-1).id;
  for(const flag of ['lighthouseMusic','dockMusic','caveMusic','caveChantMusic','southPavilionMusic']){
    h.context.currentTime+=5;
    h.music.update({...day,[flag]:true,viewMusicRevision:3});await settle();
    assert.equal(h.statuses.at(-1).id,original);
  }
  h.music.dispose();
});

test('只在音乐 JSON 添加曲目即可加入普通列表，返回列表不共享可变配置', async () => {
  const { default: config } = await import('../src/config/music.json', { with: { type: 'json' } }).catch(() => ({}));
  assert.ok(config, '音乐曲库需要独立 JSON 配置');
  config.tracks.push({ id: 'newSong', title: '新增曲目', file: 'new-song.mp3' });
  try {
    const selected = api().getScenicMusicSelection(day);
    assert.ok(selected.tracks.includes('newSong'));
    assert.ok(!selected.tracks.includes('sunset'));
    selected.tracks.length = 0;
    assert.ok(api().getScenicMusicSelection(day).tracks.includes('newSong'));
    assert.equal(api().getScenicMusicSelection({ ...day, hour: 18, daylight: .2, sun: [0, .02, 1] }).hold, true);
  } finally { config.tracks.pop(); }
});

test('修改播放器曲目地址不会污染调用方共享的曲库预设', () => {
  const sharedTracks = { chunjiang: { url: '/original.mp3', title: '春江花月夜' } };
  const music = api().createScenicMusic({}, {}, { tracks: sharedTracks });
  music.setTrackUrl('chunjiang', '/changed.mp3');
  assert.equal(sharedTracks.chunjiang.url, '/original.mp3');
  music.dispose();
});
