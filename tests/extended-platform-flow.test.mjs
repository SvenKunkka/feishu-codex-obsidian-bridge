// All URLs, identities, authors and figures are synthetic; no browser or service is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  platformForUrl, canonicalizeUrl, sourceKeyFor, validateCapturedIdentity,
  createSocialLinkCollector
} from '../runtime/social-link-collector.mjs';
import { renderSocialNote, parseSocialNote, updateSourceSection } from '../runtime/social-note.mjs';
import { createSocialStore } from '../runtime/social-store.mjs';
import { createFeishuWiki } from '../runtime/feishu-wiki.mjs';
import { parseSocialIntent, handleSocialCommand } from '../runtime/social-commands.mjs';

const cases = [
  { platform: 'wechat', label: '微信公众号',
    oldUrl: 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ_A&mid=900001&idx=1&sn=fixture_signature&scene=27',
    url: 'https://mp.weixin.qq.com/s?idx=1&mid=900001&__biz=TEST_BIZ_A&scene=25&sn=fixture_signature',
    platformData: { account: { label: '公众号', raw: 'METADATA_ONLY_SYNTHETIC_ACCOUNT', source: 'fixture:wechat:account' } } },
  { platform: 'github', label: 'GitHub',
    oldUrl: 'https://github.com/Example-Org/Example-Repo?utm_source=fixture',
    url: 'https://github.com/example-org/example-repo/',
    platformData: { stars: { label: 'Stars', raw: 'METADATA_ONLY_12.3k', source: 'fixture:github:stars' } } },
  { platform: 'kickstarter', label: 'Kickstarter',
    oldUrl: 'https://www.kickstarter.com/projects/example-maker/example-project?ref=fixture',
    url: 'https://www.kickstarter.com/projects/example-maker/example-project',
    platformData: { pledged: { label: 'Pledged', raw: 'METADATA_ONLY_USD_12345', source: 'fixture:kickstarter:pledged' } } },
  { platform: 'indiegogo', label: 'Indiegogo',
    oldUrl: 'https://www.indiegogo.com/projects/example-campaign/x/9000000001?utm_source=fixture',
    url: 'https://www.indiegogo.com/projects/example-campaign',
    platformData: { backers: { label: 'Backers', raw: 'METADATA_ONLY_321', source: 'fixture:indiegogo:backers' } } }
];
const noCommands = async () => { throw new Error('This integration fixture must not invoke a live command'); };
const approved = raw => raw.replace('- [ ] 已确认', '- [x] 已确认');
const markdownFiles = async dir => (await readdir(dir)).filter(name => name.endsWith('.md'));

// Deliberately reproduce v0.1's generic-web identity instead of calling the new
// canonicalizer: otherwise an accidental migration would make the fixture pass.
function oldWebIdentity(value) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|spm|from$|share_|share$|timestamp$|unique_k$|source$|feature$|si$|xsec_)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const canonicalUrl = url.href;
  return { canonicalUrl, sourceKey: `web:${createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 24)}` };
}

test('new platform names combine with time, topic and confirmation filters', () => {
  for (const item of [...cases, { platform: 'wechat', label: 'WeChat' }, { platform: 'indiegogo', label: 'indigogo' }]) {
    const intent = parseSocialIntent(`/收藏统计 本月 ${item.label} 合成键盘`, { now: new Date('2026-09-08T00:00:00Z') });
    assert.equal(intent.kind, 'stats', item.label);
    assert.equal(intent.platform, item.platform, item.label);
    assert.equal(intent.query, '合成键盘', item.label);
    assert.deepEqual([intent.period.from, intent.period.to], ['2026-09-01', '2026-09-08']);
    const pending = parseSocialIntent(`哪些 ${item.label} 收藏还没确认`);
    assert.equal(pending.platform, item.platform); assert.equal(pending.pendingOnly, true);
    assert.equal(pending.query, '', item.label);
  }
});

