// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import { bridgeConfig } from '../runtime/config.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocialLinkCollector, sourceKeyFor, canonicalizeUrl, platformForUrl, extractWebLinks, isUrlOnlyMessage, validateContent, validateCapturedIdentity, normalizeMetrics, runCommand, fetchBrowserPage, extractPageData } from '../runtime/social-link-collector.mjs';
import { renderSocialNote, parseSocialNote, updateSourceSection } from '../runtime/social-note.mjs';

const input = { platform: 'web', sourceKey: 'web:abc', sourceUrl: 'https://example.com/a', canonicalUrl: 'https://example.com/a', title: '原文标题', summary: '作者提出了三个不同的观点。', body: '这是来源原文，不属于默认复用区。'.repeat(30), fetchedAt: '2026-09-08T01:00:00Z', fetchStatus: 'complete', metrics: normalizeMetrics({ likes: 12 }) };
function memoryStore() {
  const map = new Map(), snapshots = [];
  return { getSource: key => map.get(key) || null, upsertSource: clip => map.set(clip.sourceKey, { ...clip }), recordSnapshot: clip => snapshots.push(clip), reconcileSources: clips => { map.clear(); for (const clip of clips) map.set(clip.sourceKey, clip); }, close() {}, map, snapshots };
}
async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'social-collector-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = memoryStore();
  let fetches = 0, summaries = 0;
  const collector = await createSocialLinkCollector({ vaultDir: join(dir, 'vault'), stateDir: join(dir, 'state'), store,
    fetchPlatform: async url => { fetches++; return { ...input, canonicalUrl: url }; },
    summarizer: async () => { summaries++; return { summary: '根据正文整理的摘要。', keyPoints: ['这是作者观点'], tags: ['测试主题'], limitations: [] }; }, ...extra });
  return { dir, store, collector, count: () => ({ fetches, summaries }) };
}

test('platform routing, URL extraction and source identity are stable', () => {
  const urls = ['https://v.douyin.com/a/', 'https://xhslink.com/a', 'https://www.zhihu.com/question/123/answer/456', 'https://weibo.com/123/AbcDef', 'https://youtu.be/abc123', 'https://www.bilibili.com/video/BV1abc123', 'https://example.com/a'];
  assert.deepEqual(urls.map(platformForUrl), ['douyin', 'xiaohongshu', 'zhihu', 'weibo', 'youtube', 'bilibili', 'web']);
  assert.equal(extractWebLinks(`收藏 ${urls[0]}，以及 ${urls[1]}。`).length, 2);
  assert.equal(isUrlOnlyMessage(urls.join('\n')), true);
  assert.equal(isUrlOnlyMessage(`分析这个 ${urls[0]}`), false);
  assert.equal(sourceKeyFor('https://www.zhihu.com/question/123/answer/456'), sourceKeyFor('https://www.zhihu.com/answer/456'));
  assert.notEqual(sourceKeyFor('https://www.zhihu.com/question/123/answer/456'), sourceKeyFor('https://www.zhihu.com/question/123/answer/789'));
  assert.equal(sourceKeyFor('https://youtu.be/abc123?si=tracking'), sourceKeyFor('https://youtube.com/watch?v=abc123'));
  assert.equal(sourceKeyFor('https://www.douyin.com/?modal_id=123'), sourceKeyFor('https://www.douyin.com/video/123'));
  assert.equal(sourceKeyFor('https://www.xiaohongshu.com/discovery/item/ABCDEF?xsec_token=1'), sourceKeyFor('https://www.xiaohongshu.com/explore/abcdef'));
  assert.equal(canonicalizeUrl('https://example.com/a?utm_source=x&b=2&a=1'), 'https://example.com/a?a=1&b=2');
});

test('single top checkbox only; fenced/body/indented controls are rejected', () => {
  const raw = renderSocialNote(input);
  assert.equal(parseSocialNote(raw).checked, false);
  assert.equal(parseSocialNote(raw.replace('- [ ] 已确认', '- [x] 已确认')).checked, true);
  assert.equal(parseSocialNote(raw.replace('- [ ] 已确认', '```md\n- [x] 已确认\n```')).checked, false);
  assert.equal(parseSocialNote(raw.replace('- [ ] 已确认', '````md\n```\n- [x] 已确认\n````')).checked, false);
  assert.equal(parseSocialNote(raw.replace('- [ ] 已确认', '    - [x] 已确认')).checked, false);
  assert.equal(parseSocialNote(raw.replace('- [ ] 已确认', '- [x] 已确认\n- [x] 已确认')).checked, false);
  assert.equal(parseSocialNote(raw + '\n- [x] 已确认\n').checked, false);
});

