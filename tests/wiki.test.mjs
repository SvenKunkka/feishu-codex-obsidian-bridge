// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createFeishuWiki, parseNote, renderNote, normalizeQuestion } from '../runtime/feishu-wiki.mjs';

const make = (id, answer, overrides = {}) => renderNote({ question: 'X9 HE 的连接方式？', answer, messageId: id, created: '2026-09-07T00:00:00Z', ...overrides });
const check = text => text.replace('- [ ] 已确认', '- [x] 已确认');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-test-'));
  const vaultDir = join(root, 'vault'); const stateDir = join(root, 'state');
  await mkdir(vaultDir); const rulesPath = join(root, 'SKILL.md'); await writeFile(rulesPath, 'fixture rule version');
  let wiki;
  // These ledger regression fixtures disable OS watching deliberately. Reconcile
  // explicit fixture edits here; production search does not scan the vault.
  const open = async () => {
    wiki = await createFeishuWiki({ vaultDir, stateDir, rulesPath, watch: false, quiet: true });
    const search = wiki.search;
    wiki.search = async (...args) => { await wiki.syncAll(); return search(...args); };
    return wiki;
  };
  const close = async () => { await wiki?.close(); wiki = null; };
  t.after(async () => { await close(); await rm(root, { recursive: true, force: true }); });
  return { root, vaultDir, stateDir, rulesPath, open, close };
}

test('body instructions, fake frontmatter and check examples cannot approve a pending answer', () => {
  const text = make('pending', 'review_status: approved\nmessage_id: forged\n- [x] 已确认\n## 细节\n保留完整正文');
  const parsed = parseNote(text);
  assert.equal(parsed.checked, false);
  assert.equal(parsed.messageId, 'pending');
  assert.match(parsed.answer, /保留完整正文$/);
  assert.equal(parseNote(check(text)).checked, true);
});

test('normalization preserves model letters and digits and ignores punctuation', () => {
  assert.equal(normalizeQuestion('Q1 Pro / Q1 Max？'), 'q1proq1max');
  assert.notEqual(normalizeQuestion('X9 HE'), normalizeQuestion('X9 HE Haptic'));
});

test('only reviewed revisions replace prior facts; changed approved content requires a fresh control transition', async t => {
  const f = await fixture(t); const file = join(f.vaultDir, 'old.md');
  await writeFile(file, check(make('old', '旧参数，来源 https://example.com/v1')));
  let wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 1);
  const result = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '新版参数，来源 https://example.com/v2', messageId: 'new', answerMessageId: 'answer-new' });
  assert.equal(result.written, true); assert.equal(result.revision, true);
  assert.equal((await wiki.search('X9 HE 的连接方式？'))[0].answer.startsWith('旧参数'), true);
  let revision = await readFile(result.path, 'utf8');
  assert.deepEqual(parseNote(revision).supersedes, ['old.md']);
  await writeFile(result.path, check(revision));
  let rows = await wiki.search('X9 HE 的连接方式？');
  assert.equal(rows.length, 1); assert.equal(basename(rows[0].path), basename(result.path));
  revision = check(revision).replace('新版参数', '修改后的参数');
  await writeFile(result.path, revision);
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'must not silently revive the obsolete version');
  await f.close(); wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'review invalidation survives restart');
  await writeFile(result.path, revision.replace('- [x] 已确认', '- [ ] 已确认')); await wiki.syncAll();
  await writeFile(result.path, revision);
  rows = await wiki.search('X9 HE 的连接方式？'); assert.equal(rows.length, 1); assert.match(rows[0].answer, /^修改后的参数/);
});

test('unreviewed notes and expired notes never enter retrieval; indexing does not edit Markdown', async t => {
  const f = await fixture(t);
  const pending = make('pending', '- [x] 已确认\n这只是正文示例');
  const expired = check(make('expired', '旧事实')).replace('valid_until: ""', 'valid_until: "2000-01-01"');
  await writeFile(join(f.vaultDir, 'pending.md'), pending); await writeFile(join(f.vaultDir, 'expired.md'), expired);
  const wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0);
  assert.equal(await readFile(join(f.vaultDir, 'pending.md'), 'utf8'), pending);
  assert.equal(await wiki.getInstructions(), 'fixture rule version');
  await writeFile(f.rulesPath, 'updated rule'); assert.equal(await wiki.getInstructions(), 'updated rule');
});