test('URL identity keeps new platforms and subpages distinct while discarding known tracking', () => {
  for (const item of cases) {
    assert.equal(platformForUrl(item.url), item.platform);
    assert.equal(sourceKeyFor(item.oldUrl), sourceKeyFor(item.url), item.platform);
  }
  assert.equal(sourceKeyFor('https://mp.weixin.qq.com/s?__biz=TEST_A&amp;mid=101&amp;idx=1&amp;scene=27'),
    sourceKeyFor('https://mp.weixin.qq.com/s?idx=1&__biz=TEST_A&mid=101&scene=25'));
  assert.equal(sourceKeyFor('https://www.kickstarter.com/projects/example-maker/example-project/description?ref=fixture'),
    sourceKeyFor('https://www.kickstarter.com/projects/example-maker/example-project'));
  const distinct = [
    ['https://mp.weixin.qq.com/s?__biz=TEST_A&mid=101&idx=1', 'https://mp.weixin.qq.com/s?__biz=TEST_B&mid=101&idx=1'],
    ['https://mp.weixin.qq.com/s?__biz=TEST_A&mid=101&idx=1', 'https://mp.weixin.qq.com/s?__biz=TEST_A&mid=101&idx=2'],
    ['https://mp.weixin.qq.com/s/TEST_SHORT_A', 'https://mp.weixin.qq.com/s/TEST_SHORT_B'],
    ['https://github.com/example-org/example-repo', 'https://github.com/example-org/example-repo/issues/1'],
    ['https://github.com/example-org/example-repo/issues/1', 'https://github.com/example-org/example-repo/issues/2'],
    ['https://github.com/example-org/example-repo/issues/1', 'https://github.com/example-org/example-repo/pull/1'],
    ['https://github.com/example-org/example-repo/blob/main/Readme.md', 'https://github.com/example-org/example-repo/blob/main/README.md'],
    ['https://github.com/example-org/example-repo/blob/feature/one/docs/A.md', 'https://github.com/example-org/example-repo/blob/feature/two/docs/A.md'],
    ['https://www.kickstarter.com/projects/example-maker/example-project', 'https://www.kickstarter.com/projects/example-maker/example-project/posts/9001'],
    ['https://www.kickstarter.com/projects/example-maker/example-project/posts/9001', 'https://www.kickstarter.com/projects/example-maker/example-project/posts/9002'],
    ['https://www.indiegogo.com/projects/example-campaign', 'https://www.indiegogo.com/projects/other-example-campaign'],
    ['https://www.indiegogo.com/projects/example-campaign#/story', 'https://www.indiegogo.com/projects/example-campaign#/updates/all'],
    ['https://www.indiegogo.com/projects/example-campaign#/updates/all', 'https://www.indiegogo.com/projects/example-campaign#/comments']
  ];
  for (const [a, b] of distinct) assert.notEqual(sourceKeyFor(a), sourceKeyFor(b), `${a} must not collapse into ${b}`);
});

test('same-platform redirects to a different article, issue or campaign fail identity validation', () => {
  const mismatches = [
    ['https://mp.weixin.qq.com/s/TEST_SHORT_A', 'https://mp.weixin.qq.com/s/TEST_SHORT_B'],
    ['https://mp.weixin.qq.com/s?__biz=TEST_A&mid=101&idx=1', 'https://mp.weixin.qq.com/s?__biz=TEST_A&mid=102&idx=1'],
    ['https://github.com/example-org/example-repo/issues/1', 'https://github.com/example-org/example-repo/issues/2'],
    ['https://www.kickstarter.com/projects/example-maker/example-project', 'https://www.kickstarter.com/projects/example-maker/example-project/posts/9001'],
    ['https://www.indiegogo.com/projects/example-campaign', 'https://www.indiegogo.com/projects/other-example-campaign']
  ];
  for (const [requested, wrong] of mismatches) {
    const captured = { url: wrong, canonicalUrl: wrong, identityUrls: [requested, wrong], contentRoot: true, title: 'Same synthetic title' };
    assert.throws(() => validateCapturedIdentity(requested, captured), /串页|身份|来源|不同|不一致|重定向|identity/i);
    assert.throws(() => validateCapturedIdentity(requested, { ...captured, url: requested }), /串页|身份|来源|不同|不一致|重定向|identity/i);
  }
});

