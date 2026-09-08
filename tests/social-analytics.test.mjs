// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocialStore, normalizeMetrics, shanghaiDate } from '../runtime/social-store.mjs';
import { parseSocialIntent, handleSocialCommand } from '../runtime/social-commands.mjs';

async function fixture(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'social-analytics-test-'));
  const store = createSocialStore({ stateDir });
  t.after(async () => { store.close(); await rm(stateDir, { recursive: true, force: true }); });
  return store;
}
const metric = (value, raw = String(value), approximate = false, source = 'visible-likes') => ({ value, raw, approximate, source });
const source = (id, fields = {}) => ({ sourceKey: `xiaohongshu:${id}`, platform: 'xiaohongshu', title: `磁轴评测 ${id}`, path: `/isolated/${id}.md`, canonicalUrl: `https://www.xiaohongshu.com/explore/${id}`, fetchedAt: '2026-09-07T12:00:00.000Z', tags: ['磁轴', '竞品'], ...fields });

test('source key is unique, preserves aliases and creation time, reconcile hides removed notes but retains snapshots', async t => {
  const store = await fixture(t);
  const original = source('a', { aliases: ['https://xhslink.com/a'], checked: true, personal: '我的校正', metrics: { likes: metric(15) } });
  store.upsertSource(original); store.recordSnapshot(original);
  store.upsertSource(source('a', { fetchedAt: '2026-09-08T12:00:00.000Z', title: '更新标题' }));
  assert.equal(store.listSources().length, 1);
  assert.equal(store.getSource(original.sourceKey).createdAt, original.fetchedAt);
  assert.deepEqual(store.getSource(original.sourceKey).aliases, original.aliases);
  store.reconcileSources([]);
  assert.equal(store.listSources().length, 0);
  assert.equal(store.getSource(original.sourceKey), null);
  assert.equal(store.compareMetrics(original.sourceKey).snapshotCount, 1);
  store.reconcileSources([original]);
  assert.equal(store.listSources().length, 1);
});

test('one snapshot never means growth, duplicate timestamp is immutable, missing never becomes zero', async t => {
  const store = await fixture(t);
  const first = source('b', { metrics: { likes: metric(1200, '1.2千', true), comments: null, views: metric(0) } });
  store.upsertSource(first);
  assert.equal(store.recordSnapshot(first).recorded, true);
  assert.equal(store.recordSnapshot({ ...first, metrics: { likes: metric(9999) } }).recorded, false);
  let comparison = store.compareMetrics(first.sourceKey);
  assert.equal(comparison.snapshotCount, 1);
  assert.equal(comparison.metrics.likes.status, 'single_snapshot');
  assert.equal(comparison.metrics.likes.delta, null);
  assert.equal(comparison.metrics.likes.current.raw, '1.2千');
  store.recordSnapshot({ ...first, fetchedAt: '2026-09-08T12:00:00Z', metrics: { likes: metric(1300, '1.3千', true), comments: metric(3), views: metric(0) } });
  comparison = store.compareMetrics(first.sourceKey);
  assert.equal(comparison.metrics.likes.delta, 100);
  assert.equal(comparison.metrics.likes.approximate, true);
  assert.equal(comparison.metrics.comments.status, 'missing');
  assert.equal(comparison.metrics.comments.delta, null);
  assert.equal(comparison.metrics.views.delta, 0);
});

test('metric scope changes prohibit comparison and sources never share snapshots', async t => {
  const store = await fixture(t);
  const first = source('c', { metrics: { likes: metric(10) } });
  store.upsertSource(first); store.recordSnapshot(first);
  store.recordSnapshot({ ...first, fetchedAt: '2026-09-08T12:00:00Z', metrics: { likes: metric(20, '20', false, 'api-like-total') } });
  const other = source('d', { platform: 'douyin', metrics: { likes: metric(10000) } });
  store.upsertSource(other); store.recordSnapshot(other);
  assert.equal(store.compareMetrics(first.sourceKey).metrics.likes.status, 'incomparable');
  assert.equal(store.compareMetrics(first.sourceKey).metrics.likes.delta, null);
  assert.equal(store.compareMetrics(other.sourceKey).snapshotCount, 1);
  assert.equal(normalizeMetrics({ likes: { value: null }, views: { value: -1 }, coins: { value: '20' } }).likes, null);
});