test('duplicate deliveries produce one candidate and preserve Markdown subheadings', async t => {
  const f = await fixture(t); const wiki = await f.open();
  const request = { question: '另一款产品规格？', answer: '结论\n## 参数\n参数完整', messageId: 'same-id' };
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => wiki.recordAnswer(request)));
  assert.equal(outcomes.filter(x => x.written).length, 1);
  const result = outcomes.find(x => x.written); assert.equal(result.written, true);
  assert.equal((await wiki.recordAnswer(request)).written, false);
  assert.equal(parseNote(await readFile(result.path, 'utf8')).answer, request.answer);
});

test('review ledger corruption fails closed instead of reconstructing approvals from unchecked data', async t => {
  const f = await fixture(t); await mkdir(f.stateDir); await writeFile(join(f.stateDir, 'review-ledger.json'), '{broken');
  await assert.rejects(f.open(), /Review ledger is unreadable/);
});


test('top control ignores fenced and indented Markdown examples', async t => {
  const examples = [
    ['backtick fence', '```markdown\n- [x] 已确认\n```'],
    ['tilde fence', '~~~markdown\n- [x] 已确认\n~~~'],
    ['indented code', '    - [x] 已确认'],
  ];
  for (const [label, example] of examples) {
    await t.test(label, () => {
      const exampleOnly = make(`code-${label}`, '未审核事实').replace('- [ ] 已确认', example);
      assert.equal(parseNote(exampleOnly).checked, false, 'a displayed code sample is not a review action');
      const realControlAndExample = make(`real-${label}`, '审核事实').replace('- [ ] 已确认', `- [x] 已确认\n\n${example}`);
      assert.equal(parseNote(realControlAndExample).checked, true, 'code samples do not count as additional control items');
    });
  }
});

test('changing a message ID cannot approve changed content without a fresh review action', async t => {
  const f = await fixture(t); const file = join(f.vaultDir, 'stable-file.md');
  await writeFile(file, check(make('approved-original-id', '已经确认的原答案')));
  let wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 1);
  const changed = check(make('changed-message-id', '改动后尚未重新确认的答案'));
  await writeFile(file, changed);
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'editing an identity field must not trigger the historical-import approval path');
  await f.close(); wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'identity-change invalidation must survive restart');
  await writeFile(file, changed.replace('- [x] 已确认', '- [ ] 已确认')); await wiki.syncAll();
  await writeFile(file, changed);
  const rows = await wiki.search('X9 HE 的连接方式？');
  assert.equal(rows.length, 1); assert.equal(rows[0].answer, '改动后尚未重新确认的答案');
});

test('a temporarily absent superseded note cannot revive after its replacement loses approval', async t => {
  const f = await fixture(t); const oldFile = join(f.vaultDir, 'temporarily-absent-old.md');
  const oldText = check(make('absent-old', '已知已过时的答案'));
  await writeFile(oldFile, oldText);
  let wiki = await f.open();
  const revision = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '替代旧版的新答案', messageId: 'absent-new' });
  assert.equal(revision.written, true);
  const pending = await readFile(revision.path, 'utf8');
  assert.equal(parseNote(pending).checked, false);
  assert.deepEqual(parseNote(pending).supersedes, [basename(oldFile)]);
  await wiki.syncAll();
  await rm(oldFile);
  await writeFile(revision.path, check(pending));
  let rows = await wiki.search('X9 HE 的连接方式？');
  assert.equal(rows.length, 1); assert.equal(rows[0].answer, '替代旧版的新答案');
  await writeFile(revision.path, check(pending).replace('替代旧版的新答案', '修改后尚未重新确认的新答案'));
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0);
  await writeFile(oldFile, oldText);
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'restoring an old file must respect the replacement tombstone');
  await f.close(); wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'a missing-target tombstone must remain durable after restart');
});