test('Indiegogo SPA story, FAQ and post routes retain independent identities across hash spellings', () => {
  const base = 'https://www.indiegogo.com/projects/example-campaign';
  const routes = ['story', 'description', 'faq', 'faqs', 'updates/all', 'updates/9001', 'posts/9001',
    'comments', 'rewards', 'perks'];
  const keys = new Set([sourceKeyFor(base)]);
  for (const route of routes) {
    const canonical = `${base}#/${route}`, key = sourceKeyFor(canonical);
    assert.equal(keys.has(key), false, `${route} must not collapse into the root or another route`);
    keys.add(key);
    for (const hash of [`#/${route}`, `#!/${route}`, `#${route}`, `#!${route}`]) {
      const url = base + hash;
      assert.equal(sourceKeyFor(url), key, `${hash} must normalize to the same route`);
      assert.equal(canonicalizeUrl(url), canonicalizeUrl(canonical));
      assert.throws(() => validateCapturedIdentity(url, { url: base, canonicalUrl: base, contentRoot: true }),
        /串页|身份|来源|不同|不一致|重定向|identity/i, `${hash} must reject a project-root capture`);
    }
  }
  for (const [requested, wrong] of [
    [`${base}#/posts/9001`, `${base}#/posts/9002`],
    [`${base}#!/updates/9001`, `${base}#/updates/9002`],
    [`${base}#/faqs`, `${base}#/comments`]
  ]) {
    assert.notEqual(sourceKeyFor(requested), sourceKeyFor(wrong));
    assert.throws(() => validateCapturedIdentity(requested, { url: wrong, canonicalUrl: wrong, contentRoot: true }),
      /串页|身份|来源|不同|不一致|重定向|identity/i);
    assert.throws(() => validateCapturedIdentity(requested, { url: requested, canonicalUrl: wrong, contentRoot: true }),
      /串页|身份|来源|不同|不一致|重定向|identity/i);
  }
});

test('WeChat long/short aliases require current-page identity evidence, never matching titles alone', () => {
  const long = 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ_ALIAS&mid=900101&idx=1&scene=27';
  const short = 'https://mp.weixin.qq.com/s/TEST_ALIAS_A';
  const otherLong = 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ_ALIAS&mid=900102&idx=1';
  const proof = { url: short, canonicalUrl: long, contentRoot: true, identityUrls: [long], title: 'Identical synthetic title' };
  assert.equal(validateCapturedIdentity(long, proof), canonicalizeUrl(long));
  assert.equal(validateCapturedIdentity(short, proof), canonicalizeUrl(long));
  assert.throws(() => validateCapturedIdentity(long, { ...proof, identityUrls: [] }), /串页|来源|重定向|身份/);
  assert.throws(() => validateCapturedIdentity(long, { ...proof, contentRoot: false }), /串页|来源|重定向|身份/);
  assert.throws(() => validateCapturedIdentity(long, { ...proof, identityUrls: [otherLong] }), /串页|来源|重定向|身份/);
});

test('a proved WeChat final short URL remains a zero-fetch alias of the first long URL after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-wechat-alias-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); let collector, fetches = 0, summaries = 0;
  const long = 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ_ALIAS&mid=900101&idx=1&scene=27';
  const short = 'https://mp.weixin.qq.com/s/TEST_ALIAS_A';
  t.after(async () => { collector?.close(); await rm(root, { recursive: true, force: true }); });
  const open = async () => collector = await createSocialLinkCollector({ vaultDir, stateDir, runner: noCommands,
    fetchPlatform: async () => { fetches++; return { url: short, canonicalUrl: long, contentRoot: true, identityUrls: [long],
      title: 'Synthetic WeChat redirect', body: 'This is synthetic article content.', status: 'complete', metrics: {} }; },
    summarizer: async () => { summaries++; return { summary: 'Synthetic summary' }; } });
  await open();
  const first = await collector.collectFromMessage(long);
  assert.deepEqual(first.failed, []); assert.equal(first.saved.length, 1);
  const path = first.saved[0].path, key = first.saved[0].sourceKey, before = await readFile(path, 'utf8');
  const repeat = await collector.collectFromMessage(short);
  assert.deepEqual(repeat.failed, []); assert.equal(repeat.saved[0].reused, true);
  assert.equal(repeat.saved[0].path, path); assert.equal(repeat.saved[0].sourceKey, key);
  assert.deepEqual({ fetches, summaries }, { fetches: 1, summaries: 1 });
  assert.equal(await readFile(path, 'utf8'), before);
  collector.close(); collector = null; await open();
  const restarted = await collector.collectFromMessage(short);
  assert.deepEqual(restarted.failed, []); assert.equal(restarted.saved[0].path, path); assert.equal(restarted.saved[0].sourceKey, key);
  assert.deepEqual({ fetches, summaries }, { fetches: 1, summaries: 1 });
  assert.equal((await markdownFiles(vaultDir)).length, 1);
});

