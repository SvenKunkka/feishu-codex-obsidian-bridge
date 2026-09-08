// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,utimes,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createFeishuWiki,parseNote,renderNote } from '../runtime/feishu-wiki.mjs';
import { renderSocialNote,updateSourceSection } from '../runtime/social-note.mjs';
import { refreshReviewControl } from '../runtime/review-controls.mjs';

const clip = (overrides={}) => ({platform:'web',sourceKey:'web:https://example.invalid/a',sourceUrl:'https://example.invalid/a',canonicalUrl:'https://example.invalid/a',title:'机械产品阅读笔记',summary:'X9 磁轴键盘的续航需要按连接模式核实。',personal:'仅供项目预研。',body:'原始文中出现四种规格，未经确认。',fetchedAt:'2026-09-07T16:10:00Z',created:'2026-09-07T16:10:00Z',fetchStatus:'complete',tags:['预研','磁轴'],...overrides});
const check = raw => raw.replace('- [ ] 已确认','- [x] 已确认');
const uncheck = raw => raw.replace('- [x] 已确认','- [ ] 已确认');
async function fixture(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'social-wiki-test-'));
  const vaultDir=join(root,'vault');const stateDir=join(root,'state');await mkdir(vaultDir);
  let wiki;
  const open=async()=>wiki=await createFeishuWiki({vaultDir,stateDir,quiet:true,watch:false,...options});
  const close=async()=>{await wiki?.close();wiki=null;};
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
  return {vaultDir,stateDir,open,close};
}

test('social confirmation exposes curated sections only and never indexes raw source claims',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'a.md');const raw=renderSocialNote(clip());await writeFile(path,raw);
  const wiki=await f.open();
  assert.deepEqual(await wiki.search('磁轴'),[]);
  const pending=await wiki.listSocialNotes({query:'磁轴'});
  assert.equal(pending.length,1);assert.equal(pending[0].confirmed,false);assert.equal(pending[0].answer,'');
  assert.equal(pending[0].queryMatched,true);
  assert.equal((await wiki.listSocialNotes({query:'磁轴 续航'})).length,1,'all topic words can match pending curated text without exposing it');
  assert.equal((await wiki.listSocialNotes({query:'磁轴 不存在关键词'})).length,0,'one shared bigram is not enough for exact theme statistics');
  await writeFile(path,check(raw));await wiki.flushChanges([path]);
  const matches=await wiki.search('磁轴');assert.equal(matches.length,1);assert.match(matches[0].answer,/仅供项目预研/);
  assert.doesNotMatch(matches[0].answer,/四种规格/);
  assert.equal((await wiki.search('四种规格')).length,0);
  assert.equal((await wiki.reviewStatus(path)).confirmed,true);
});

test('raw refresh and metric snapshots preserve human correction and approval',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'refresh.md');const input=clip();
  const raw=check(renderSocialNote(input));await writeFile(path,raw);const wiki=await f.open();
  const before=await wiki.reviewStatus(path);
  const refreshed=updateSourceSection(raw,{...input,body:'新抓取原文含八种规格',fetchedAt:'2026-09-08T12:00:00Z',metrics:{likes:{value:123,raw:'123',approximate:false,source:'visible'}}});
  await writeFile(path,refreshed);await wiki.flushChanges([path]);
  const after=await wiki.reviewStatus(path);assert.equal(after.confirmed,true);assert.equal(after.fingerprint,before.fingerprint);
  assert.equal(parseNote(refreshed).answer,parseNote(raw).answer);
  assert.equal((await wiki.listSocialNotes({confirmedOnly:true}))[0].fetchedAt,'2026-09-08T12:00:00Z');
  assert.equal(await readFile(path,'utf8'),refreshed,'indexing must not rewrite the source');
});