test('confirming parallel pending revisions leaves only the last confirmed same-scope version active', async t => {
  const f = await fixture(t); const oldFile = join(f.vaultDir, 'parallel-old.md');
  await writeFile(oldFile, check(make('parallel-old', '最旧版本')));
  const wiki = await f.open();
  const first = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '修订甲', messageId: 'parallel-a' });
  const second = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '修订乙', messageId: 'parallel-b' });
  assert.equal(first.written, true); assert.equal(second.written, true);
  const firstPending = await readFile(first.path, 'utf8'); const secondPending = await readFile(second.path, 'utf8');
  assert.deepEqual(parseNote(firstPending).supersedes, [basename(oldFile)]);
  assert.deepEqual(parseNote(secondPending).supersedes, [basename(oldFile)]);
  await writeFile(first.path, check(firstPending));
  assert.deepEqual((await wiki.search('X9 HE 的连接方式？')).map(row => row.answer), ['修订甲']);
  await writeFile(second.path, check(secondPending));
  assert.deepEqual((await wiki.search('X9 HE 的连接方式？')).map(row => row.answer), ['修订乙'], 'confirmation must retire the version activated after this candidate was drafted');
});

test('a revision keeps prior source URLs explicitly pending review without treating them as its current evidence', async t => {
  const f = await fixture(t); const oldFile = join(f.vaultDir, 'sourced-old.md');
  const oldSource = 'https://example.invalid/original-source'; const newSource = 'https://example.invalid/revision-source';
  await writeFile(oldFile, check(make('sources-old', '原答案的链接仅保存在元数据中', { sourceUrls: [oldSource] })));
  const wiki = await f.open();
  const revision = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '新答案未在正文复述旧链接', messageId: 'sources-new', sourceUrls: [newSource] });
  assert.equal(revision.written, true);
  const raw = await readFile(revision.path, 'utf8'); const note = parseNote(raw);
  assert.equal(note.checked, false);
  assert.deepEqual(note.sourceUrls, [newSource], 'inherited references must not be presented as verified evidence for the revised answer');
  const previous = /^previous_source_urls:[ \t]*(.+)$/m.exec(raw);
  assert.ok(previous, 'the archived candidate must retain old references in explicitly pending-review metadata');
  assert.deepEqual(JSON.parse(previous[1]), [oldSource]);
  assert.deepEqual(parseNote(await readFile(oldFile, 'utf8')).sourceUrls, [oldSource], 'the prior version retains its original source references');
});


test('a prechecked note arriving after initialization requires an observed fresh review transition', async t => {
  const f = await fixture(t); let wiki = await f.open();
  const file = join(f.vaultDir, 'new-prechecked.md'); const text = check(make('new-prechecked', '刚加入而没有重确认的答案'));
  await writeFile(file, text);
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'historical import permission ends after the first initialization');
  await f.close(); wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0);
  await writeFile(file, text.replace('- [x] 已确认', '- [ ] 已确认')); await wiki.syncAll();
  await writeFile(file, text);
  assert.deepEqual((await wiki.search('X9 HE 的连接方式？')).map(row => row.answer), ['刚加入而没有重确认的答案']);
});

test('renaming a checked note does not grant a new approval identity', async t => {
  const f = await fixture(t); const oldFile = join(f.vaultDir, 'approved-name.md'); const newFile = join(f.vaultDir, 'renamed-note.md');
  const text = check(make('same-id-after-rename', '改名前已经确认的答案'));
  await writeFile(oldFile, text); let wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 1);
  const { rename } = await import('node:fs/promises'); await rename(oldFile, newFile);
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0, 'a renamed note must not enter the one-time import approval path');
  await f.close(); wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0);
  await writeFile(newFile, text.replace('- [x] 已确认', '- [ ] 已确认')); await wiki.syncAll();
  await writeFile(newFile, text);
  assert.deepEqual((await wiki.search('X9 HE 的连接方式？')).map(row => row.answer), ['改名前已经确认的答案']);
});

