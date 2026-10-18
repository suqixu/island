import {readFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname,extname} from 'node:path';
import {parseAst} from 'rollup/parseAst';

const root=fileURLToPath(new URL('../../',import.meta.url));
const errors=[];
async function files(folder){
  const entries=await readdir(resolve(root,folder),{withFileTypes:true});
  const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?files(`${folder}/${entry.name}`):[`${folder}/${entry.name}`]));
  return nested.flat();
}
async function exists(path){try{return await stat(path);}catch{return null;}}
async function reference(file,value){
  if(typeof value!=='string'||!value.startsWith('.')&&!value.startsWith('/src/'))return;
  const source=value.split(/[?#]/)[0];
  const path=source.startsWith('/src/')?resolve(root,source.slice(1)):resolve(root,dirname(file),source);
  if(path.startsWith(resolve(root,'tmp')+'/'))return;
  const local=path.includes('*')?path.slice(0,path.indexOf('*')).replace(/\/$/,''):path;
  if(!await exists(local))errors.push(`${file}: 找不到 ${value}`);
}
async function checkSource(file){
  const source=await readFile(resolve(root,file),'utf8');
  const references=[];
  if(['.js','.mjs'].includes(extname(file))){
    let ast;try{ast=parseAst(source);}catch(error){errors.push(`${file}: ${error.message}`);return;}
    function walk(node){
      if(!node||typeof node!=='object')return;
      if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type))references.push(node.source?.value);
      if(node.type==='NewExpression'&&node.callee?.name==='URL'&&node.arguments[1]?.object?.type==='MetaProperty')references.push(node.arguments[0]?.value);
      if(node.type==='CallExpression'&&node.callee?.property?.name==='glob')references.push(node.arguments[0]?.value);
      for(const [key,value]of Object.entries(node)){
        if(key==='parent')continue;
        if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
      }
    }
    walk(ast);
  }else if(extname(file)==='.css')references.push(...[...source.matchAll(/url\(['"]?([^'"\s)]+)['"]?\)/g)].map(match=>match[1]));
  else references.push(...[...source.matchAll(/(?:src|href)=['"]([^'"]+)['"]/g)].map(match=>match[1]));
  await Promise.all(references.map(value=>reference(file,value)));
}
export async function checkProject(){
  errors.length=0;
  const sourceFiles=[...(await files('src')),...(await files('tests')),'index.html','vite.config.js'];
  await Promise.all(sourceFiles.filter(file=>['.js','.mjs','.css','.html'].includes(extname(file))).map(checkSource));
  const read=async name=>JSON.parse(await readFile(resolve(root,name),'utf8'));
  const [defaults,weather,camera,rendering,music,loading,notes,pkg]=await Promise.all(['src/config/defaults.json','src/config/weather.json','src/config/camera.json','src/config/rendering.json','src/config/music.json','src/config/loading.json','src/config/release-notes.json','package.json'].map(read));
  const require=(condition,message)=>{if(!condition)errors.push(message);};
  require(defaults.simulation.sceneRates.includes(defaults.simulation.speed),'默认速度必须在速度候选中');
  require(defaults.simulation.hour>=0&&defaults.simulation.hour<24,'默认时间必须在一天范围内');
  require(weather.presets[defaults.simulation.weather],'默认天气必须有对应预设');
  require(camera.views[camera.initialView],'初始视角必须有对应相机配置');
  require(rendering.qualityOptions.some(option=>option.value===rendering.defaultQuality),'默认画质必须存在');
  const ids=new Set();
  for(const track of music.tracks){
    require(track.id&&!ids.has(track.id),`曲目ID重复或缺失: ${track.id}`);ids.add(track.id);
    require(typeof track.title==='string'&&track.title.length>0,`曲目缺少标题: ${track.id}`);
    require(typeof track.file==='string'&&!track.file.includes('/')&&!track.file.includes('..'),`曲目文件名不合法: ${track.id}`);
    require(await exists(resolve(root,'src/assets/music',track.file)),`曲目文件不存在: ${track.file}`);
  }
  require(ids.has(music.playlists.sunset.trackId),'日落曲目必须存在于曲库');
  require(ids.has(music.playback.defaultTrackId),'默认曲目必须存在于曲库');
  require(music.playback.modes.some(mode=>mode.id===music.playback.defaultMode),'默认播放方式必须存在');
  require(loading.messages.length>1&&new Set(loading.messages).size===loading.messages.length,'加载提示需有多句且不重复');
  require(notes.currentVersion===pkg.version,'版本配置与package.json不一致');
  require(notes.versions[0]?.version===notes.currentVersion,'版本记录首项必须是当前版本');
  for(let i=1;i<notes.versions.length;i++){
    const version=value=>value.split('.').reduce((sum,part)=>sum*1000+Number(part),0);
    require(version(notes.versions[i-1].version)>version(notes.versions[i].version),'版本记录必须按版本倒序且不重复');
  }
  return {files:sourceFiles.length,tracks:ids.size,errors:[...errors]};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const result=await checkProject();
  if(result.errors.length){console.error(result.errors.join('\n'));process.exitCode=1;}
  else console.log(`资源与配置检查通过：${result.files} 个文件，${result.tracks} 首音乐。`);
}