test('a legacy web note saved under a WeChat short URL wins over a newly discovered long canonical identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-wechat-legacy-short-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); await mkdir(vaultDir);
  const long = 'https://mp.weixin.qq.com/s?__biz=TEST_BIZ_LEGACY&mid=900201&idx=1';
  const short = 'https://mp.weixin.qq.com/s/TEST_LEGACY_SHORT';
  const identity = oldWebIdentity(short), path = join(vaultDir, 'legacy-short-web.md');
  const before = approved(renderSocialNote({ platform: 'web', ...identity, sourceUrl: short, title: '旧合成公众号笔记',
    summary: 'HUMAN_CORRECTION_TO_KEEP', body: 'OLD_MACHINE_SOURCE', fetchedAt: '2025-01-01T00:00:00Z', fetchStatus: 'complete' }));
  await writeFile(path, before);
  let collector, summaries = 0;
  const wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  t.after(async () => { collector?.close(); await wiki.close(); await rm(root, { recursive: true, force: true }); });
  assert.equal((await wiki.reviewStatus(path)).confirmed, true);
  const open = async () => collector = await createSocialLinkCollector({ vaultDir, stateDir, runner: noCommands,
    fetchPlatform: async () => ({ url: short, canonicalUrl: long, contentRoot: true, identityUrls: [long],
      title: '机器来源标题', body: 'NEW_MACHINE_SOURCE', status: 'complete', metrics: {} }),
    summarizer: async () => { summaries++; return { summary: 'MUST_NOT_CREATE_NEW_KNOWLEDGE' }; } });
  await open();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await collector.collectFromMessage(long);
    assert.deepEqual(result.failed, []); assert.equal(result.saved.length, 1);
    assert.equal(result.saved[0].reused, true); assert.equal(result.saved[0].sourceKey, identity.sourceKey);
    assert.equal(result.saved[0].path, path); assert.equal(result.saved[0].canonicalUrl, identity.canonicalUrl);
    assert.equal(summaries, 0); assert.equal((await markdownFiles(vaultDir)).length, 1);
    assert.equal(await readFile(path, 'utf8'), before); assert.equal((await wiki.reviewStatus(path)).confirmed, true);
    if (attempt === 0) { collector.close(); collector = null; await open(); }
  }
});