test('snapshot history survives store restart and active catalog rebuilding', async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'social-analytics-restart-'));
  let store = createSocialStore({ stateDir });
  t.after(async () => { store.close(); await rm(stateDir, { recursive: true, force: true }); });
  const clip = source('restart', { metrics: { likes: metric(20) } });
  store.upsertSource(clip); store.recordSnapshot(clip); store.close();
  store = createSocialStore({ stateDir });
  store.reconcileSources([]);
  assert.equal(store.compareMetrics(clip.sourceKey).snapshotCount, 1);
  store.reconcileSources([clip]);
  store.recordSnapshot({ ...clip, fetchedAt: '2026-09-08T12:00:00Z', metrics: { likes: metric(18) } });
  assert.equal(store.compareMetrics(clip.sourceKey).metrics.likes.delta, -2);
});

test('store archive statistics use Shanghai collection dates, unique documents and explicit review observations', async t => {
  const store = await fixture(t);
  store.upsertSource(source('e', { fetchedAt: '2026-09-07T15:59:59Z', checked: true }));
  store.upsertSource(source('f', { fetchedAt: '2026-09-07T16:00:00Z', checked: false }));
  store.upsertSource(source('g', { platform: 'youtube', fetchedAt: '2026-09-07T16:01:00Z', tags: [] }));
  const stats = store.statistics({ from: '2026-09-08', to: '2026-09-08', platform: 'xiaohongshu', confirmedPaths: new Set(['/isolated/f.md']), pendingPaths: new Set() });
  assert.equal(stats.total, 1); assert.equal(stats.confirmed, 1);
  assert.deepEqual(stats.byDate, { '2026-09-08': 1 });
  assert.equal(store.statistics({ confirmedOnly: true }).total, 0);
  assert.equal(shanghaiDate('2026-09-07T16:00:00Z'), '2026-09-08');
});

test('natural-language commands preserve topic, combined period/platform/status and refresh semantics', () => {
  const now = new Date('2026-09-07T16:01:00Z');
  let intent = parseSocialIntent('这周收藏了多少篇小红书磁轴评测', { now });
  assert.equal(intent.kind, 'stats'); assert.equal(intent.query, '磁轴评测'); assert.equal(intent.platform, 'xiaohongshu');
  assert.equal(intent.period.from, '2026-09-07'); assert.equal(intent.period.to, '2026-09-08');
  intent = parseSocialIntent('哪些还没确认', { now });
  assert.equal(intent.kind, 'list'); assert.equal(intent.pendingOnly, true); assert.equal(intent.query, '');
  assert.equal(parseSocialIntent('找一下之前收藏的磁轴评测').query, '磁轴评测');
  assert.equal(parseSocialIntent('根据我确认过的资料做竞品分析').query, '');
  assert.equal(parseSocialIntent('这些收藏竞品分析').kind, 'analysis');
  assert.equal(parseSocialIntent('更新这篇 https://example.org/a').refresh, true);
  assert.equal(parseSocialIntent('刷新互动数据 https://example.org/a').kind, 'metrics');
  assert.equal(parseSocialIntent('点赞变化').kind, 'metrics');
  intent = parseSocialIntent('/收藏统计 2026-09-01 至 2026-09-08 已确认 小红书 磁轴');
  assert.equal(intent.query, '磁轴'); assert.equal(intent.confirmedOnly, true);
  assert.equal(intent.period.to, '2026-09-08');
  assert.equal(parseSocialIntent('/收藏统计 主题:磁轴 本周 已确认 小红书', { now }).query, '磁轴');
  assert.equal(parseSocialIntent('X9续航是多少'), null);
});

