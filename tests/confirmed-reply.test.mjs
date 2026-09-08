// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendExactConfirmedReply } from '../runtime/confirmed-reply.mjs';

test('exact approved answers only contain the current corrected answer, never old specifications', async () => {
  const current={exact:true,path:'/vault/X9.md',answer:'X9 换电版：11g 青色、13g 棕色。',modelScope:''};
  const sent=[], cleaned=[];
  const ok=await sendExactConfirmedReply({wiki:{search:async()=>[current]},question:'X9配重是什么',matches:[current],
    msg:{messageId:'m',chatId:'c'},channel:{send:async(...args)=>sent.push(args)},eligible:true,recalled:()=>false,
    addWorkingReaction:()=>Promise.resolve('r'),scheduleWorkingReactionCleanup:(...args)=>cleaned.push(args)});
  assert.equal(ok,true);assert.equal(sent.length,1);assert.match(sent[0][1].markdown,/11g 青色、13g 棕色/);
  assert.doesNotMatch(sent[0][1].markdown,/四种|12g|14g/);assert.equal(cleaned.length,1);
});
test('an invalidated answer cannot be sent from a previously fetched match', async () => {
  const current={exact:true,path:'/vault/X9.md',answer:'old'}; let sent=0;
  const ok=await sendExactConfirmedReply({wiki:{search:async()=>[]},question:'X9配重',matches:[current],msg:{},
    channel:{send:async()=>sent++},eligible:true,recalled:()=>false});
  assert.equal(ok,false);assert.equal(sent,0);
});