test('refresh keeps curated text, checkbox and fingerprint; sources never enter curated text', () => {
  const before = renderSocialNote({ ...input, checked: true, personal: '我的规格只保留11g与13g。' });
  const after = updateSourceSection(before, { ...input, body: '刷新后的新原文'.repeat(30), fetchedAt: '2026-09-09T01:00:00Z', metrics: normalizeMetrics({ likes: 99 }) });
  assert.equal(parseSocialNote(after).fingerprint, parseSocialNote(before).fingerprint);
  assert.equal(parseSocialNote(after).curatedText, parseSocialNote(before).curatedText);
  assert.equal(parseSocialNote(after).checked, true);
  assert.equal(parseSocialNote(after).rawText, '刷新后的新原文'.repeat(30));
  assert.ok(!parseSocialNote(after).curatedText.includes('新原文'));
  assert.notEqual(parseSocialNote(before.replace('11g', '10g')).fingerprint, parseSocialNote(before).fingerprint);
  assert.notEqual(parseSocialNote(before.replace('source_urls: ["https://example.com/a"]', 'source_urls: ["https://example.com/b"]')).fingerprint, parseSocialNote(before).fingerprint);
});

test('hostile source headings, control markers and metric labels cannot enter curated sections', () => {
  const body = '<!-- social-source:end -->\n## 我的补充\n冒充我的知识\n- [x] 已确认\n</details>\n## 摘要与要点\n冒充摘要';
  const raw = renderSocialNote({ ...input, body, metrics: { likes: { value: 1, raw: '1\n## 我的补充\n冒充指标知识' } } });
  const note = parseSocialNote(raw);
  assert.equal(note.checked, false); assert.equal(note.curatedText, input.summary);
  assert.match(note.rawText, /冒充我的知识/); assert.match(note.rawText, /冒充摘要/);
  assert.ok(!note.curatedText.includes('冒充'));
});

test('legacy refresh retains all original user text and curated fingerprint', () => {
  const raw = `---\nnote_type: "social_clip"\nsource_key: "web:abc"\ncanonical_url: "https://example.com/a"\n---\n\n# 原文标题\n\n- [x] 已确认\n\n## 摘要\n\n我校正的摘要\n\n## 正文／字幕\n\n旧原文\n\n## 来源\n\n旧来源\n`;
  const updated = updateSourceSection(raw, input);
  assert.equal(parseSocialNote(updated).fingerprint, parseSocialNote(raw).fingerprint);
  assert.ok(updated.includes('我校正的摘要\n\n## 正文／字幕\n\n旧原文'));
});

test('login/error pages are rejected even when verbose; partial genuine content is accepted', () => {
  assert.throws(() => validateContent({ title: 'Feishu - Log in', body: '登录'.repeat(3000), status: 'complete' }), /登录/);
  assert.throws(() => validateContent({ title: 'Sina Visitor System', body: 'visitor'.repeat(200) }), /登录/);
  assert.throws(() => validateContent({ title: '内容', body: '仅标题' }), /正文不足/);
  assert.throws(() => validateContent({ title: '内容', body: input.body, status: 'blocked' }), /受限/);
  assert.equal(validateContent({ title: '视频的简介', body: input.body, status: 'partial', contentRoot: true }), true);
});

test('metrics keep unknown distinct from zero and mark abbreviated numbers approximate', () => {
  const metrics = normalizeMetrics({ likes: { raw: '1.2万', source: 'dom:like' }, comments: '0', views: '1,234,567 views', shares: '未知', favorites: '99+' });
  assert.equal(metrics.likes.value, 12000); assert.equal(metrics.likes.approximate, true);
  assert.equal(metrics.comments.value, 0); assert.equal(metrics.shares, null);
  assert.equal(metrics.views.value, 1234567); assert.equal(metrics.views.approximate, false);
  assert.equal(metrics.favorites.approximate, true); assert.equal(metrics.coins, null);
});