test('commands derive confirmation from live wiki and never leak unchecked content into analysis', async t => {
  const store = await fixture(t);
  const stale = source('h', { checked: true }); store.upsertSource(stale);
  const notes = [
    { ...stale, createdAt: stale.fetchedAt, confirmed: false, reviewReason: 'content-changed-reconfirmation-required', answer: 'UNTRUSTED RAW SECRET' },
    { ...source('i'), createdAt: '2026-09-07T16:00:00Z', confirmed: true, answer: '只包含已确认的磁轴结论', sourceUrls: ['https://example.org/i'] }
  ];
  const wiki = { listSocialNotes: () => notes };
  const options = { store, wiki, now: new Date('2026-09-08T00:00:00Z') };
  const list = await handleSocialCommand('哪些还没确认', options);
  assert.match(list.markdown, /h\.md/); assert.doesNotMatch(list.markdown, /i\.md|UNTRUSTED RAW SECRET/);
  const stats = await handleSocialCommand('今天收藏了多少篇', options);
  assert.match(stats.markdown, /共 1 篇收藏，当前已确认 1 篇/);
  const analysis = await handleSocialCommand('这些收藏竞品分析', options);
  assert.match(analysis.agentContext, /只包含已确认的磁轴结论/);
  assert.match(analysis.agentContext, /reference-only/);
  assert.doesNotMatch(analysis.agentContext, /UNTRUSTED RAW SECRET|h\.md/);
  notes[1].confirmed = false;
  const invalidated = await handleSocialCommand('这些收藏竞品分析', options);
  assert.equal(invalidated.agentContext, undefined);
  assert.match(invalidated.markdown, /没有找到符合条件且当前已确认/);
});

test('metrics report includes raw/approximate/missing and cannot claim growth from a single snapshot', async t => {
  const store = await fixture(t);
  const clip = source('j', { metrics: { likes: metric(1200, '1.2k', true) } });
  store.upsertSource(clip); store.recordSnapshot(clip);
  const wiki = { listSocialNotes: () => [{ ...clip, confirmed: false, createdAt: clip.fetchedAt }] };
  const result = await handleSocialCommand(`点赞变化 ${clip.canonicalUrl}`, { store, wiki });
  assert.match(result.markdown, /只有一次快照，尚不能判断变化/);
  assert.match(result.markdown, /约 1,200（原始显示：1.2k）/);
  assert.match(result.markdown, /评论：未取得/);
  assert.doesNotMatch(result.markdown, /增长|变化 \+/);
});

test('pending curated-only topic can be discovered by index match without exposing its content', async t => {
  const store = await fixture(t);
  const wiki = { listSocialNotes: ({ query }) => {
    assert.equal(query, '磁轴');
    return [{ ...source('hidden', { title: '新品体验', tags: [] }), createdAt: '2026-09-08', confirmed: false, summary: '', answer: '', queryMatched: true }];
  } };
  const result = await handleSocialCommand('/收藏 未确认 磁轴', { store, wiki });
  assert.match(result.markdown, /新品体验/);
  assert.match(result.markdown, /待确认/);
});

test('planning examples remove writing rhetoric while retaining explicit analysis subjects', async t => {
  const now = new Date('2026-09-08T00:00:00Z');
  for (const sentence of ['结合这些收藏，帮我写一份竞品分析', '参考我收藏的内容，生成一个分析报告']) {
    const parsed = parseSocialIntent(sentence, { now });
    assert.equal(parsed.kind, 'analysis'); assert.equal(parsed.query, '', sentence);
  }
  let parsed = parseSocialIntent('根据我确认过的资料，整理磁轴键盘的常见问题', { now });
  assert.equal(parsed.query, '磁轴键盘'); assert.equal(parsed.confirmedOnly, true);
  assert.equal(parseSocialIntent('根据我确认过的资料，整理 X9 HE 的常见问题').query, 'X9 HE');
  for (const sentence of ['这个月我收藏了多少篇小红书的内容', '这周我收藏的小红书内容有多少篇', '统计一下这个月我收藏了多少篇小红书的内容']) {
    parsed = parseSocialIntent(sentence, { now });
    assert.equal(parsed.kind, 'stats'); assert.equal(parsed.query, '', sentence); assert.equal(parsed.platform, 'xiaohongshu');
  }
  const store = await fixture(t);
  const notes = [
    { ...source('x9', { title: 'X9 HE 磁轴键盘', tags: [] }), confirmed: true, createdAt: '2026-09-08', answer: 'X9 HE 的已审核结论' },
    { ...source('x8', { title: 'X8 HE 磁轴键盘', tags: [] }), confirmed: true, createdAt: '2026-09-08', answer: 'X8 HE 另一型号的已审核结论' },
    { ...source('x90', { title: 'X90 HE 磁轴键盘', tags: [] }), confirmed: true, createdAt: '2026-09-08', answer: 'X90 HE 不可混淆的型号结论' },
    { ...source('pending'), confirmed: false, createdAt: '2026-09-08', answer: '未确认隐藏事实' }
  ];
  const wiki = { listSocialNotes: () => notes };
  const broad = await handleSocialCommand('结合这些收藏，帮我写一份竞品分析', { wiki, store, now });
  assert.match(broad.agentContext, /X9 HE 的已审核结论/); assert.match(broad.agentContext, /X8 HE 另一型号/);
  assert.doesNotMatch(broad.agentContext, /未确认隐藏事实/);
  const targeted = await handleSocialCommand('根据我确认过的资料，整理 X9 HE 的常见问题', { wiki, store, now });
  assert.match(targeted.agentContext, /X9 HE 的已审核结论/); assert.doesNotMatch(targeted.agentContext, /X8 HE 另一型号|X90 HE 不可混淆/);
  const missing = await handleSocialCommand('根据我确认过的资料，整理 G9 HE 的常见问题', { wiki, store, now });
  assert.equal(missing.agentContext, undefined); // An explicit unmatched model must never broaden to all notes.
  const stats = await handleSocialCommand('这个月我收藏了多少篇小红书的内容', { wiki, store, now });
  assert.match(stats.markdown, /共 4 篇收藏，当前已确认 3 篇/); assert.equal(stats.agentContext, undefined);
});

