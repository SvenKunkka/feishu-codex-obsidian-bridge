// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSocialLinkCollector } from '../runtime/social-link-collector.mjs';
import { createSocialStore } from '../runtime/social-store.mjs';
import { createFeishuWiki } from '../runtime/feishu-wiki.mjs';
import { createSocialMessageHandler } from '../runtime/social-bridge.mjs';
import { parseSocialNote } from '../runtime/social-note.mjs';
import { refreshReviewControl } from '../runtime/review-controls.mjs';

test('message to note, human correction, stats, metric refresh and invalidation compose correctly', async t => {
  const root=await mkdtemp(join(tmpdir(),'social-flow-'));const vaultDir=join(root,'vault'),stateDir=join(root,'state');
  await mkdir(vaultDir);const store=createSocialStore({stateDir});
  const wiki=await createFeishuWiki({vaultDir,stateDir,watch:false,quiet:true});
  let fetches=0;
  const collector=await createSocialLinkCollector({vaultDir,stateDir,store,
    fetchPlatform:async()=>({title:'X9 配重测试资料',canonicalUrl:'https://example.org/x9',body:'验收原始资料曾列出四种配重规格：11g、12g、13g和14g。此为人工校正保护测试用文本，不是产品事实。',contentRoot:true,status:'complete',metrics:{likes:{value:++fetches*10,raw:String(fetches*10),source:'dom:likes'}}}),
    summarizer:async()=>({summary:'验收样本暂列四种配重，待本人校正。',keyPoints:[],tags:['X9','配重']})});
  t.after(async()=>{collector.close();await wiki.close();store.close();await rm(root,{recursive:true,force:true});});
  const sent=[],cleaned=[];
  const handler=createSocialMessageHandler({collector,store,wiki,ownerCheck:()=>true,
    addReaction:async()=> 'reaction',cleanupReaction:(_input,p)=>cleaned.push(p)});
  const message=content=>({msg:{content,messageId:'fixture-'+sent.length,chatId:'fixture',senderId:'owner',chatType:'p2p'},
    controls:{profile:'codex'},channel:{send:async(_id,msg)=>{sent.push(msg.markdown);return {messageId:'out-'+sent.length}}},socialAbortByMessageId:new Map()});
  assert.equal((await handler(message('https://example.org/x9'))).handledOnly,true);
  assert.match(sent[0] || '', /^✓ 已保存/, `首条收藏没有成功回执：${JSON.stringify(sent)}`);
  const source=store.listSources()[0];assert.ok(source?.path, `收藏未登记来源：${JSON.stringify(sent)}`);
  assert.equal((await wiki.search('X9 配重')).length,0);
  let raw=await readFile(source.path,'utf8');assert.equal(parseSocialNote(raw).checked,false);
  raw=raw.replace('验收样本暂列四种配重，待本人校正。','已校正：11g 青色、13g 棕色。');
  await writeFile(source.path,raw);await wiki.flushChanges([source.path]);
  await writeFile(source.path,raw.replace('- [ ] 已确认','- [x] 已确认'));await wiki.flushChanges([source.path]);
  const matches=await wiki.search('X9 配重');assert.equal(matches.length,1);assert.match(matches[0].answer,/11g 青色/);assert.doesNotMatch(matches[0].answer,/12g|14g|四种/);
  const before=await readFile(source.path,'utf8');await handler(message('https://example.org/x9'));
  assert.equal(fetches,1);assert.equal(await readFile(source.path,'utf8'),before);
  await handler(message('这周收藏了多少篇'));assert.match(sent.at(-1),/1/);
  const analysis=await handler(message('结合这些收藏，帮我写一份竞品分析'));
  assert.match(analysis.enrichedContent,/11g 青色/);assert.doesNotMatch(analysis.enrichedContent,/12g|14g|四种/);analysis.finishReaction();
  await handler(message('刷新互动数据 https://example.org/x9'));
  assert.equal(fetches,2);const comparison=store.compareMetrics(source.sourceKey);assert.equal(comparison.snapshotCount,2);assert.equal(comparison.metrics.likes.delta,10);
  raw=await readFile(source.path,'utf8');assert.match(raw,/11g 青色/);assert.equal(parseSocialNote(raw).checked,true);assert.equal((await wiki.reviewStatus(source.path)).confirmed,true);
  await writeFile(source.path,raw.replace('11g 青色','11g 橙色'));
  await wiki.flushChanges([source.path]);assert.equal((await wiki.search('X9 配重')).length,0);
  await refreshReviewControl(source.path,wiki);
  raw=await readFile(source.path,'utf8');assert.equal(parseSocialNote(raw).checked,false);assert.match(raw,/审核提示/);
  await writeFile(source.path,raw.replace('- [ ] 已确认','- [x] 已确认'));await wiki.flushChanges([source.path]);
  await refreshReviewControl(source.path,wiki);assert.equal((await wiki.reviewStatus(source.path)).confirmed,true);
  assert.doesNotMatch(await readFile(source.path,'utf8'),/审核提示/);
  assert.ok(cleaned.length>=5);
});
