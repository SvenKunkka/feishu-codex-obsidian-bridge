import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname,join,delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readBridgeConfig,childProcessEnv,expandHomePath } from '../runtime/config.mjs';
import { createFeishuWiki } from '../runtime/feishu-wiki.mjs';
import { createSocialLinkCollector } from '../runtime/social-link-collector.mjs';

test('portable defaults keep notes, private state and upstream profile outside the checkout',()=>{
  const homeDir='/home/example-user';const config=readBridgeConfig({env:{},homeDir});
  assert.equal(config.vaultDir,join(homeDir,'Documents','Feishu-WIKI'));
  assert.equal(config.stateDir,join(homeDir,'.local','share','feishu-codex-obsidian-bridge'));
  assert.equal(config.larkChannelHome,join(config.stateDir,'lark-channel'));
  assert.notEqual(config.larkChannelHome,join(homeDir,'.lark-channel'));
  assert.equal(config.rulesPath,fileURLToPath(new URL('../skills/personal-feishu-assistant/SKILL.md',import.meta.url)));
  assert.equal(config.profile,'codex');
  assert.equal(config.browserUseBin,'browser-use');assert.equal(config.codexBin,'codex');assert.equal(config.ytDlpBin,'yt-dlp');assert.equal(config.curlBin,'curl');
  assert.equal(config.summaryModel,'gpt-5.6-sol');assert.equal(config.summaryEffort,'medium');
});

test('explicit paths, binary locations and summary settings override every default',()=>{
  const homeDir='/home/example-user';
  const env={FEISHU_WIKI_VAULT:'~/Notes/My Vault',FEISHU_WIKI_STATE_DIR:'~/Private State',LARK_CHANNEL_HOME:'~/Separate Profile',FEISHU_WIKI_RULES:'~/Rules/personal.md',BROWSER_USE_BIN:'~/Tools/browser-use',CODEX_BIN:'/opt/custom tool/codex',YTDLP_BIN:'yt-dlp-custom',CURL_BIN:'curl-custom',FEISHU_SUMMARY_MODEL:'example-model',FEISHU_SUMMARY_EFFORT:'high'};
  const config=readBridgeConfig({env,homeDir});
  assert.equal(config.vaultDir,join(homeDir,'Notes','My Vault'));assert.equal(config.stateDir,join(homeDir,'Private State'));
  assert.equal(config.larkChannelHome,join(homeDir,'Separate Profile'));assert.equal(config.rulesPath,join(homeDir,'Rules','personal.md'));
  assert.equal(config.browserUseBin,join(homeDir,'Tools','browser-use'));assert.equal(config.codexBin,'/opt/custom tool/codex');
  assert.equal(config.ytDlpBin,'yt-dlp-custom');assert.equal(config.curlBin,'curl-custom');assert.equal(config.summaryModel,'example-model');assert.equal(config.summaryEffort,'high');
});

test('child process PATH preserves caller precedence and unrelated environment',()=>{
  const original={PATH:['/custom/bin','/usr/bin'].join(delimiter),EXAMPLE_SETTING:'retained'};
  const env=childProcessEnv({env:original,homeDir:'/home/example-user',platform:'darwin'});
  assert.deepEqual(env.PATH.split(delimiter).slice(0,2),['/custom/bin','/usr/bin']);
  assert.equal(env.PATH.split(delimiter).filter(part=>part==='/usr/bin').length,1);
  assert.ok(env.PATH.split(delimiter).includes('/home/example-user/.local/bin'));
  assert.equal(env.EXAMPLE_SETTING,'retained');
  assert.equal(env.LARK_CHANNEL_HOME,'/home/example-user/.local/share/feishu-codex-obsidian-bridge/lark-channel');
  assert.equal(original.LARK_CHANNEL_HOME,undefined,'configuration reading must not mutate the caller environment');
  assert.equal(expandHomePath('$HOME/literal','/home/example-user'),'$HOME/literal','paths are never evaluated as shell code');
});

test('Wiki and collector use the same explicit isolated vault and state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'public-bridge-config-'));
  const vaultDir=join(root,'vault');const stateDir=join(root,'state');const rulesPath=join(root,'rules.md');
  await writeFile(rulesPath,'Isolated fixture rules.');let wiki,collector;
  t.after(async()=>{collector?.close();await wiki?.close();await rm(root,{recursive:true,force:true});});
  wiki=await createFeishuWiki({vaultDir,stateDir,rulesPath,watch:false,quiet:true});
  collector=await createSocialLinkCollector({vaultDir,stateDir});
  assert.equal(wiki.vaultDir,vaultDir);assert.equal(wiki.dbPath,join(stateDir,'index.db'));
  assert.equal(await wiki.getInstructions(),'Isolated fixture rules.');assert.deepEqual(collector.store.listSources(),[]);
});

test('local ~/ links expand against the current users home in an isolated child without opening anything',async t=>{
  const home=await mkdtemp(join(tmpdir(),'public-bridge-home-'));const file=join(home,'Documents','sample.md');
  await mkdir(dirname(file),{recursive:true});await writeFile(file,'Fixture document.');t.after(()=>rm(home,{recursive:true,force:true}));
  const moduleUrl=new URL('../runtime/local-file-open.mjs',import.meta.url).href;
  const source='import {handleLocalOpenRequest} from '+JSON.stringify(moduleUrl)+'; console.log(JSON.stringify(await handleLocalOpenRequest("~/Documents/sample.md",{dryRun:true})));';
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(result.status,0,result.stderr);const parsed=JSON.parse(result.stdout);
  assert.deepEqual(parsed.resolved,[file]);assert.deepEqual(parsed.opened,[]);
});