test('JSON-LD interaction types stay in their named metric and changed provenance is not comparable', async t => {
  const store = await fixture(t);
  const clip = source('jsonld'); store.upsertSource(clip);
  store.recordSnapshot({ ...clip, metrics: { comments: metric(7, '7', false, 'jsonld:CommentAction') } });
  let comparison = store.compareMetrics(clip.sourceKey);
  assert.equal(comparison.metrics.views.current, null);
  assert.equal(comparison.metrics.comments.current.value, 7);
  store.recordSnapshot({ ...clip, fetchedAt: '2026-09-08T00:00:00Z', metrics: { comments: metric(9, '9', false, 'dom:comments'), views: metric(150, '150', false, 'jsonld:ViewAction') } });
  comparison = store.compareMetrics(clip.sourceKey);
  assert.equal(comparison.metrics.comments.status, 'incomparable'); assert.equal(comparison.metrics.comments.delta, null);
  assert.equal(comparison.metrics.views.status, 'missing'); assert.equal(comparison.metrics.views.delta, null);
  assert.equal(normalizeMetrics({ views: metric(42, '42', false, 'https://schema.org/CommentAction') }).views, null);
  assert.equal(normalizeMetrics({ comments: metric(42, '42', false, 'https://schema.org/CommentAction') }).comments.value, 42);
});

test('current catalog is paginated for exact counts and cancellation is respected', async t => {
  const store = await fixture(t);
  const notes = Array.from({ length: 10001 }, (_, i) => ({ path: `/isolated/large-${i}.md`, title: `收藏 ${i}`, platform: 'web', createdAt: '2026-09-08', confirmed: i % 2 === 0 }));
  const offsets = [];
  const wiki = { listSocialNotes: ({ offset, limit }) => { offsets.push(offset); return notes.slice(offset, offset + limit); } };
  const result = await handleSocialCommand('/收藏统计', { store, wiki });
  assert.match(result.markdown, /共 10001 篇收藏，当前已确认 5001 篇/);
  assert.deepEqual(offsets, [0, 10000]);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(handleSocialCommand('/收藏', { store, wiki, signal: abort.signal }), /已取消/);
});

test('analysis explicitly discloses document and text limits before generation', async t => {
  const store = await fixture(t);
  const notes = Array.from({ length: 13 }, (_, i) => ({ ...source('scope-' + i), confirmed: true, answer: '已确认摘要' }));
  const wiki = { listSocialNotes: () => notes };
  const result = await handleSocialCommand('/收藏分析', { store, wiki });
  assert.match(result.markdown, /12\/13 篇已确认资料/);
  assert.match(result.agentContext, /不得声称已综合全部收藏/);
  const long = await handleSocialCommand('/收藏分析', { store, wiki: { listSocialNotes: () => [{ ...notes[0], answer: '长'.repeat(9000) }] } });
  assert.match(long.markdown, /1\/1 篇已确认资料.*部分长文已截取/);
  assert.match(long.agentContext, /"truncated": true/);
});