function mockPage(platform, objects) {
  const url = platform === 'youtube' ? 'https://www.youtube.com/watch?v=current123' : 'https://www.xiaohongshu.com/explore/abcdef123';
  const makeNode = value => ({ innerText: value, textContent: value, scrollHeight: 0, clientHeight: 0, getAttribute: () => '', querySelector: () => null, closest: () => null });
  const article = makeNode('当前内容正文，说明产品使用方法与适用场景。');
  article.closest = () => article;
  article.querySelector = selector => /author-container/.test(selector) ? makeNode('当前内容作者') : selector === 'video' && platform === 'xiaohongshu' ? makeNode('') : null;
  const original = { document: globalThis.document, location: globalThis.location };
  globalThis.location = new URL(url);
  globalThis.document = { title: '当前内容标题', body: makeNode('当前内容正文'),
    querySelector: selector => {
      if (selector === 'link[rel="canonical"]') return { href: url };
      if (/^meta\[/.test(selector)) return { content: /og:title/.test(selector) ? '当前内容标题' : /author/.test(selector) ? '错误的账号页作者' : '' };
      if (/note-content .*date/.test(selector)) return makeNode('7天前 广东');
      if (selector === '#noteContainer #detail-desc' || selector === 'ytd-watch-metadata #description-inline-expander') return article;
      return null;
    },
    querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? objects.map(value => ({ textContent: JSON.stringify(value) })) : [] };
  return { url, restore() { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}

test('XHS does not call aggregate JSON-LD WatchAction views and uses current note publication label', () => {
  const page = mockPage('xiaohongshu', [{ '@type': 'VideoObject', name: '当前内容标题', url: 'https://www.xiaohongshu.com/explore/abcdef123', datePublished: '2099-01-01',
    interactionStatistic: [{ interactionType: 'https://schema.org/WatchAction', userInteractionCount: 534 }, { interactionType: 'https://schema.org/CommentAction', userInteractionCount: 191 }] }]);
  try {
    const result = extractPageData('xiaohongshu');
    assert.equal(result.metrics.views, null); assert.match(result.metrics.comments.source, /CommentAction$/);
    assert.equal(result.author, '当前内容作者'); assert.equal(result.publishedAt, '7天前 广东');
    assert.equal(result.captureKind, 'description'); assert.equal(result.status, 'partial');
  } finally { page.restore(); }
});

test('all JSON-LD objects matching current YouTube video contribute metrics; related video does not', () => {
  const page = mockPage('youtube', [
    { '@type': 'VideoObject', name: '当前内容标题', url: 'https://www.youtube.com/watch?v=current123' },
    { '@type': 'VideoObject', name: '当前内容标题', url: 'https://www.youtube.com/watch?v=current123', interactionStatistic: [{ interactionType: { '@type': 'WatchAction' }, userInteractionCount: 12345 }] },
    { '@type': 'VideoObject', name: '相关视频', url: 'https://www.youtube.com/watch?v=other123', author: { name: '错误作者' }, interactionStatistic: [{ interactionType: 'LikeAction', userInteractionCount: 99999 }] }
  ]);
  try {
    const result = extractPageData('youtube');
    assert.equal(result.metrics.views.raw, '12345'); assert.match(result.metrics.views.source, /WatchAction$/);
    assert.equal(result.metrics.likes, null); assert.notEqual(result.author, '错误作者');
  } finally { page.restore(); }
});

test('repeat link returns existing file without fetch, summary or rewrite; refresh preserves edits', async t => {
  const f = await fixture(t);
  const first = await f.collector.collectFromMessage('https://example.com/a');
  const path = first.saved[0].path;
  let raw = await readFile(path, 'utf8'); raw = raw.replace('根据正文整理的摘要。', '我修改后的两种规格').replace('- [ ] 已确认', '- [x] 已确认');
  await writeFile(path, raw);
  const repeat = await f.collector.collectFromMessage('https://example.com/a');
  assert.equal(repeat.saved[0].reused, true);
  assert.deepEqual(f.count(), { fetches: 1, summaries: 1 });
  assert.equal(await readFile(path, 'utf8'), raw);
  const refresh = await f.collector.collectFromMessage('更新 https://example.com/a', { refresh: true });
  assert.equal(refresh.saved[0].updated, true);
  assert.deepEqual(f.count(), { fetches: 2, summaries: 1 });
  assert.equal(parseSocialNote(await readFile(path, 'utf8')).fingerprint, parseSocialNote(raw).fingerprint);
  assert.equal(f.store.snapshots.length, 2);
  assert.equal(await readFile(refresh.saved[0].backupPath, 'utf8'), raw);
});

test('short URL aliases are remembered and canonical detail is reused across restart', async t => {
  let resolutions = 0;
  const f = await fixture(t, { runner: async () => { resolutions++; return { stdout: 'https://www.douyin.com/video/123' }; } });
  await f.collector.collectFromMessage('https://v.douyin.com/short');
  await f.collector.collectFromMessage('https://v.douyin.com/short');
  await f.collector.collectFromMessage('https://www.douyin.com/video/123?utm_source=share');
  assert.equal(resolutions, 1); assert.equal(f.count().fetches, 1);
  const next = await createSocialLinkCollector({ vaultDir: join(f.dir, 'vault'), stateDir: join(f.dir, 'state'), store: memoryStore(), fetchPlatform: () => { throw new Error('must not fetch'); } });
  const result = await next.collectFromMessage('https://v.douyin.com/short');
  assert.equal(result.saved[0].reused, true);
});

test('summary failure saves explicit excerpt and no false model summary', async t => {
  const f = await fixture(t, { summarizer: async () => { throw new Error('summary unavailable'); } });
  const result = await f.collector.collectFromMessage('https://example.com/a');
  assert.equal(result.saved[0].summaryKind, 'excerpt');
  assert.match(result.saved[0].summary, /摘要生成失败.*仅为原文摘录/);
});

test('abort during summary creates no note and commits no metric snapshot', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { summarizer: async () => { controller.abort(); return '摘要'; } });
  await assert.rejects(() => f.collector.collectFromMessage('https://example.com/a', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await readdir(join(f.dir, 'vault'))).length, 0); assert.equal(f.store.snapshots.length, 0);
});

test('source extraction failure creates no junk note', async t => {
  const f = await fixture(t, { fetchPlatform: async () => ({ title: 'Feishu - Log in', body: input.body, status: 'complete' }) });
  const result = await f.collector.collectFromMessage('https://example.com/a');
  assert.equal(result.saved.length, 0); assert.equal(result.failed.length, 1);
  assert.equal((await readdir(join(f.dir, 'vault'))).length, 0);
});

test('identity verification rejects wrong platform, same-platform content ID and inconsistent canonical', () => {
  const request = 'https://www.youtube.com/watch?v=expected123';
  assert.throws(() => validateCapturedIdentity(request, { url: 'https://www.xiaohongshu.com/explore/abcdef' }), /平台/);
  assert.throws(() => validateCapturedIdentity(request, { url: 'https://www.youtube.com/watch?v=other123' }), /不是请求的链接/);
  assert.throws(() => validateCapturedIdentity(request, { url: request, canonicalUrl: 'https://www.youtube.com/watch?v=other123' }), /规范来源/);
  assert.throws(() => validateCapturedIdentity('https://example.org/a', { url: 'https://example.org/b' }), /不是请求的链接/);
  assert.equal(validateCapturedIdentity('https://youtu.be/expected123', { url: request, canonicalUrl: request }), request);
  assert.equal(validateCapturedIdentity('https://v.douyin.com/short/', { url: 'https://www.douyin.com/video/123', canonicalUrl: 'https://www.douyin.com/video/123' }), 'https://www.douyin.com/video/123');
  assert.equal(validateCapturedIdentity('http://www.example.org/a/?utm_source=share', { url: 'https://example.org/a/', canonicalUrl: 'https://example.org/a' }), 'https://example.org/a');
});

test('a switched Browser Use page is rejected before note creation and metrics persistence', async t => {
  const f = await fixture(t, { fetchPlatform: async () => ({ ...input, platform: 'youtube', title: '另一个视频', url: 'https://www.youtube.com/watch?v=other123', canonicalUrl: 'https://www.youtube.com/watch?v=other123' }) });
  const result = await f.collector.collectFromMessage('https://www.youtube.com/watch?v=expected123');
  assert.equal(result.saved.length, 0); assert.match(result.failed[0].error, /不是请求的链接/);
  assert.equal(f.store.snapshots.length, 0); assert.equal((await readdir(join(f.dir, 'vault'))).length, 0);
});

test('concurrent repeated links share one serialized collection and one note', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.collector.collectFromMessage('https://example.com/a'), f.collector.collectFromMessage('https://example.com/a')]);
  assert.equal(results[0].saved[0].path, results[1].saved[0].path);
  assert.equal(results[1].saved[0].reused, true); assert.equal(f.count().fetches, 1);
  assert.equal((await readdir(join(f.dir, 'vault'))).filter(name => name.endsWith('.md')).length, 1);
});

