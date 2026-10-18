import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProject} from '../scripts/maintenance/check-project.mjs';

test('分类后的源码与验收页引用实际资源，配置默认值和当前版本彼此一致',async()=>{
  const report=await checkProject();
  assert.deepEqual(report.errors,[]);
  assert.ok(report.tracks>=12);
});