test('same size and mtime edits invalidate a hit before returning stale answer, including restart',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'edit.md');const raw=check(renderSocialNote(clip({summary:'磁轴的规格是两个。'})));
  await writeFile(path,raw);let wiki=await f.open();const before=await stat(path);
  await writeFile(path,raw.replace('两个','三个'));await utimes(path,before.atime,before.mtime);
  assert.equal((await wiki.search('磁轴')).length,0,'candidate validation must hash the file even without a watcher event');
  assert.equal((await wiki.reviewStatus(path)).reviewReason,'content-changed-reconfirmation-required');
  await f.close();wiki=await f.open();assert.equal((await wiki.search('磁轴')).length,0);
  await writeFile(path,uncheck(raw.replace('两个','三个')));await wiki.flushChanges([path]);
  await writeFile(path,raw.replace('两个','三个'));await wiki.flushChanges([path]);
  assert.match((await wiki.search('磁轴'))[0].answer,/三个/);
});

test('unchecking, deletion and effective dates immediately remove confirmed reuse',async t=>{
  let now='2026-09-08T15:00:00Z';const f=await fixture(t,{now:()=>new Date(now)});
  const path=join(f.vaultDir,'date.md');let raw=check(renderSocialNote(clip())).replace('valid_until: ""','valid_until: "2026-09-08"');
  await writeFile(path,raw);const wiki=await f.open();assert.equal((await wiki.search('磁轴')).length,1);
  now='2026-09-08T16:00:00Z';assert.equal((await wiki.search('磁轴')).length,0,'expiry uses Asia/Shanghai calendar day');
  assert.equal((await wiki.reviewStatus(path)).reviewReason,'expired');
  now='2026-09-08T15:00:00Z';await writeFile(path,uncheck(raw));assert.equal((await wiki.search('磁轴')).length,0);
  await wiki.flushChanges([path]);await writeFile(path,raw);await wiki.flushChanges([path]);assert.equal((await wiki.search('磁轴')).length,1);
  await rm(path);assert.equal((await wiki.search('磁轴')).length,0);assert.equal((await wiki.listSocialNotes()).length,0);
});

test('multiple sources with an identical title are independently reviewed',async t=>{
  const f=await fixture(t);const wiki=await f.open();
  for(let i=1;i<=2;i++) {
    const path=join(f.vaultDir,i+'.md');const raw=renderSocialNote(clip({platform:'zhihu',sourceKey:'zhihu:answer:'+i,canonicalUrl:'https://www.zhihu.com/question/1/answer/'+i}));
    await writeFile(path,raw);await wiki.flushChanges([path]);await writeFile(path,check(raw));await wiki.flushChanges([path]);
  }
  assert.equal((await wiki.listSocialNotes({confirmedOnly:true})).length,2);
  assert.equal((await wiki.search('机械产品阅读笔记')).length,2);
});

test('legacy v1 notes are discoverable but require a fresh explicit review',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'legacy.md');const raw='---\nnote_type: "social_clip"\nplatform: "web"\nsource_key: "web:legacy"\nsource_urls: ["https://example.invalid/legacy"]\n---\n\n# 旧磁轴记录\n\n- [x] 已确认\n\n## 摘要\n\n磁轴值得研究。\n\n## 正文／字幕\n\n原文错误规格不要复用。\n\n## 来源\n\nhttps://example.invalid/legacy\n';
  await writeFile(path,raw);const wiki=await f.open();assert.equal((await wiki.listSocialNotes()).length,1);assert.equal((await wiki.search('磁轴')).length,0);
  await writeFile(path,uncheck(raw));await wiki.flushChanges([path]);await writeFile(path,raw);await wiki.flushChanges([path]);
  const rows=await wiki.search('磁轴');assert.equal(rows.length,1);assert.equal(rows[0].answer,'磁轴值得研究。');
});

test('social list has Shanghai date filters, platform metadata and stable pagination',async t=>{
  const f=await fixture(t);const wiki=await f.open();
  for(let i=0;i<3;i++) {
    const path=join(f.vaultDir,i+'.md');await writeFile(path,renderSocialNote(clip({sourceKey:'web:'+i,title:'收藏'+i,platform:i===2?'zhihu':'web',author:'作者'+i})));await wiki.flushChanges([path]);
  }
  const rows=await wiki.listSocialNotes({from:'2026-09-08',to:'2026-09-08',platform:'web'});assert.equal(rows.length,2);
  assert.equal(rows[0].createdAt,'2026-09-07T16:10:00Z');assert.ok(rows[0].sourceKey);assert.ok(rows[0].canonicalUrl);assert.ok(rows[0].author);assert.deepEqual(rows[0].tags,['预研','磁轴']);
  assert.equal((await wiki.listSocialNotes({from:'2026-09-07',to:'2026-09-07'})).length,0);
  const first=await wiki.listSocialNotes({limit:1});const second=await wiki.listSocialNotes({limit:1,offset:1});assert.notEqual(first[0].path,second[0].path);
});