test('two independent collectors cannot overwrite a simultaneously created same-source file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'social-exclusive-create-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let ready = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const make = index => createSocialLinkCollector({ vaultDir: join(dir, 'vault'), stateDir: join(dir, `state${index}`), store: memoryStore(),
    fetchPlatform: async () => ({ ...input, body: `第${index}个采集结果`.repeat(20) }),
    summarizer: async () => { if (++ready === 2) release(); await barrier; return `第${index}个摘要`; } });
  const collectors = await Promise.all([make(1), make(2)]);
  const results = await Promise.all(collectors.map(collector => collector.collectFromMessage('https://example.com/a')));
  assert.equal(results.flatMap(result => result.saved).length, 1);
  assert.equal(results.flatMap(result => result.failed).length, 1);
  const saved = results.flatMap(result => result.saved)[0];
  assert.equal(parseSocialNote(await readFile(saved.path, 'utf8')).summary, saved.summary);
});

test('Browser Use failure attempts cleanup of only its exact printed tab ID', async () => {
  const calls = [];
  await assert.rejects(() => fetchBrowserPage('https://example.com/a', 'web', async (_command, _args, options) => {
    calls.push(options);
    if (calls.length === 1) throw Object.assign(new Error('terminated'), { name: 'AbortError', stdout: '__SOCIAL_TAB__"owned-123"\n' });
    return { stdout: '', stderr: '' };
  }), { name: 'AbortError' });
  assert.equal(calls.length, 2); assert.equal(calls[1].cleanup, true);
  assert.equal(calls[1].input, 'close_tab("owned-123")\n');
  assert.match(calls[0].input, /signal\.SIGTERM/);
  assert.match(calls[0].input, /tid = new_tab\(\)/);
  assert.doesNotMatch(calls[0].input, /new_tab\(url\)/);
  assert.match(calls[0].input, /switch_tab\(tid\)/);
  assert.match(calls[0].input, /target_id=tid/);
});