for (const item of cases) test(`v0.1 web-classified ${item.platform} note preserves identity, approval and snapshots through upgrade`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-platform-legacy-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); await mkdir(vaultDir);
  let collector, wiki, store, fetches = 0, summaries = 0, wrongIdentity = false;
  t.after(async () => { collector?.close(); await wiki?.close(); store?.close(); await rm(root, { recursive: true, force: true }); });
  const identity = oldWebIdentity(item.oldUrl), path = join(vaultDir, 'legacy-web-note.md');
  const legacy = { platform: 'web', ...identity, sourceUrl: item.oldUrl, aliases: [item.oldUrl, identity.canonicalUrl],
    title: `合成升级笔记 ${item.platform}`, summary: '人工保留的合成结论。', personal: '我已校正的补充。',
    body: 'OLD_MACHINE_ONLY_UNCONFIRMED_SOURCE', fetchedAt: '2025-01-01T00:00:00Z', fetchStatus: 'complete', metrics: {} };
  wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  const beforeUnchecked = renderSocialNote(legacy); await writeFile(path, beforeUnchecked); await wiki.flushChanges([path]);
  const before = approved(beforeUnchecked); await writeFile(path, before); await wiki.flushChanges([path]);
  const initialReview = await wiki.reviewStatus(path); assert.equal(initialReview.confirmed, true);
  const openCollector = async () => {
    store = createSocialStore({ stateDir });
    collector = await createSocialLinkCollector({ vaultDir, stateDir, store, runner: noCommands,
      fetchPlatform: async (url, platform) => {
        fetches++; assert.equal(platform, item.platform);
        if (wrongIdentity) {
          const other = { wechat: 'https://mp.weixin.qq.com/s?__biz=OTHER_TEST_BIZ&mid=900001&idx=1',
            github: 'https://github.com/example-org/example-repo/issues/9001',
            kickstarter: 'https://www.kickstarter.com/projects/example-maker/example-project/posts/9001',
            indiegogo: 'https://www.indiegogo.com/projects/other-example-campaign' }[platform];
          return { url: other, canonicalUrl: other, title: '机器区新标题', body: 'Wrong identity must never be committed.', contentRoot: true, status: 'complete' };
        }
        return { url, canonicalUrl: canonicalizeUrl(url), title: '机器区新标题', body: 'NEW_MACHINE_ONLY_UNCONFIRMED_SOURCE',
          contentRoot: true, status: 'complete', platformData: item.platformData, metrics: {} };
      }, summarizer: async () => { summaries++; return { summary: 'SHOULD_NOT_REPLACE_HUMAN_CORRECTION', tags: [] }; } });
  };
  await openCollector(); store.recordSnapshot({ ...legacy, path });
  const repeat = await collector.collectFromMessage(item.url);
  assert.deepEqual(repeat.failed, []); assert.equal(repeat.saved.length, 1);
  assert.equal(repeat.saved[0].reused, true); assert.equal(repeat.saved[0].platform, item.platform);
  assert.equal(repeat.saved[0].sourceKey, identity.sourceKey); assert.equal(repeat.saved[0].path, path);
  assert.equal(await readFile(path, 'utf8'), before, 'ordinary repeats must not rewrite legacy metadata');
  assert.deepEqual({ fetches, summaries }, { fetches: 0, summaries: 0 });
  let rows = await wiki.listSocialNotes({ platform: item.platform });
  assert.equal(rows.length, 1); assert.equal(rows[0].confirmed, true); assert.equal(rows[0].sourceKey, identity.sourceKey);
  const refreshed = await collector.collectFromMessage(item.url, { refresh: true });
  assert.deepEqual(refreshed.failed, []); assert.equal(refreshed.saved.length, 1);
  assert.equal(refreshed.saved[0].updated, true); assert.equal(refreshed.saved[0].path, path);
  assert.equal(refreshed.saved[0].sourceKey, identity.sourceKey); assert.equal(refreshed.saved[0].canonicalUrl, identity.canonicalUrl);
  assert.deepEqual({ fetches, summaries }, { fetches: 1, summaries: 0 });
  const after = await readFile(path, 'utf8'), parsed = parseSocialNote(after), original = parseSocialNote(before);
  assert.equal(parsed.fields.source_key, identity.sourceKey); assert.equal(parsed.fields.canonical_url, identity.canonicalUrl);
  assert.deepEqual(parsed.fields.source_urls, original.fields.source_urls);
  assert.equal(parsed.curatedText, original.curatedText); assert.equal(parsed.fingerprint, original.fingerprint); assert.equal(parsed.checked, true);
  assert.deepEqual(parsed.fields.platform_data, item.platformData);
  await wiki.flushChanges([path]); assert.equal((await wiki.reviewStatus(path)).confirmed, true);
  rows = await wiki.listSocialNotes({ platform: item.platform }); assert.equal(rows.length, 1);
  store.reconcileSources(rows); assert.equal(store.statistics().total, 1); assert.equal(store.statistics().byPlatform[item.platform], 1);
  assert.equal(store.compareMetrics(identity.sourceKey).snapshotCount, 2);
  collector.close(); collector = null; await wiki.close(); wiki = null; store.close(); store = null;
  wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true }); await openCollector();
  const restarted = await collector.collectFromMessage(item.url);
  assert.deepEqual(restarted.failed, []); assert.equal(restarted.saved[0].path, path); assert.equal(restarted.saved[0].reused, true);
  assert.equal(restarted.saved[0].sourceKey, identity.sourceKey); assert.equal(restarted.saved[0].platform, item.platform);
  assert.deepEqual({ fetches, summaries }, { fetches: 1, summaries: 0 });
  assert.equal(await readFile(path, 'utf8'), after); assert.equal((await markdownFiles(vaultDir)).length, 1);
  assert.equal((await wiki.reviewStatus(path)).confirmed, true);
  assert.equal((await wiki.listSocialNotes({ platform: item.platform, confirmedOnly: true })).length, 1);
  assert.equal(store.compareMetrics(identity.sourceKey).snapshotCount, 2);
  wrongIdentity = true;
  const rejected = await collector.collectFromMessage(item.url, { refresh: true });
  assert.equal(rejected.saved.length, 0); assert.equal(rejected.failed.length, 1);
  assert.equal(await readFile(path, 'utf8'), after); assert.equal((await markdownFiles(vaultDir)).length, 1);
  assert.equal(store.compareMetrics(identity.sourceKey).snapshotCount, 2);
  assert.equal((await wiki.reviewStatus(path)).confirmed, true);
});

