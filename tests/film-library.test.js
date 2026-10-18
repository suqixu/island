import test from 'node:test';
import assert from 'node:assert/strict';
import preset from '../src/assets/data/films/isola-four-seasons.json' with {type:'json'};
const api=await import('../src/film-library.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('项目目录新增脚本自动形成播放列表，坏脚本不影响其他影片',()=>{assert.equal(typeof api.createFilmLibrary,'function');const other=structuredClone(preset);other.title='另一部海岛';const library=api.createFilmLibrary({'./films/a.json':preset,'./films/b.json':other,'./films/bad.json':{schemaVersion:99}});assert.equal(library.films.length,2);assert.deepEqual(library.films.map(f=>f.script.title),['浮屿 · 四时一日','另一部海岛']);assert.equal(library.errors.length,1);assert.equal(library.errors[0].id,'bad');assert.ok(library.errors[0].message);});
test('原始文本逐片校验，JSON语法错误和超限脚本均隔离',()=>{
  const library=api.createFilmLibrary({'a.json':JSON.stringify(preset),'broken.json':'{"title":"少了逗号" "duration":45}','large.json':' '.repeat(1024*1024+1)});
  assert.equal(library.films.length,1);assert.deepEqual(library.errors.map(e=>e.id),['broken','large']);
});