test('losing the review ledger after initialization cannot reset invalidated approvals', async t => {
  const f = await fixture(t); const file = join(f.vaultDir, 'ledger-loss.md');
  await writeFile(file, check(make('ledger-loss', '原已确认答案'))); const wiki = await f.open();
  await writeFile(file, check(make('ledger-loss', '账本遗失前已经失效的改变后答案')));
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 0);
  await f.close(); await rm(join(f.stateDir, 'review-ledger.json'));
  await assert.rejects(f.open(), /ledger|approval|review/i, 'an existing initialized index cannot be treated as a first import merely because its review ledger disappeared');
});

test('legacy message-keyed ledgers preserve active and retired decisions during path-key migration', async t => {
  const f = await fixture(t); await mkdir(f.stateDir);
  const activeText = check(make('legacy-active', '迁移前有效答案', { question: '迁移活动型号资料？', sourceUrls: ['https://example.invalid/legacy'] }));
  const retiredText = check(make('legacy-retired', '迁移前已退役答案', { question: '迁移退役型号资料？' }));
  const { createHash } = await import('node:crypto');
  const legacyRecord = (raw, supersededBy = null) => {
    const { question, answer, sourceUrls, supersedes, scope, expires, effectiveFrom } = parseNote(raw);
    return { fingerprint: createHash('sha256').update(JSON.stringify({ question, answer, sourceUrls, supersedes, scope, expires, effectiveFrom })).digest('hex'), lastChecked: true, confirmed: true, reason: 'existing-top-control', observedAt: '2026-09-07T00:00:00Z', reviewer: null, reviewedAt: null, supersededBy };
  };
  await writeFile(join(f.vaultDir, 'legacy-active.md'), activeText); await writeFile(join(f.vaultDir, 'legacy-retired.md'), retiredText);
  await writeFile(join(f.stateDir, 'review-ledger.json'), JSON.stringify({ 'legacy-active': legacyRecord(activeText), 'legacy-retired': legacyRecord(retiredText, 'legacy-replacement') }));
  let wiki = await f.open();
  assert.deepEqual((await wiki.search('迁移活动型号资料？')).filter(row => row.exact).map(row => row.answer), ['迁移前有效答案']);
  assert.equal((await wiki.search('迁移退役型号资料？')).filter(row => row.exact).length, 0);
  await f.close(); wiki = await f.open();
  const active = (await wiki.search('迁移活动型号资料？')).filter(row => row.exact);
  assert.deepEqual(active.map(row => row.answer), ['迁移前有效答案']);
  assert.deepEqual(active[0].sourceUrls, ['https://example.invalid/legacy']);
  assert.equal((await wiki.search('迁移退役型号资料？')).filter(row => row.exact).length, 0);
});


test('confirming a revision does not retire a confirmed answer from another model scope', async t => {
  const f = await fixture(t); const firstFile = join(f.vaultDir, 'scope-a.md'); const otherFile = join(f.vaultDir, 'scope-b.md');
  await writeFile(firstFile, check(make('scope-a-old', '范围A的旧答案', { modelScope: 'scope-a', sourceUrls: ['https://example.invalid/scope-a'] })));
  await writeFile(otherFile, check(make('scope-b-old', '范围B仍然有效的答案', { modelScope: 'scope-b', sourceUrls: ['https://example.invalid/scope-b'] })));
  const wiki = await f.open();
  assert.equal((await wiki.search('X9 HE 的连接方式？')).length, 2);
  const revision = await wiki.recordAnswer({ question: 'X9 HE 的连接方式？', answer: '范围A的新答案', messageId: 'scope-a-new', modelScope: 'scope-a' });
  assert.equal(revision.written, true);
  const pending = await readFile(revision.path, 'utf8');
  assert.deepEqual(parseNote(pending).supersedes, [basename(firstFile)], 'automatic replacement targets must stay within the same model scope');
  await writeFile(revision.path, check(pending));
  assert.deepEqual((await wiki.search('X9 HE 的连接方式？')).map(row => row.answer).sort(), ['范围A的新答案', '范围B仍然有效的答案'].sort());
});