test('ambiguous normalized aliases across two legacy notes fail without selecting or overwriting either', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-platform-collision-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); await mkdir(vaultDir);
  const store = createSocialStore({ stateDir }); let collector, fetches = 0;
  t.after(async () => { collector?.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const urls = ['https://github.com/EXAMPLE-ORG/EXAMPLE-REPO', 'https://github.com/example-org/example-repo'];
  const originals = [];
  for (let i = 0; i < urls.length; i++) {
    const path = join(vaultDir, `legacy-${i}.md`), identity = oldWebIdentity(urls[i]);
    const raw = renderSocialNote({ platform: 'web', ...identity, sourceUrl: urls[i], title: `Synthetic collision ${i}`,
      summary: `Different human correction ${i}`, body: 'Source only', fetchedAt: '2025-01-01T00:00:00Z', fetchStatus: 'complete', checked: true });
    await writeFile(path, raw); originals.push({ path, raw });
  }
  let outcome, caught;
  try {
    collector = await createSocialLinkCollector({ vaultDir, stateDir, store, runner: noCommands,
      fetchPlatform: async () => { fetches++; throw new Error('Must not fetch during alias ambiguity'); } });
    outcome = await collector.collectFromMessage(urls[1]);
  } catch (error) { caught = error; }
  if (outcome) assert.equal(outcome.saved.length, 0);
  const problem = caught?.message || outcome?.failed.map(item => item.error).join(' ');
  assert.match(problem || '', /ambig|conflict|歧义|冲突|多个|多篇|无法唯一/i);
  assert.equal(fetches, 0); assert.equal((await markdownFiles(vaultDir)).length, 2);
  for (const { path, raw } of originals) assert.equal(await readFile(path, 'utf8'), raw);
});