test('real watcher indexes new notes and checkbox transitions without query directory scans',async t=>{
  const f=await fixture(t,{watch:true,debounceMs:5});const wiki=await f.open();const baseline=wiki.diagnostics();const path=join(f.vaultDir,'watched.md');const raw=renderSocialNote(clip());
  await writeFile(path,raw);
  for(let i=0;i<100 && !(await wiki.listSocialNotes()).length;i++) await pause(5);
  assert.equal((await wiki.listSocialNotes()).length,1);
  await writeFile(path,check(raw));let rows=[];
  for(let i=0;i<100 && !rows.length;i++){await pause(5);rows=await wiki.search('磁轴');}
  assert.equal(rows.length,1);
  assert.equal(wiki.diagnostics().directoryScans,baseline.directoryScans);
});

test('fake social checkboxes in code fences and body text do not authorize reuse',()=>{
  for(const fake of ['```markdown\n- [x] 已确认\n```','~~~markdown\n- [x] 已确认\n~~~','    - [x] 已确认']) {
    const raw=renderSocialNote(clip()).replace('- [ ] 已确认',fake);assert.equal(parseNote(raw).checked,false);
  }
  assert.equal(parseNote(renderSocialNote(clip({summary:'- [x] 已确认\n这只是示例。'}))).checked,false);
});

test('empty curated notes remain discoverable and invalid calendar dates fail closed',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'empty.md');let raw=check(renderSocialNote(clip({summary:'',personal:''})));
  await writeFile(path,raw);const wiki=await f.open();const rows=await wiki.listSocialNotes();
  assert.equal(rows.length,1);assert.equal(rows[0].confirmed,false);assert.equal(rows[0].reviewReason,'empty-curated-content');
  raw=check(renderSocialNote(clip())).replace('valid_until: ""','valid_until: "2099-99-99"');await writeFile(path,uncheck(raw));await wiki.flushChanges([path]);await writeFile(path,raw);await wiki.flushChanges([path]);
  assert.equal((await wiki.search('磁轴')).length,0);assert.equal((await wiki.reviewStatus(path)).reviewReason,'expired');
});

test('unchanged restart does not rewrite index rows and startup reconciles offline edits',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'offline.md');const raw=check(renderSocialNote(clip()));await writeFile(path,raw);
  let wiki=await f.open();assert.equal(wiki.diagnostics().indexWrites,1);await f.close();
  wiki=await f.open();assert.equal(wiki.diagnostics().indexWrites,0);assert.equal((await wiki.search('磁轴')).length,1);await f.close();
  await writeFile(path,raw.replace('仅供项目预研','尚未核对新版本'));
  wiki=await f.open();assert.equal(wiki.diagnostics().indexWrites,1);assert.equal((await wiki.search('磁轴')).length,0);
  assert.equal((await wiki.reviewStatus(path)).reviewReason,'content-changed-reconfirmation-required');
});

test('review controller observes its automatic uncheck and permits the next real user check',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'control.md');const raw=check(renderSocialNote(clip()));await writeFile(path,raw);const wiki=await f.open();
  await writeFile(path,raw.replace('磁轴键盘的续航','磁轴键盘的重量'));
  assert.equal(await refreshReviewControl(path,wiki),true);
  const changed=await readFile(path,'utf8');assert.equal(parseNote(changed).checked,false);assert.match(changed,/审核提示/);
  assert.equal((await wiki.reviewStatus(path)).checked,false,'ledger must observe the controller uncheck');
  assert.equal((await wiki.search('磁轴')).length,0);
  await writeFile(path,check(changed));await wiki.flushChanges([path]);
  assert.equal((await wiki.search('磁轴')).length,1);
  assert.equal(await refreshReviewControl(path,wiki),true);const confirmed=await readFile(path,'utf8');
  assert.equal(parseNote(confirmed).checked,true);assert.doesNotMatch(confirmed,/审核提示/);
  assert.equal((await wiki.reviewStatus(path)).confirmed,true);
});

