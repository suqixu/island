import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/film-script.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const script=()=>({format:'isola-film',schemaVersion:1,title:'海岛慢游',duration:20,music:{trackId:'chunjiang',musicVolume:.6,ambientVolume:.3,fadeIn:2,fadeOut:2},shots:[
 {id:'dawn',start:0,end:10,landmark:'island',camera:[{at:0,position:[160,60,200],target:[0,0,0],fov:46},{at:10,position:[120,40,160],target:[0,2,0],fov:40}],environment:[{at:0,hour:23,season:1,weather:'sunny',snowCover:0},{at:10,hour:1,season:1,weather:'sunny',snowCover:0}]},
 {id:'night',start:10,end:20,landmark:'moon',camera:[{at:0,position:[150,24,200],target:[0,30,0],fov:46},{at:10,position:[130,24,180],target:[0,30,0],fov:46}],environment:[{at:0,hour:22,season:1,weather:'sunny',snowCover:0}]}],captions:[{start:0,end:4,text:'浮屿',style:'title'},{start:10,end:18,text:'灯火与星光',style:'body'}]});
function parse(input){assert.equal(typeof api.parseFilmScript,'function','需要通用脚本解析器');return api.parseFilmScript(input);}
test('项目脚本以文本或对象加载均保留镜头环境字幕和音乐，输入状态独立',()=>{const original=script(),value=parse(original),copy=parse(JSON.stringify(value));assert.deepEqual(copy,value);value.shots[0].camera[0].position[0]=0;assert.equal(original.shots[0].camera[0].position[0],160);});
test('拒绝未知版本、坏镜头和无效场景引用，保留中文错误',()=>{
 for(const change of [s=>s.schemaVersion=99,s=>s.format='javascript',s=>s.shots[0].camera[0].position[0]=NaN,s=>s.shots[1].start=9,s=>s.shots[1].start=11,s=>s.shots[0].landmark='unknown',s=>s.music.trackId='unknown',s=>s.shots[0].environment[0].weather='unknown',s=>s.music.musicVolume=2,s=>s.shots[0].camera[1].at=0]){const value=script();change(value);assert.throws(()=>parse(value),/[\u4e00-\u9fff]/);}
 assert.throws(()=>parse('{bad'),/[\u4e00-\u9fff]/);assert.throws(()=>api.parseFilmScript(JSON.stringify(script()),{maxBytes:10}),/大小|过大/);
});
test('时间线边界、字幕显隐与跨午夜插值正确，不依赖默认三分钟片长',()=>{
 const value=parse(script()),middle=api.sampleFilmScript(value,5);assert.equal(middle.shot.id,'dawn');assert.equal(middle.progress,.5);assert.equal(middle.environment.hour,0);assert.equal(middle.captions.length,0);
 assert.equal(api.sampleFilmScript(value,-2).time,0);assert.equal(api.sampleFilmScript(value,0).captions[0].text,'浮屿');assert.equal(api.sampleFilmScript(value,4).captions.length,0);assert.equal(api.sampleFilmScript(value,10).shot.id,'night');assert.equal(api.sampleFilmScript(value,30).time,20);assert.equal(api.sampleFilmScript(value,20).ended,true);
 assert.equal(api.sampleFilmScript(value,0).music.gain,0);assert.equal(api.sampleFilmScript(value,5).music.gain,1);assert.equal(api.sampleFilmScript(value,20).music.gain,0);
});
test('内置宣传片通过同一格式校验，完整覆盖180秒和四季昼夜',async()=>{const {default:preset}=await import('../src/assets/data/films/isola-four-seasons.json',{with:{type:'json'}});const value=parse(preset);assert.equal(value.duration,180);assert.equal(value.shots[0].start,0);assert.equal(value.shots.at(-1).end,180);assert.deepEqual([...new Set(value.shots.flatMap(s=>s.environment.map(e=>e.season)))].sort(),[0,1,2,3]);assert.ok(value.shots.some(s=>s.environment.some(e=>e.hour>=21)));});