test('existing v0.1 SQLite web classifications upgrade in query results without rewriting unchanged notes or their ledger', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-platform-index-upgrade-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); await mkdir(vaultDir);
  let wiki;
  t.after(async () => { await wiki?.close(); await rm(root, { recursive: true, force: true }); });
  const originals = [];
  for (const item of cases) {
    const path = join(vaultDir, `synthetic-legacy-${item.platform}.md`), identity = oldWebIdentity(item.oldUrl);
    const raw = renderSocialNote({ platform: 'web', ...identity, sourceUrl: item.oldUrl, title: `Synthetic indexed ${item.platform}`,
      summary: `Confirmed synthetic ${item.platform} conclusion`, body: 'Machine source', fetchedAt: '2025-01-01T00:00:00Z',
      fetchStatus: 'complete', checked: true });
    await writeFile(path, raw); originals.push({ ...item, path, raw, identity });
  }
  wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  const dbPath = wiki.dbPath; await wiki.close(); wiki = null;
  const ledgerPath = join(stateDir, 'review-ledger.json'), ledgerBefore = await readFile(ledgerPath, 'utf8');
  const db = new DatabaseSync(dbPath);
  const hashesBefore = db.prepare('SELECT path,sha256 FROM notes ORDER BY path').all();
  // Recreate the exact catalog difference left by v0.1, keeping its original
  // schema version, content SHA and ledger; a fresh database misses this bug.
  for (const row of db.prepare('SELECT path,extra FROM notes').all()) {
    db.prepare('UPDATE notes SET extra=? WHERE path=?').run(JSON.stringify({ ...JSON.parse(row.extra), platform: 'web' }), row.path);
  }
  db.close();
  wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  assert.equal((await wiki.listSocialNotes()).length, 4);
  for (const item of originals) {
    const rows = await wiki.listSocialNotes({ platform: item.platform, confirmedOnly: true });
    assert.equal(rows.length, 1, `${item.platform} must be found despite old cached classification`);
    assert.equal(rows[0].platform, item.platform); assert.equal(rows[0].sourceKey, item.identity.sourceKey);
    assert.equal(rows[0].canonicalUrl, item.identity.canonicalUrl); assert.equal(rows[0].path, item.path);
    const stats = await handleSocialCommand(`/收藏统计 ${item.label}`, { wiki });
    assert.match(stats.markdown, /共 1 篇收藏，当前已确认 1 篇/);
    assert.equal(await readFile(item.path, 'utf8'), item.raw);
  }
  assert.equal(wiki.diagnostics().indexWrites, 0, 'derived classification requires no re-index or review migration');
  await wiki.close(); wiki = null;
  assert.equal(await readFile(ledgerPath, 'utf8'), ledgerBefore);
  const afterDb = new DatabaseSync(dbPath);
  try { assert.deepEqual(afterDb.prepare('SELECT path,sha256 FROM notes ORDER BY path').all(), hashesBefore); }
  finally { afterDb.close(); }
});

