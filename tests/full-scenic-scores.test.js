import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scores=JSON.parse(readFileSync(new URL('../scripts/scenic-scores.json',import.meta.url),'utf8'));
for(const [id,bars,beats,pages,lastNote] of [['molihua',37,148,2,'C5'],['yueer',61,122,3,'C4']]){
  test(`${id} 使用全部谱页及规定反复，完整旋律抵达结尾`,()=>{
    const score=scores.find(value=>value.id===id);
    assert.equal(score.coverage,'full');
    assert.equal(score.sourcePages.length,pages);
    assert.equal(score.form.reduce((total,section)=>total+section.bars*section.repeat,0),bars);
    assert.equal(score.beats,beats,'不能以主题片段重复加停顿替代完整曲式');
    const lead=score.parts[0].notes;
    assert.equal(lead.reduce((total,[,length])=>total+length,0),beats);
    assert.equal(lead.findLast(([name])=>name!=='R')[0],lastNote);
    for(const part of score.parts){
      assert.ok((part.start??0)+part.notes.reduce((total,[,length])=>total+length,0)<=beats);
    }
  });
}
test('茉莉花减速发生在谱面第22小节，而不是全曲改变速度',()=>{
  const score=scores.find(value=>value.id==='molihua');
  assert.equal(score.bpm,80);
  assert.deepEqual(score.tempoChanges,[{beat:136,bpm:61}]);
});