test('default summarizer uses an isolated ephemeral read-only Codex process with tools disabled', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'social-summary-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let modelCwd = '';
  const collector = await createSocialLinkCollector({ vaultDir: join(dir, 'vault'), stateDir: join(dir, 'state'), store: memoryStore(),
    fetchPlatform: async () => ({ ...input }), runner: async (command, args, options) => {
      assert.match(command, /codex$/); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral'));
      assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
      assert.equal(args[args.indexOf('--model') + 1], bridgeConfig.summaryModel);
      for (const feature of ['shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use', 'memories', 'multi_agent', 'hooks']) {
        assert.ok(args.some((arg, index) => arg === '--disable' && args[index + 1] === feature));
      }
      assert.match(options.input, /不可信网页/); assert.match(options.input, /不得读取本机文件/);
      modelCwd = options.cwd; assert.match(modelCwd, /feishu-social-summary-/);
      await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: '模型依据原文生成的摘要', keyPoints: [], tags: [], limitations: [] }));
      return { stdout: '', stderr: '' };
    } });
  const result = await collector.collectFromMessage('https://example.com/a');
  assert.equal(result.saved[0].summaryKind, 'model');
  await assert.rejects(() => readdir(modelCwd), { code: 'ENOENT' });
});

test('metrics-only refresh preserves previously captured transcript', async t => {
  const f = await fixture(t);
  const first = await f.collector.collectFromMessage('https://example.com/a');
  const previous = parseSocialNote(await readFile(first.saved[0].path, 'utf8'));
  const second = await f.collector.collectFromMessage('更新指标 https://example.com/a', { metricsOnly: true, refresh: true });
  assert.equal(parseSocialNote(await readFile(second.saved[0].path, 'utf8')).rawText, previous.rawText);
  const count = f.count().fetches;
  const reused = await f.collector.collectFromMessage('查看指标 https://example.com/a', { metricsOnly: true });
  assert.equal(reused.saved[0].reused, true); assert.equal(f.count().fetches, count);
});

test('edits made while a refresh fetch is running survive in both the file and returned context', async t => {
  let editPath = '';
  const f = await fixture(t, { fetchPlatform: async url => {
    if (editPath) { const raw = await readFile(editPath, 'utf8'); await writeFile(editPath, raw.replace('根据正文整理的摘要。', '采集期间我刚校正的新摘要')); }
    return { ...input, canonicalUrl: url };
  } });
  const first = await f.collector.collectFromMessage('https://example.com/a'); editPath = first.saved[0].path;
  const refreshed = await f.collector.collectFromMessage('更新 https://example.com/a', { refresh: true });
  assert.match(parseSocialNote(await readFile(editPath, 'utf8')).summary, /刚校正的新摘要/);
  assert.match(refreshed.saved[0].summary, /刚校正的新摘要/);
  assert.match(refreshed.agentContext, /刚校正的新摘要/);
  assert.ok(!refreshed.agentContext.includes('来源原文'));
});

test('runner cancellation kills a running process and returns AbortError promptly', async () => {
  const controller = new AbortController();
  const task = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { signal: controller.signal, timeoutMs: 35000 });
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(task, { name: 'AbortError' });
});