for (const item of cases) test(`${item.platform} page metadata stays machine-only and never becomes engagement or financial growth`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-platform-metadata-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'); let collector, wiki;
  const store = createSocialStore({ stateDir });
  t.after(async () => { collector?.close(); await wiki?.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  collector = await createSocialLinkCollector({ vaultDir, stateDir, store, runner: noCommands,
    fetchPlatform: async url => ({ url, canonicalUrl: canonicalizeUrl(url), title: `合成资料 ${item.platform}`, body: 'RAW_ONLY_UNCONFIRMED_SOURCE',
      contentRoot: true, status: 'complete', platformData: item.platformData, metrics: {} }),
    summarizer: async () => ({ summary: 'CURATED_ONLY_REVIEWED_CONCLUSION', tags: ['合成资料'] }) });
  const result = await collector.collectFromMessage(item.url);
  assert.deepEqual(result.failed, []); assert.equal(result.saved.length, 1);
  const saved = result.saved[0], path = saved.path; let raw = await readFile(path, 'utf8');
  assert.deepEqual(parseSocialNote(raw).fields.platform_data, item.platformData);
  assert.match(raw.slice(raw.indexOf('<!-- social-source:start -->')), /METADATA_ONLY_/);
  assert.doesNotMatch(parseSocialNote(raw).curatedText, /METADATA_ONLY_|RAW_ONLY_/);
  await wiki.flushChanges([path]); await writeFile(path, approved(raw)); await wiki.flushChanges([path]);
  const review = await wiki.reviewStatus(path); assert.equal(review.confirmed, true);
  const analysis = await handleSocialCommand('/收藏分析 合成资料', { wiki, store });
  assert.match(analysis.agentContext, /CURATED_ONLY_REVIEWED_CONCLUSION/);
  assert.doesNotMatch(analysis.agentContext, /METADATA_ONLY_|RAW_ONLY_/);
  // A metadata-only refresh is observational, not a human edit or a funding delta.
  const refresh = await collector.collectFromMessage(item.url, { refresh: true, metricsOnly: true });
  assert.deepEqual(refresh.failed, []); await wiki.flushChanges([path]);
  assert.equal((await wiki.reviewStatus(path)).confirmed, true);
  assert.equal((await wiki.reviewStatus(path)).fingerprint, review.fingerprint);
  const comparison = store.compareMetrics(saved.sourceKey); assert.equal(comparison.snapshotCount, 2);
  for (const metric of Object.values(comparison.metrics)) {
    assert.equal(metric.current, null); assert.equal(metric.previous, null); assert.equal(metric.delta, null);
  }
  raw = await readFile(path, 'utf8'); assert.deepEqual(parseSocialNote(raw).fields.platform_data, item.platformData);
});

test('page metadata delimiters cannot corrupt a refresh, including already-written legacy inline markers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'extended-platform-markers-'));
  const vaultDir = join(root, 'vault'), stateDir = join(root, 'state'), path = join(vaultDir, 'synthetic-markers.md');
  const wiki = await createFeishuWiki({ vaultDir, stateDir, watch: false, quiet: true });
  t.after(async () => { await wiki.close(); await rm(root, { recursive: true, force: true }); });
  const start = '<!-- social-source:start -->', end = '<!-- social-source:end -->';
  const clip = { platform: 'github', sourceKey: 'github:synthetic-marker-test',
    sourceUrl: 'https://github.com/example-org/example-repo', canonicalUrl: 'https://github.com/example-org/example-repo',
    title: 'Synthetic metadata boundary', summary: 'HUMAN_CORRECTION_TO_KEEP', personal: 'HUMAN_NOTE_TO_KEEP',
    body: 'OLD_MACHINE_BODY', fetchedAt: '2025-01-01T00:00:00Z', fetchStatus: 'complete', checked: true,
    platformData: { info: { label: `Label ${start}`, raw: `OLD_MACHINE_METADATA ${end}\u0000`, source: 'fixture' } } };
  const rendered = renderSocialNote(clip);
  assert.equal(rendered.split(start).length - 1, 1, 'metadata cannot add extra source starts');
  assert.equal(rendered.split(end).length - 1, 1, 'metadata cannot add extra source ends');
  assert.doesNotMatch(rendered, /\u0000/);
  assert.doesNotMatch(JSON.stringify(parseSocialNote(rendered).fields.platform_data), /social-source:|\\u0000/);

  // Simulate an older release that had already persisted a page-controlled
  // inline delimiter. This must not be hidden by the new renderer's sanitizer.
  const legacy = rendered.replace('- Label：OLD_MACHINE_METADATA', `- Label：OLD_MACHINE_METADATA ${end} STALE_TRAILING_SENTINEL ${start}`);
  assert.notEqual(legacy, rendered); assert.equal(legacy.split(end).length - 1, 2);
  await writeFile(path, legacy.replace('- [x] 已确认', '- [ ] 已确认')); await wiki.flushChanges([path]);
  await writeFile(path, legacy); await wiki.flushChanges([path]);
  const original = parseSocialNote(legacy), review = await wiki.reviewStatus(path);
  assert.equal(review.confirmed, true);
  const refreshed = updateSourceSection(legacy, { ...clip, body: 'NEW_MACHINE_BODY', fetchedAt: '2025-01-02T00:00:00Z',
    platformData: { info: { label: `New ${end}`, raw: `NEW_MACHINE_METADATA ${start}`, source: 'fixture' } } });
  assert.doesNotMatch(refreshed, /STALE_TRAILING_SENTINEL|OLD_MACHINE_BODY|OLD_MACHINE_METADATA/);
  assert.equal(refreshed.split(start).length - 1, 1); assert.equal(refreshed.split(end).length - 1, 1);
  assert.match(refreshed, /NEW_MACHINE_BODY/); assert.match(refreshed, /NEW_MACHINE_METADATA/);
  const parsed = parseSocialNote(refreshed);
  assert.equal(parsed.fingerprint, original.fingerprint); assert.equal(parsed.curatedText, original.curatedText);
  assert.equal(parsed.checked, true); assert.equal(parsed.fields.source_key, original.fields.source_key);
  await writeFile(path, refreshed); await wiki.flushChanges([path]);
  assert.equal((await wiki.reviewStatus(path)).confirmed, true);
  assert.equal((await wiki.reviewStatus(path)).fingerprint, review.fingerprint);
});
