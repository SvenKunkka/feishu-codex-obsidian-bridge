// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFeishuWiki,renderNote} from '../runtime/feishu-wiki.mjs';

test('1500-note lookup reads only hits and incremental changes, including long body short Chinese matches',async t=>{
  const root=await mkdtemp(join(tmpdir(),'wiki-perf-'));const vaultDir=join(root,'vault');const stateDir=join(root,'state');await mkdir(vaultDir);let wiki;
  t.after(async()=>{await wiki?.close();await rm(root,{recursive:true,force:true});});
  await Promise.all(Array.from({length:1500},(_,i)=>writeFile(join(vaultDir,i+'.md'),renderNote({question:'普通型号规格记录 '+i,answer:'用于批量隔离索引性能样本，仅作为测试资料。',messageId:'perf-'+i,created:'2026-09-08T00:00:00Z'}).replace('- [ ] 已确认','- [x] 已确认'))));
  const target=join(vaultDir,'target.md');const raw=renderNote({question:'独立测试目标资料',answer:'无关上下文。'.repeat(1500)+'\n型号 X9 的磁轴续航应独立核对。',messageId:'perf-target',created:'2026-09-08T00:00:00Z'}).replace('- [ ] 已确认','- [x] 已确认');await writeFile(target,raw);
  wiki=await createFeishuWiki({vaultDir,stateDir,watch:false,quiet:true});const before=wiki.diagnostics();const start=performance.now();
  for(let i=0;i<10;i++){const rows=await wiki.search('磁轴');assert.equal(rows.length,1);assert.equal(rows[0].path,target);}
  const after=wiki.diagnostics();assert.equal(after.directoryScans,before.directoryScans);assert.equal(after.indexWrites,before.indexWrites);
  assert.equal(after.filesRead-before.filesRead,10,'ten queries hash ten returned candidate files, not the whole vault');
  assert.ok(performance.now()-start<2000,'ten indexed short-topic lookups should be comfortably subsecond on a local SSD (2 s CI margin)');
  const rows=await wiki.search('X9');assert.equal(rows.length,1);assert.equal(rows[0].path,target);
  await writeFile(target,raw.replace('磁轴续航','磁轴重量'));await wiki.flushChanges([target]);
  const changed=wiki.diagnostics();assert.equal(changed.directoryScans,before.directoryScans);assert.equal(changed.indexWrites-before.indexWrites,1);
  assert.equal((await wiki.search('磁轴')).length,0,'changed formerly approved body is invalidated');
});
