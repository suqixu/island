import test from 'node:test';
import assert from 'node:assert/strict';

let module;
try { module = await import('../src/scenic-music.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const api = () => { assert.equal(typeof module?.createScenicMusic,'function','需要根据场景轮换音乐的播放器'); return module; };
const day = {hour:12,daylight:1,moonLight:0,weather:'sunny',season:'summer',cloudiness:.12,fog:0,rain:0,storm:0,snow:0};
const night = {...day,hour:22,daylight:0,moonLight:1};
const tracks = Object.fromEntries(Object.entries({chunjiang:'春江花月夜',caiyun:'彩云追月',pingsha:'平沙落雁',mengjiang:'孟姜女哭长城',shange:'山歌好比春江水',zuguo:'我的祖国',liangzhu:'梁祝',nuerqing:'女儿情',wangningmei:'枉凝眉'}).map(([id,title])=>[id,{url:`/${id}.ogg`,title}]));
const settle = async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function harness({ sunset = false, lighthouse = false, lighthousePlaylist = false, dock = false, cave = false, caveChant = false, caveSongs = false, pavilion = false, eastPavilion = false, islandSong = false, random } = {}){
  const elements=[],nodes=[];
  const context={currentTime:0,createGain(){const n={gain:{value:0,calls:[],cancelScheduledValues(){},setValueAtTime(v,t){this.value=v;this.calls.push(['set',v,t]);},linearRampToValueAtTime(v,t){this.value=v;this.calls.push(['ramp',v,t]);}},connect(){},disconnect(){this.disconnected=true;}};nodes.push(n);return n;},
    createMediaElementSource(element){const n={element,connect(){},disconnect(){this.disconnected=true;}};nodes.push(n);return n;}};
  function mediaFactory(){const listeners=new Map();const el={src:'',currentTime:0,paused:true,plays:0,loads:0,
    addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},
    play(){this.paused=false;this.plays++;return Promise.resolve();},pause(){this.paused=true;},load(){this.loads++;},removeAttribute(){this.src='';},fire(type){listeners.get(type)?.();}};elements.push(el);return el;}
  const statuses=[];
  const additions={...(islandSong?{islandSong:{url:'/island-shange.mp3',title:'山歌好比春江水'}}:{}),...(caveSongs?{caveDream:{url:'/eji.mp3',title:'梦中的额吉'},caveBoru:{url:'/boru.mp3',title:'波如来'}}:{}),
    ...(lighthousePlaylist?{lighthouseLubinghua:{url:'/lubinghua.mp3',title:'鲁冰花'},lighthouseHualian:{url:'/hualian.mp3',title:'花恋'},lighthouseTuogao:{url:'/tuogao.mp3',title:'驼糕之歌'}}:{})};
  const music=api().createScenicMusic(context,{}, {tracks:{...tracks,...additions,...(caveChant?{caveChant:{url:'/dabei.mp3',title:'大悲咒'}}:{}),...(eastPavilion?{eastPavilion:{url:'/xinjing.mp3',title:'心经'}}:{}),...(pavilion?{southPavilion:{url:'/gongde.mp3',title:'功德宝山咒'}}:{}),...(cave?{cave:{url:'/jiegenghua.mp3',title:'桔梗花'}}:{}),...(dock?{dock:{url:'/songbie.mp3',title:'送别'}}:{}),...(lighthouse?{lighthouse:{url:'/yueer.mp3',title:'月儿明风儿静'}}:{}),...(sunset?{sunset:{url:'/sunset.mp3',title:'渔舟唱晚'}}:{})},mediaFactory,random,clock:()=>context.wallTime??context.currentTime,onStatus:s=>statuses.push(s)});
  return {context,elements,nodes,statuses,music};
}

test('全岛点击歌曲使用上传录音，仅唱一遍后恢复原曲进度，停留不重唱',async()=>{
  const h=harness({islandSong:true});
  h.music.setAvailable(true);h.music.update(day);await settle();
  h.elements.find(e=>!e.paused).currentTime=17;
  const env={...day,islandSongMusic:true,viewMusicRevision:1};
  h.music.update(env);await settle();h.context.currentTime=3;h.music.update(env);
  assert.equal(h.statuses.at(-1).id,'islandSong');
  assert.equal(h.statuses.at(-1).label,'全岛歌声');
  const song=h.elements.find(e=>!e.paused);
  assert.equal(song.src,'/island-shange.mp3');assert.equal(song.loop,false);
  song.fire('ended');await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');
  assert.equal(h.elements.find(e=>!e.paused).currentTime,17);
  for(let i=4;i<12;i++){h.context.currentTime=i;h.music.update(env);await settle();}
  assert.equal(h.statuses.at(-1).id,'caiyun');
  h.music.update({...env,viewMusicRevision:2});await settle();
  assert.equal(h.statuses.at(-1).id,'islandSong');h.music.dispose();
});

test('全岛专属录音不进入普通随机歌单或16倍速循环',async()=>{
  for(const fast of [false,true]) {
    const h=harness({islandSong:true,random:()=>.999});h.music.setAvailable(true);
    h.music.setPlaybackOptions({mode:'random'});
    h.music.update({...day,animationRate:fast?16:1});await settle();
    assert.notEqual(h.statuses.at(-1).id,'islandSong');h.music.dispose();
  }
});

test('16倍速随机选择一首原速循环，天气昼夜变化不会中断，退出后恢复随景轮换', async () => {
  let rolls = 0;
  const h = harness({sunset:true,random:()=>{rolls++;return .65;}});
  h.music.setAvailable(true); h.music.update({...day,animationRate:16}); await settle();
  const first=h.elements.find(e=>!e.paused);
  assert.equal(first.src,'/liangzhu.ogg'); assert.equal(first.loop,true); assert.equal(rolls,1);
  for(let time=5;time<=60;time+=5){h.context.currentTime=time;h.music.update({...night,hour:18,weather:'storm',animationRate:16});await settle();}
  assert.equal(first.plays,1);assert.equal(first.src,'/liangzhu.ogg');assert.equal(rolls,1);
  h.music.update(day);assert.equal(first.loop,false);
  h.context.currentTime=65;h.music.update(day);first.fire('ended');await settle();
  assert.ok(h.elements.some(e=>!e.paused&&e.src==='/caiyun.ogg'));
  h.music.dispose();
});

test('从正在播放的主题进入16倍速，固定曲的交接沿用不重叠的淡出淡入', async () => {
  const h=harness({random:()=>.65});
  h.music.setAvailable(true);h.music.update(day);await settle();
  const previous=h.elements.find(e=>!e.paused);h.context.currentTime=10;
  h.music.update({...night,animationRate:16});await settle();
  const incoming=h.elements.find(e=>e!==previous);
  assert.equal(incoming.src,'/zuguo.ogg');assert.equal(incoming.loop,true);
  const ramps=h.nodes.filter(n=>n.gain?.calls.some(c=>c[0]==='ramp'&&c[1]===1));
  assert.ok(ramps.some(n=>n.gain.calls.some(c=>c[0]==='set'&&c[1]===0&&c[2]===11.5)));
  h.context.currentTime=12;h.music.update({...day,animationRate:16});assert.equal(previous.paused,true);
  h.music.setAvailable(false);h.music.setAvailable(true);await settle();
  assert.equal(incoming.loop,true);assert.equal(incoming.src,'/zuguo.ogg');h.music.dispose();
});

test('16倍速曲目尚在申请播放时退出，迟到的播放许可不能抢回普通主题', async () => {
  const h=harness({random:()=>.65});h.music.setAvailable(true);
  h.music.update({...day,animationRate:16});
  const first=h.elements[0];let resolve,requests=0;
  first.play=function(){
    if(++requests>1){this.paused=false;return Promise.resolve();}
    return new Promise(done=>{resolve=()=>{this.paused=false;done();};});
  };
  await settle();h.music.update(day);await settle();
  const current=h.elements.find(e=>e.src==='/caiyun.ogg');assert.ok(current&&!current.paused&&!current.loop);
  resolve();await settle();assert.equal(current.paused,false);assert.equal(current.loop,false);
  assert.equal(h.elements.filter(e=>!e.paused).length,1);h.music.dispose();
});

test('16倍速没有可播放录音时安静等待，不会访问不存在的媒体', () => {
  const music=api().createScenicMusic({}, {}, {tracks:{missing:{title:'不可用'}},random:()=>0});
  music.setAvailable(true);
  assert.doesNotThrow(()=>music.update({...day,animationRate:16}));music.dispose();
});

test('晴日、月夜和安静的雨雾秋景匹配不同曲目，日落保留已在播放的背景组',()=>{
  const {getScenicMusicSelection}=api();
  assert.deepEqual(getScenicMusicSelection(day).tracks,['caiyun','shange','zuguo']);
  assert.deepEqual(getScenicMusicSelection(night).tracks,['chunjiang','caiyun','liangzhu','nuerqing','wangningmei']);
  for(const weather of ['cloudy','rain','fog','snow','storm'])assert.deepEqual(getScenicMusicSelection({...day,weather}).tracks,['pingsha','mengjiang','liangzhu','wangningmei']);
  assert.deepEqual(getScenicMusicSelection({...day,season:'autumn'}).tracks,['pingsha','mengjiang','liangzhu','wangningmei']);
  assert.equal(getScenicMusicSelection({...day,hour:18,daylight:.2,sun:[0,.02,1]}).hold,true);
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

test('天气变化等待当前曲目结束，月夜曲目按真实结束轮换并复用媒体',async()=>{
  const h=harness();h.music.setAvailable(true);h.music.update(day);await settle();
  const first=h.elements.find(e=>!e.paused);h.context.currentTime=20;h.music.update(night);
  h.context.currentTime=22;h.music.update(day);h.context.currentTime=23;h.music.update(night);
  assert.equal(first.plays,1);h.context.currentTime=28;h.music.update(night);await settle();
  assert.equal(h.elements.length,2);assert.equal(h.elements.filter(e=>!e.paused).length,1,'场景改变不能截断当前曲目');
  assert.equal(first.src,'/caiyun.ogg');first.fire('ended');await settle();
  h.context.currentTime=32;h.music.update(night);assert.ok(first.paused);
  const moon=h.elements.find(e=>!e.paused);assert.equal(moon.src,'/chunjiang.ogg');
  moon.currentTime=96;moon.fire('ended');await settle();
  const second=h.elements.find(e=>!e.paused&&e!==moon);assert.equal(second?.src,'/caiyun.ogg');
  h.context.currentTime=36;h.music.update(night);second.currentTime=115;second.fire('ended');await settle();
  assert.equal(moon.src,'/liangzhu.ogg');
  for(let i=0;i<3;i++){
    h.context.currentTime+=4;h.music.update(night);
    const current=h.elements.find(e=>!e.paused);current.currentTime=100;current.fire('ended');await settle();
  }
  const replay=h.elements.find(e=>e.src==='/chunjiang.ogg');
  assert.equal(replay.currentTime,0,'已结束曲目再次轮换时从头播放');assert.equal(h.elements.length,2);
  h.music.dispose();
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
  assert.ok(h.elements.some(e=>e.src==='/chunjiang.ogg'&&!e.paused));
  h.music.dispose();
});

test('静景轮换在平沙落雁结束后进入孟姜女，失败曲目可跳过',async()=>{
  const h=harness();const quiet={...day,weather:'fog'};
  h.music.setAvailable(true);h.music.update(quiet);await settle();
  const first=h.elements.find(e=>!e.paused);first.fire('ended');await settle();
  const second=h.elements.find(e=>e.src==='/mengjiang.ogg');assert.ok(second&&!second.paused);
  second.fire('error');h.context.currentTime=10;h.music.update(quiet);await settle();
  assert.ok(h.elements.some(e=>e.src==='/pingsha.ogg'&&!e.paused));assert.equal(h.elements.length,2);
  h.music.dispose();
});

test('日落时首次开启声音，保留真实低太阳方向也能初始化背景组且不重复重启',async()=>{
  for(const weather of ['sunny','rain']){
    const h=harness();
    const sunset={...day,hour:17,daylight:.8,sun:[0,.25,1],sunDirection:{y:.25},weather};
    h.music.setAvailable(true);
    assert.doesNotThrow(()=>h.music.update(sunset));await settle();
    const playing=h.elements.find(e=>!e.paused);
    assert.equal(playing?.src,weather==='rain'?'/pingsha.ogg':'/caiyun.ogg');
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
  assert.equal(h.statuses.at(-1).label,'16×单曲循环');
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


const nearLighthouse = {...night,lighthouseMusic:true};
async function enterLighthouse(h) {
  h.music.update(nearLighthouse); h.context.currentTime += 2;
  h.music.update(nearLighthouse); await settle();
}
test('点击灯塔触发上传曲，远离后恢复原曲进度，音量包络不重叠',async()=>{
  const h=harness({lighthouse:true}); h.music.setAvailable(true);h.music.update(night);await settle();
  const first=h.elements.find(e=>!e.paused);first.currentTime=37;
  await enterLighthouse(h);
  assert.equal(h.statuses.at(-1).id,'lighthouse');assert.equal(h.statuses.at(-1).title,'月儿明风儿静');
  const lamp=h.elements.find(e=>e.src==='/yueer.mp3');assert.equal(lamp.loop,false);
  const fades=h.nodes.filter(n=>n.gain).map(n=>n.gain.calls);
  assert.ok(fades.some(calls=>calls.some(c=>c[0]==='set'&&c[1]===0&&c[2]===3.5)),'新曲在旧曲淡出结束前保持静音');
  h.context.currentTime=4;h.music.update(nearLighthouse);assert.equal(first.paused,true);
  h.music.update(night);h.context.currentTime=6;h.music.update(night);await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');assert.equal(first.currentTime,37);
  h.music.dispose();
});
test('白天靠近灯塔不切歌，夜晚短暂经过不切歌，尚未开启声音不加载',async()=>{
  const h=harness({lighthouse:true});await enterLighthouse(h);assert.equal(h.elements.length,0);
  h.music.setAvailable(true);h.music.update({...day,lighthouseNearby:true});await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');
  h.music.update(nearLighthouse);h.context.currentTime+=.5;h.music.update(night);
  h.context.currentTime+=5;h.music.update(night);await settle();assert.equal(h.statuses.at(-1).id,'caiyun');
  h.music.dispose();
});
test('灯塔曲暂停保持进度，离开后恢复正常场景音乐',async()=>{
  const h=harness({lighthouse:true});h.music.setAvailable(true);h.music.update(night);await settle();await enterLighthouse(h);
  const lamp=h.elements.find(e=>e.src==='/yueer.mp3');assert.ok(lamp);lamp.currentTime=21;
  h.music.setPlaybackOptions({paused:true});assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});await settle();assert.equal(lamp.currentTime,21);
  h.music.update({...day,lighthouseNearby:true});h.context.currentTime+=2;h.music.update({...day,lighthouseNearby:true});await settle();
  assert.equal(h.statuses.at(-1).id,'chunjiang');assert.equal(h.elements.length,2);
  h.music.dispose();
});
test('手动选曲和16倍速继续原逻辑，灯塔专属歌曲不混入普通歌单',async()=>{
  for(const mode of ['sequence','single','random']){
    const h=harness({lighthouse:true});h.music.setAvailable(true);h.music.setPlaybackOptions({mode,trackId:'wangningmei'});await settle();
    await enterLighthouse(h);assert.equal(h.statuses.at(-1).id,'lighthouse');
    h.context.currentTime+=3;h.music.update(nearLighthouse);h.elements.find(e=>!e.paused).fire('ended');await settle();assert.notEqual(h.statuses.at(-1).id,'lighthouse');h.music.dispose();
  }
  const h=harness({lighthouse:true,random:()=>.999});h.music.setAvailable(true);h.music.update({...night,lighthouseNearby:true,animationRate:16});await settle();
  assert.notEqual(h.statuses.at(-1).id,'lighthouse');assert.equal(h.statuses.at(-1).label,'16×单曲循环');h.music.dispose();
});
test('灯塔曲加载中远离，迟到的播放许可不能覆盖恢复的原曲',async()=>{
  const h=harness({lighthouse:true});h.music.setAvailable(true);h.music.update(night);await settle();
  const idle=h.elements.find(e=>e.paused);let finish;
  idle.play=function(){return new Promise(resolve=>{finish=()=>{this.paused=false;resolve();};});};
  await enterLighthouse(h);assert.equal(h.statuses.at(-1).id,'lighthouse');
  h.music.update(night);h.context.currentTime+=2;h.music.update(night);await settle();
  finish();await settle();assert.equal(idle.paused,true);
  assert.ok(h.elements.some(e=>!e.paused&&e.src==='/chunjiang.ogg'));h.music.dispose();
});

test('灯塔夜曲播放时改为手动模式，交还普通歌单，失败音源也恢复原曲',async()=>{
  const h=harness({lighthouse:true});h.music.setAvailable(true);h.music.update(night);await settle();await enterLighthouse(h);
  h.music.setPlaybackOptions({mode:'sequence'});await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');
  h.music.setPlaybackOptions({mode:'scenic'});h.music.update({...nearLighthouse,viewMusicRevision:2});await settle();
  const lamp=h.elements.find(e=>e.src==='/yueer.mp3');lamp.fire('error');h.music.update(nearLighthouse);await settle();
  assert.notEqual(h.statuses.at(-1).id,'lighthouse');assert.equal(h.elements.length,2);h.music.dispose();
});

test('从16倍速返回灯塔夜景，远离后正常恢复原曲，不被旧固定循环取消',async()=>{
  const h=harness({lighthouse:true,random:()=>.7});h.music.setAvailable(true);
  h.music.update({...night,lighthouseNearby:true,animationRate:16});await settle();
  const previous=h.statuses.at(-1).id;
  await enterLighthouse(h);assert.equal(h.statuses.at(-1).id,'lighthouse');
  h.context.currentTime+=3;h.music.update(nearLighthouse);
  h.music.update(night);h.context.currentTime+=2;h.music.update(night);await settle();
  assert.equal(h.statuses.at(-1).id,previous);
  h.context.currentTime+=3;h.music.update(night);await settle();
  assert.equal(h.elements.find(e=>!e.paused)?.loop,false);
  assert.ok(h.elements.some(e=>!e.paused&&e.src===tracks[previous].url));h.music.dispose();
});

async function enterDock(h,env=day){
  const near={...env,dockMusic:true};h.music.update(near);h.context.currentTime+=2;h.music.update(near);await settle();
}
test('码头点击触发后白天和夜晚播放送别，远离后恢复原曲进度',async()=>{
  for(const env of [day,night]){
    const h=harness({dock:true});h.music.setAvailable(true);h.music.update(env);await settle();
    const previous=h.elements.find(e=>!e.paused);const original=h.statuses.at(-1).id;previous.currentTime=18;
    await enterDock(h,env);assert.equal(h.statuses.at(-1).id,'dock');assert.equal(h.statuses.at(-1).title,'送别');
    h.context.currentTime+=3;h.music.update({...env,dockMusic:true});
    h.music.update(env);h.context.currentTime+=2;h.music.update(env);await settle();
    assert.equal(h.statuses.at(-1).id,original);assert.equal(previous.currentTime,18);assert.equal(h.elements.length,2);h.music.dispose();
  }
});
test('码头和灯塔之间切换只保留一首近景曲，返回全岛仍恢复最初背景曲',async()=>{
  const h=harness({dock:true,lighthouse:true});h.music.setAvailable(true);h.music.update(night);await settle();
  await enterLighthouse(h);assert.equal(h.statuses.at(-1).id,'lighthouse');
  h.context.currentTime+=3;h.music.update(nearLighthouse);await enterDock(h,night);
  assert.equal(h.statuses.at(-1).id,'dock');h.context.currentTime+=3;h.music.update({...night,dockMusic:true});
  assert.equal(h.elements.filter(e=>!e.paused).length,1);
  h.music.update(night);h.context.currentTime+=2;h.music.update(night);await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');h.music.dispose();
});
test('送别不混入普通顺序歌单或16倍速随机曲目',async()=>{
  const h=harness({dock:true,lighthouse:true,random:()=>.999});h.music.setAvailable(true);
  h.music.update({...day,dockNearby:true,animationRate:16});await settle();assert.notEqual(h.statuses.at(-1).id,'dock');
  h.music.setPlaybackOptions({mode:'sequence',trackId:'wangningmei'});await settle();
  await enterDock(h);h.context.currentTime+=3;h.music.update({...day,dockMusic:true});h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.notEqual(h.statuses.at(-1).id,'dock');assert.notEqual(h.statuses.at(-1).id,'lighthouse');h.music.dispose();
});

test('山洞点击触发后播放桔梗花，离开后恢复背景曲，近景之间转换不覆盖最初背景曲',async()=>{
  const h=harness({cave:true,dock:true,lighthouse:true});h.music.setAvailable(true);h.music.update(night);await settle();
  await enterLighthouse(h);h.context.currentTime+=3;h.music.update(nearLighthouse);
  const near={...night,caveMusic:true};h.music.update(near);h.context.currentTime+=2;h.music.update(near);await settle();
  assert.equal(h.statuses.at(-1).id,'cave');assert.equal(h.statuses.at(-1).title,'桔梗花');
  h.context.currentTime+=3;h.music.update(near);assert.equal(h.elements.filter(e=>!e.paused).length,1);
  h.music.update(night);h.context.currentTime+=2;h.music.update(night);await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');h.music.dispose();
});
test('山洞录音不加入普通随机与16倍速歌单，关闭声音时不加载',async()=>{
  const h=harness({cave:true,random:()=>.999});h.music.update({...day,caveNearby:true});assert.equal(h.elements.length,0);
  h.music.setAvailable(true);h.music.update({...day,caveNearby:true,animationRate:16});await settle();assert.notEqual(h.statuses.at(-1).id,'cave');
  h.music.setPlaybackOptions({mode:'sequence',trackId:'wangningmei'});await settle();h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.notEqual(h.statuses.at(-1).id,'cave');h.music.dispose();
});

test('南峰亭三击触发的专属音乐立即播放，离开后保留手动模式并恢复原曲',async()=>{
  const h=harness({pavilion:true});h.music.setAvailable(true);
  h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing'});await settle();
  const first=h.elements.find(e=>!e.paused);first.currentTime=16;
  h.music.update({...night,southPavilionMusic:true});await settle();
  assert.equal(h.statuses.at(-1).id,'southPavilion');assert.equal(h.statuses.at(-1).title,'功德宝山咒');
  h.context.currentTime+=3;h.music.update({...night,southPavilionMusic:true});
  h.music.update(night);await settle();assert.equal(h.statuses.at(-1).id,'nuerqing');assert.equal(h.statuses.at(-1).label,'单曲循环');
  assert.equal(first.currentTime,16);h.music.dispose();
});
test('未三击时功德宝山咒不参与普通歌单，即使在南峰亭近景也不自动播放',async()=>{
  const h=harness({pavilion:true,random:()=>.999});h.music.setAvailable(true);h.music.update({...night,animationRate:16});await settle();
  assert.notEqual(h.statuses.at(-1).id,'southPavilion');h.music.dispose();
});

test('东峰亭三击立即播放心经，与南峰亭转换后仍恢复最初的普通音乐',async()=>{
  const h=harness({pavilion:true,eastPavilion:true});h.music.setAvailable(true);h.music.update(day);await settle();
  h.music.update({...day,southPavilionMusic:true});await settle();assert.equal(h.statuses.at(-1).id,'southPavilion');
  h.context.currentTime+=3;h.music.update({...day,southPavilionMusic:true});
  h.music.update({...day,eastPavilionMusic:true});await settle();assert.equal(h.statuses.at(-1).id,'eastPavilion');assert.equal(h.statuses.at(-1).title,'心经');
  h.context.currentTime+=3;h.music.update({...day,eastPavilionMusic:true});h.music.update(day);h.context.currentTime+=2;h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');assert.equal(h.elements.length,2);h.music.dispose();
});

test('16倍速中手动触发亭子音乐，离开后恢复原先固定曲目',async()=>{
  let rolls=0;const h=harness({pavilion:true,random:()=>{rolls++;return rolls===1?.2:.8;}});
  h.music.setAvailable(true);h.music.update({...day,animationRate:16});await settle();const original=h.statuses.at(-1).id;
  h.music.update({...day,animationRate:16,southPavilionMusic:true});await settle();assert.equal(h.statuses.at(-1).id,'southPavilion');
  h.context.currentTime+=3;h.music.update({...day,animationRate:16,southPavilionMusic:true});
  h.music.update({...day,animationRate:16});await settle();assert.equal(h.statuses.at(-1).id,original);assert.equal(rolls,1);h.music.dispose();
});

test('山洞播放大悲咒，替换洞口桔梗花，离开仍恢复最初原曲进度',async()=>{
  const h=harness({cave:true,caveChant:true});h.music.setAvailable(true);h.music.update(day);await settle();
  const original=h.elements.find(e=>!e.paused);original.currentTime=29;
  const near={...day,caveMusic:true};h.music.update(near);h.context.currentTime=2;h.music.update(near);await settle();
  assert.equal(h.statuses.at(-1).id,'cave');h.context.currentTime=5;h.music.update(near);
  h.music.update({...near,caveChantMusic:true});await settle();
  assert.equal(h.statuses.at(-1).id,'caveChant');assert.equal(h.statuses.at(-1).title,'大悲咒');
  h.context.currentTime=8;h.music.update({...near,caveChantMusic:true});assert.equal(h.elements.filter(e=>!e.paused).length,1);
  h.music.update(day);h.context.currentTime=10;h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');assert.equal(h.elements.find(e=>e.src==='/caiyun.ogg'&&!e.paused).currentTime,29);assert.equal(h.elements.length,2);h.music.dispose();
});
test('大悲咒隐藏触发适用于手动模式，暂停保持进度，恢复后继续播放',async()=>{
  const h=harness({caveChant:true});h.music.setAvailable(true);h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing'});await settle();
  h.music.update({...night,caveChantMusic:true});await settle();assert.equal(h.statuses.at(-1).id,'caveChant');
  const chant=h.elements.find(e=>e.src==='/dabei.mp3');chant.currentTime=23;
  h.music.setPlaybackOptions({paused:true});assert.ok(h.elements.every(e=>e.paused));
  h.music.setPlaybackOptions({paused:false});await settle();assert.equal(chant.currentTime,23);
  h.context.currentTime=3;h.music.update({...night,caveChantMusic:true});h.music.update(night);await settle();
  assert.equal(h.statuses.at(-1).id,'nuerqing');assert.equal(h.statuses.at(-1).label,'单曲循环');h.music.dispose();
});
test('未触发时大悲咒不混入普通歌单或16倍速固定曲',async()=>{
  const h=harness({caveChant:true,random:()=>.999});h.music.setAvailable(true);h.music.update({...day,animationRate:16});await settle();
  assert.notEqual(h.statuses.at(-1).id,'caveChant');h.music.dispose();
});

test('山洞三级专属音乐依次替换，离开恢复原曲进度，后两首不混入普通歌单',async()=>{
  const h=harness({cave:true,caveChant:true,caveSongs:true,random:()=>.999});
  h.music.setAvailable(true);h.music.update(day);await settle();h.elements.find(e=>!e.paused).currentTime=31;
  for(const [flag,id,title] of [['caveDreamMusic','caveDream','梦中的额吉'],['caveBoruMusic','caveBoru','波如来'],['caveChantMusic','caveChant','大悲咒']]) {
    h.music.update({...day,caveNearby:true,[flag]:true});await settle();
    assert.equal(h.statuses.at(-1).id,id);assert.equal(h.statuses.at(-1).title,title);
    h.context.currentTime+=3;h.music.update({...day,caveNearby:true,[flag]:true});
    assert.equal(h.elements.filter(e=>!e.paused).length,1);
  }
  h.music.update(day);h.context.currentTime+=2;h.music.update(day);await settle();
  assert.equal(h.statuses.at(-1).id,'caiyun');assert.equal(h.elements.find(e=>e.src==='/caiyun.ogg'&&!e.paused).currentTime,31);
  h.music.setPlaybackOptions({mode:'random'});await settle();h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.equal(h.statuses.at(-1).id,'wangningmei');assert.equal(h.elements.length,2);h.music.dispose();
});

test('灯塔四首按点击信号指定，选曲不依赖随机数，失败时恢复普通曲',async()=>{
  for(const [flag,id,url]of [['lighthouseMusic','lighthouse','/yueer.mp3'],['lighthouseLubinghuaMusic','lighthouseLubinghua','/lubinghua.mp3'],['lighthouseHualianMusic','lighthouseHualian','/hualian.mp3'],['lighthouseTuogaoMusic','lighthouseTuogao','/tuogao.mp3']]) {
    const h=harness({lighthouse:true,lighthousePlaylist:true,random:()=>{throw Error('指定曲目不应随机选择')}});
    h.music.setAvailable(true);h.music.update(night);await settle();
    const clicked={...night,[flag]:true};h.music.update(clicked);await settle();assert.equal(h.statuses.at(-1).id,id);
    h.context.currentTime+=3;h.music.update(clicked);h.elements.find(e=>e.src===url).fire('error');
    h.music.update(clicked);await settle();assert.equal(h.statuses.at(-1).id,'chunjiang');h.music.dispose();
  }
});

test('全部专属歌曲仅播放一遍，唱完回普通音乐，停留原处不重复触发',async()=>{
  const cases=[['lighthouseMusic','lighthouse',0],['lighthouseLubinghuaMusic','lighthouseLubinghua',.3],['lighthouseHualianMusic','lighthouseHualian',.6],['lighthouseTuogaoMusic','lighthouseTuogao',.99],
    ['dockMusic','dock'],['caveMusic','cave'],['caveDreamMusic','caveDream'],['caveBoruMusic','caveBoru'],['caveChantMusic','caveChant'],['southPavilionMusic','southPavilion'],['eastPavilionMusic','eastPavilion']];
  for(const [flag,id,roll]of cases) {
    const h=harness({lighthouse:true,lighthousePlaylist:true,dock:true,cave:true,caveSongs:true,caveChant:true,pavilion:true,eastPavilion:true,random:()=>roll??.5});
    h.music.setAvailable(true);h.music.update(night);await settle();h.elements.find(e=>!e.paused).currentTime=19;
    const env={...night,[flag]:true,viewMusicRevision:1};h.music.update(env);h.context.currentTime=2;h.music.update(env);await settle();
    assert.equal(h.statuses.at(-1).id,id);h.context.currentTime=5;h.music.update(env);
    const song=h.elements.find(e=>!e.paused);assert.equal(song.loop,false,id);song.fire('ended');await settle();
    assert.equal(h.statuses.at(-1).id,'chunjiang',id+'唱完恢复原曲');
    for(let i=6;i<20;i++){h.context.currentTime=i;h.music.update(env);await settle();}
    assert.equal(h.statuses.at(-1).id,'chunjiang','停留原处不能再唱');
    h.music.dispose();
  }
});

test('手动单曲模式也只唱一次专属歌，新的点击触发可以再次唱',async()=>{
  const h=harness({pavilion:true});h.music.setAvailable(true);h.music.setPlaybackOptions({mode:'single',trackId:'nuerqing'});await settle();
  const env={...night,southPavilionMusic:true,viewMusicRevision:1};h.music.update(env);await settle();h.context.currentTime=3;h.music.update(env);
  h.elements.find(e=>!e.paused).fire('ended');await settle();assert.equal(h.statuses.at(-1).id,'nuerqing');
  h.music.update(env);await settle();assert.equal(h.statuses.at(-1).id,'nuerqing');
  h.music.update({...env,viewMusicRevision:2});await settle();assert.equal(h.statuses.at(-1).id,'southPavilion');
  h.music.dispose();
});

test('16倍速中专属歌唱完后恢复原固定曲，天候变化不会重新选曲',async()=>{
  let rolls=0;const h=harness({caveChant:true,random:()=>{rolls++;return .9;}});
  const env={...night,animationRate:16};h.music.setAvailable(true);h.music.update(env);await settle();const original=h.statuses.at(-1).id;
  h.music.update({...env,caveChantMusic:true});await settle();h.context.currentTime=3;h.music.update({...env,caveChantMusic:true});
  h.elements.find(e=>!e.paused).fire('ended');await settle();
  assert.equal(h.statuses.at(-1).id,original);assert.equal(rolls,1);
  h.music.update({...env,weather:'storm',caveChantMusic:true});await settle();assert.equal(h.statuses.at(-1).id,original);h.music.dispose();
});


test('靠近山洞或码头不会自动唱歌，点击触发后只唱一次，新的点击可再次播放',async()=>{
  for(const [nearby,flag,id]of [['caveNearby','caveMusic','cave'],['dockNearby','dockMusic','dock'],['lighthouseNearby','lighthouseMusic','lighthouse']]) {
    const h=harness({cave:true,dock:true,lighthouse:true});h.music.setAvailable(true);h.music.update(day);await settle();
    const original=h.statuses.at(-1).id;
    const near={...day,[nearby]:true};
    for(let i=0;i<5;i++){h.context.currentTime+=2;h.music.update(near);await settle();}
    assert.equal(h.statuses.at(-1).id,original,'单纯靠近不能唱');
    const clicked={...near,[flag]:true,viewMusicRevision:1};
    h.music.update(clicked);await settle();assert.equal(h.statuses.at(-1).id,id,'点击触发应立即唱');
    h.context.currentTime+=3;h.music.update(clicked);
    const song=h.elements.find(e=>!e.paused);assert.equal(song.loop,false);song.fire('ended');await settle();
    assert.equal(h.statuses.at(-1).id,original);
    for(let i=0;i<5;i++){h.context.currentTime+=2;h.music.update(clicked);await settle();}
    assert.equal(h.statuses.at(-1).id,original,'唱完停留不能重复唱');
    h.music.update({...clicked,viewMusicRevision:2});await settle();assert.equal(h.statuses.at(-1).id,id,'新的点击可以再次唱');
    h.music.dispose();
  }
});