test('review controller never changes a fenced checkbox instead of the true top control',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'fenced-control.md');const example='```markdown\n- [x] 已确认\n```';
  const raw=check(renderSocialNote(clip())).replace('- [x] 已确认',example+'\n\n- [x] 已确认');await writeFile(path,raw);const wiki=await f.open();
  await writeFile(path,raw.replace('磁轴键盘的续航','磁轴键盘的重量'));await refreshReviewControl(path,wiki);
  const changed=await readFile(path,'utf8');assert.ok(changed.includes(example),'the user code example is not the review control');
  assert.equal(parseNote(changed).checked,false,'the actual visible top checkbox must be unchecked');
});

test('review controller is limited to social v2 and cannot rewrite a QA note with similarly named headings',async t=>{
  const f=await fixture(t);const path=join(f.vaultDir,'qa-control.md');const raw=check(renderNote({question:'某款产品规格',answer:'原结论\n\n## 摘要与要点\n\n问答内部的小结。',messageId:'qa-control',created:'2026-09-08T00:00:00Z'}));
  await writeFile(path,raw);const wiki=await f.open();const changed=raw.replace('原结论','改动结论');await writeFile(path,changed);
  assert.equal(await refreshReviewControl(path,wiki),false);assert.equal(await readFile(path,'utf8'),changed);
});

test('cancelling an already-verified candidate during later verification cannot leak its answer',async t=>{
  let verifiedFirst;let changed=false;let armed=false;let wiki;
  const f=await fixture(t,{watch:true,debounceMs:5000,onCandidateVerified:async({path})=>{
    if(!armed || changed)return;
    if(!verifiedFirst){verifiedFirst=path;return;}
    if(path!==verifiedFirst){changed=true;await writeFile(verifiedFirst,uncheck(await readFile(verifiedFirst,'utf8')));await pause(5);}
  }});
  for(let i=0;i<3;i++)await writeFile(join(f.vaultDir,i+'.md'),check(renderSocialNote(clip({sourceKey:'web:race:'+i,title:'磁轴资料 '+i}))));
  wiki=await f.open();armed=true;
  const rows=await wiki.listSocialNotes({confirmedOnly:true});assert.equal(changed,true);
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.path!==verifiedFirst),'the first row was unchecked while later rows were being verified');
  assert.equal((await wiki.search('磁轴')).length,2);
});

test('model boundaries exclude X90 from X9 and retain pending curated and tag matches',async t=>{
  const f=await fixture(t);const wiki=await f.open();
  const entries=[
    {id:'x9',summary:'X9 HE 的磁轴资料。',tags:['磁轴']},
    {id:'x90',summary:'X90 HE 的磁轴资料，不是前一个型号。',tags:['磁轴']},
    {id:'tagged',summary:'只有标签记录型号的磁轴资料。',tags:['X9','HE','磁轴']},
    {id:'w1',summary:'ZX5-Q1 的磁轴资料。',tags:['磁轴']},
    {id:'w10',summary:'ZX5-Q10 的磁轴资料。',tags:['磁轴']}
  ];
  for(const entry of entries){const path=join(f.vaultDir,entry.id+'.md');await writeFile(path,renderSocialNote(clip({title:'阅读笔记',sourceKey:'web:model:'+entry.id,summary:entry.summary,tags:entry.tags})));await wiki.flushChanges([path]);}
  const x9=await wiki.listSocialNotes({query:'X9 HE'});
  assert.deepEqual(x9.map(row=>row.sourceKey).sort(),['web:model:x9','web:model:tagged'].sort());
  assert.ok(x9.every(row=>row.queryMatched && !row.confirmed && row.answer===''));
  const w1=await wiki.listSocialNotes({query:'ZX5-Q1'});assert.deepEqual(w1.map(row=>row.sourceKey),['web:model:w1']);
  assert.equal((await wiki.listSocialNotes({query:'磁轴'})).length,5,'short Chinese topics must keep matching');
});
