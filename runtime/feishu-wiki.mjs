import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile, link, unlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSocialNote } from './social-note.mjs';
import { effectiveNotePlatform } from './link-platforms.mjs';
import { bridgeConfig } from './config.mjs';

export const RULES_VERSION = '2026-09-08.1';
const digest = value => createHash('sha256').update(value).digest('hex');

export function normalizeQuestion(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function metadata(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const result = {};
  if (!match) return { fields: result, body: raw };
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (!item) continue;
    try { result[item[1]] = JSON.parse(item[2]); }
    catch { result[item[1]] = item[2].replace(/^['"]|['"]$/g, ''); }
  }
  return { fields: result, body: raw.slice(match[0].length) };
}

export function parseNote(raw) {
  const { fields, body } = metadata(raw);
  if (fields.note_type === 'social_clip') {
    const social = parseSocialNote(raw);
    if (!social) return null;
    const list = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
    const sourceUrls = list(fields.source_urls);
    if (!sourceUrls.length && (fields.canonical_url || fields.source_url)) sourceUrls.push(String(fields.canonical_url || fields.source_url));
    return {
      noteType: 'social_clip', title: social.title, question: social.title,
      answer: social.curatedText, checked: social.checked, fingerprint: social.fingerprint,
      messageId: String(fields.message_id ?? ''), answerMessageId: String(fields.answer_message_id ?? ''),
      sourceUrls, previousSourceUrls: list(fields.previous_source_urls), supersedes: [],
      scope: String(fields.model_scope ?? 'social_clip'), expires: String(fields.valid_until ?? ''),
      effectiveFrom: String(fields.effective_from ?? ''),
      inactive: ['revoked','superseded','expired','needs_review','rejected'].includes(String(fields.review_status ?? '')),
      reviewer: String(fields.reviewed_by ?? ''), reviewedAt: String(fields.reviewed_at ?? ''),
      platform: effectiveNotePlatform(fields.platform, fields.canonical_url || fields.source_url), sourceKey: String(fields.source_key ?? ''),
      canonicalUrl: String(fields.canonical_url ?? ''), sourceUrl: String(fields.source_url ?? sourceUrls[0] ?? ''),
      author: String(fields.author ?? ''), publishedAt: String(fields.published_at ?? ''),
      fetchedAt: String(fields.fetched_at ?? ''), createdAt: String(fields.created ?? fields.created_at ?? ''),
      tags: list(fields.tags), fetchStatus: String(fields.fetch_status ?? ''), socialVersion: Number(fields.social_version ?? 1)
    };
  }
  const questionHeading = /^##[ \t]+问题[ \t]*\r?$/m.exec(body);
  const answerHeading = /^##[ \t]+答案[ \t]*\r?$/m.exec(body);
  if (!questionHeading || !answerHeading || answerHeading.index <= questionHeading.index) return null;
  // Only the independent control block before any body section can confer approval.
  const firstSection = body.search(/^##[ \t]+/m);
  const control = body.slice(0, firstSection < 0 ? 0 : firstSection);
  let fence = null;
  const visibleControl = control.split(/\r?\n/).filter(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      return false;
    }
    if (marker) { fence = marker[1]; return false; }
    return !/^(?: {4}|\t)/.test(line);
  }).join('\n');
  const controls = [...visibleControl.matchAll(/^- +\[([ xX])\] +已确认[ \t]*$/gm)];
  const checked = controls.length === 1 && controls[0][1].toLowerCase() === 'x';
  const list = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
  const question = body.slice(questionHeading.index + questionHeading[0].length, answerHeading.index).trim();
  const answer = body.slice(answerHeading.index + answerHeading[0].length).trim();
  const sourceUrls = list(fields.source_urls);
  const previousSourceUrls = list(fields.previous_source_urls);
  const supersedes = list(fields.supersedes).map(value => basename(value));
  const scope = String(fields.model_scope ?? '').normalize('NFKC').trim().toLowerCase();
  const expires = String(fields.valid_until ?? '');
  const effectiveFrom = String(fields.effective_from ?? '');
  const inactive = ['revoked', 'superseded', 'expired', 'needs_review', 'rejected'].includes(String(fields.review_status ?? ''));
  return {
    noteType: 'qa', title: question, createdAt: String(fields.created ?? ''),
    messageId: String(fields.message_id ?? ''), answerMessageId: String(fields.answer_message_id ?? ''),
    question, answer, checked, sourceUrls, previousSourceUrls, supersedes, scope, expires, effectiveFrom, inactive,
    reviewer: String(fields.reviewed_by ?? ''), reviewedAt: String(fields.reviewed_at ?? ''),
    fingerprint: digest(JSON.stringify({ messageId: String(fields.message_id ?? ''), question, answer, sourceUrls, previousSourceUrls, supersedes, scope, expires, effectiveFrom }))
  };
}

export function reviewTransition(previous, note, now = new Date().toISOString()) {
  const changed = previous && previous.fingerprint !== note.fingerprint;
  let confirmed = false;
  let reason = 'unchecked';
  if (note.checked) {
    if (!previous) { confirmed = true; reason = 'existing-top-control'; }
    else if (!previous.lastChecked) { confirmed = true; reason = 'top-control-transition'; }
    else if (previous.confirmed && !changed) { confirmed = true; reason = previous.reason; }
    else reason = 'content-changed-reconfirmation-required';
  }
  if (note.inactive) { confirmed = false; reason = 'inactive-metadata'; }
  return {
    fingerprint: note.fingerprint, lastChecked: note.checked, confirmed, reason,
    // This is an observation time, never presented as a verified human review timestamp.
    observedAt: now, reviewer: note.reviewer || null, reviewedAt: note.reviewedAt || null,
    supersededBy: previous?.supersededBy ?? null
  };
}

export async function createFeishuWiki(options = {}) {
  const vaultDir = resolve(options.vaultDir ?? bridgeConfig.vaultDir);
  const stateDir = options.stateDir ?? bridgeConfig.stateDir;
  const rulesPath = options.rulesPath ?? bridgeConfig.rulesPath;
  await mkdir(vaultDir, { recursive: true });
  await mkdir(stateDir, { recursive: true, mode:0o700 });
  const ledgerPath = join(stateDir, 'review-ledger.json');
  let ledger = {};
  let initialImport = false;
  try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Review ledger is unreadable; refusing to reset approvals', { cause: error });
    initialImport = true;
  }
  if (!ledger || Array.isArray(ledger) || typeof ledger !== 'object') throw new Error('Invalid review ledger');
  const dbPath = join(stateDir, 'index.db');
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=3000;");
  db.exec("CREATE TABLE IF NOT EXISTS wiki_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  if (initialImport && db.prepare("SELECT value FROM wiki_meta WHERE key='review-ledger-initialized'").get()) {
    db.close(); throw new Error('Review ledger is missing after initialization; refusing to reconstruct approvals');
  }
  db.exec("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, message_id TEXT, answer_message_id TEXT, normalized_question TEXT NOT NULL DEFAULT '', question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0, mtime_ms REAL NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);");
  const columns = new Set(db.prepare('PRAGMA table_info(notes)').all().map(row => row.name));
  for (const name of ['source_urls','supersedes','model_scope','valid_until','effective_from','review_key','previous_source_urls','note_type','extra']) {
    if (!columns.has(name)) db.exec("ALTER TABLE notes ADD COLUMN " + name + " TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path UNINDEXED,question,answer,tokenize='trigram'); CREATE TABLE IF NOT EXISTS notes_terms (term TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(term,path)) WITHOUT ROWID; CREATE INDEX IF NOT EXISTS notes_terms_path ON notes_terms(path); CREATE INDEX IF NOT EXISTS notes_exact ON notes(normalized_question,confirmed); CREATE INDEX IF NOT EXISTS notes_type ON notes(note_type);");
  let rebuildRequired = db.prepare("SELECT value FROM wiki_meta WHERE key='index-schema'").get()?.value !== '2026-09-08.1' || ledger._meta?.schemaVersion !== 2;
  const names = ['path','message_id','answer_message_id','normalized_question','question','answer','confirmed','mtime_ms','size','sha256','updated_at','source_urls','supersedes','model_scope','valid_until','effective_from','review_key','previous_source_urls','note_type','extra'];
  const upsert = db.prepare("INSERT INTO notes(" + names.join(',') + ") VALUES(" + names.map(() => '?').join(',') + ") ON CONFLICT(path) DO UPDATE SET " + names.slice(1).map(name => name + '=excluded.' + name).join(','));
  const getRow = db.prepare('SELECT * FROM notes WHERE path=?');
  const removeFts = db.prepare('DELETE FROM notes_fts WHERE path=?');
  const addFts = db.prepare('INSERT INTO notes_fts(path,question,answer) VALUES(?,?,?)');
  const removeTerms = db.prepare('DELETE FROM notes_terms WHERE path=?');
  const addTerm = db.prepare('INSERT OR IGNORE INTO notes_terms(term,path) VALUES(?,?)');
  const exactQuery = db.prepare("SELECT * FROM notes WHERE normalized_question=? AND confirmed=1 ORDER BY updated_at DESC");
  const byMessage = db.prepare('SELECT path FROM notes WHERE message_id=? LIMIT 1');
  const dirty = new Set();
  const counters = { directoryScans: 0, filesRead: 0, indexWrites: 0, flushes: 0 };
  let closed = false;
  let watcher;
  let timer;
  let watcherError = null;
  let chain = Promise.resolve();
  let records = Promise.resolve();
  const log = (event, fields = {}) => { if (options.quiet !== true) console.log('[feishu-wiki] ' + event + ' ' + JSON.stringify(fields)); };
  const enqueue = task => {
    const next = chain.then(() => { if (closed) throw new Error('Wiki is closed'); return task(); });
    chain = next.catch(() => {});
    return next;
  };
  const allowedPath = file => dirname(resolve(file)) === vaultDir && basename(file).endsWith('.md') && !basename(file).startsWith('.');
  const markDirty = file => { if (allowedPath(file)) dirty.add(resolve(file)); };

  async function readStable(file) {
    // Hash candidates even when size/mtime are unchanged. Index/cache timestamps
    // alone cannot prove that a user's latest edit is the reviewed version.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const before = await stat(file);
        if (!before.isFile()) return null;
        counters.filesRead++;
        const raw = await readFile(file, 'utf8');
        const after = await stat(file);
        if (before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.size === after.size && before.ino === after.ino) {
          return { file, raw, stats: after, note: parseNote(raw), sha: digest(raw) };
        }
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }
    markDirty(file);
    throw new Error('Note is being edited; retry after the save completes');
  }

  async function processFiles(files, force = false) {
    if (!files.length) return;
    const changed = [];
    const removed = [];
    for (const file of new Set(files)) {
      const item = await readStable(file);
      if (!item?.note?.question || (item.note.noteType !== 'social_clip' && !item.note.answer?.trim())) { if (getRow.get(file)) removed.push(file); continue; }
      const previousRow = getRow.get(file);
      if (!force && previousRow?.sha256 === item.sha) continue;
      changed.push(item);
    }
    if (!changed.length && !removed.length && !force) return;
    const nextLedger = structuredClone(ledger);
    const meta = nextLedger._meta ??= { schemaVersion: 2, sequence: 0, retiredPaths: {} };
    meta.retiredPaths ??= {};
    const legacy = ledger._meta?.schemaVersion !== 2;
    for (const item of changed) {
      const name = basename(item.file);
      item.key = 'path:' + name;
      let previous = ledger[item.key];
      if (!previous && legacy && ledger[item.note.messageId]) {
        previous = { ...ledger[item.note.messageId] };
        const { question,answer,sourceUrls,supersedes,scope,expires,effectiveFrom } = item.note;
        const legacyHash = digest(JSON.stringify({ question,answer,sourceUrls,supersedes,scope,expires,effectiveFrom }));
        if (previous.fingerprint === legacyHash) previous.fingerprint = item.note.fingerprint;
      }
      // v1 social content used to mix raw excerpts with curated answers. Never
      // silently transfer a raw-body approval to the new curated-only contract.
      if (!previous && (!initialImport || (item.note.noteType === 'social_clip' && item.note.socialVersion < 2))) {
        previous = { lastChecked: true, confirmed: false, fingerprint: '', reason: 'new-note-reconfirmation-required' };
      }
      const next = reviewTransition(previous, item.note);
      next.path = name;
      next.normalizedQuestion = item.note.noteType === 'social_clip'
        ? 'social:' + (item.note.sourceKey || item.note.canonicalUrl || name)
        : normalizeQuestion(item.note.question);
      next.scope = item.note.scope;
      const newlyConfirmed = next.confirmed && (!previous?.confirmed || !previous?.lastChecked);
      next.approvalSequence = previous?.approvalSequence ?? 0;
      if (newlyConfirmed) next.approvalSequence = ++meta.sequence;
      const retirement = meta.retiredPaths[name];
      if (typeof retirement === 'string') next.supersededBy = retirement;
      else if (retirement && retirement.normalizedQuestion === next.normalizedQuestion && retirement.scope === next.scope) next.supersededBy = retirement.by;
      if (previous && JSON.stringify({ ...next,observedAt:'' }) === JSON.stringify({ ...previous,observedAt:'' })) next.observedAt = previous.observedAt;
      nextLedger[item.key] = next;
      item.newlyConfirmed = newlyConfirmed && !next.supersededBy;
    }
    const retiredPaths = new Set();
    for (const item of changed.filter(x => x.newlyConfirmed).sort((a,b) => nextLedger[a.key].approvalSequence - nextLedger[b.key].approvalSequence)) {
      const currentReview = nextLedger[item.key];
      if (currentReview.supersededBy) continue;
      const retired = new Set(item.note.supersedes.filter(name => {
        if (name === basename(item.file)) return false;
        const target = nextLedger['path:' + name];
        return !target || (target.normalizedQuestion === currentReview.normalizedQuestion && target.scope === currentReview.scope);
      }));
      for (const [key, old] of Object.entries(nextLedger)) {
        if (key === '_meta' || key === item.key || !old.path) continue;
        if (old.normalizedQuestion === currentReview.normalizedQuestion && old.scope === currentReview.scope &&
            old.confirmed && old.approvalSequence < currentReview.approvalSequence) retired.add(old.path);
      }
      for (const name of retired) {
        meta.retiredPaths[name] = { by:item.key,normalizedQuestion:currentReview.normalizedQuestion,scope:currentReview.scope };
        if (nextLedger['path:' + name]) nextLedger['path:' + name].supersededBy = item.key;
        retiredPaths.add(join(vaultDir,name));
      }
    }
    meta.schemaVersion = 2;
    // Ledger is the authority; it must commit before rebuildable index changes.
    if (JSON.stringify(nextLedger) !== JSON.stringify(ledger)) {
      const temp = ledgerPath + '.' + process.pid + '.tmp';
      await writeFile(temp, JSON.stringify(nextLedger,null,2) + '\n', { mode:0o600 });
      await rename(temp,ledgerPath);
      ledger = nextLedger;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const file of removed) {
        removeFts.run(file); removeTerms.run(file); db.prepare('DELETE FROM notes WHERE path=?').run(file);
        counters.indexWrites++;
      }
      for (const { file,note,stats,sha,key } of changed) {
        const review = ledger[key];
        const confirmed = review.confirmed && !review.supersededBy;
        const extra = {
          title:note.title, platform:note.platform ?? '', sourceKey:note.sourceKey ?? '',
          canonicalUrl:note.canonicalUrl ?? '', sourceUrl:note.sourceUrl ?? '', author:note.author ?? '',
          publishedAt:note.publishedAt ?? '', fetchedAt:note.fetchedAt ?? '', createdAt:note.createdAt ?? '',
          tags:note.tags ?? [], fetchStatus:note.fetchStatus ?? '', socialVersion:note.socialVersion ?? 0
        };
        upsert.run(file,note.messageId || null,note.answerMessageId || null,normalizeQuestion(note.question),note.question,note.answer,
          confirmed ? 1 : 0,stats.mtimeMs,stats.size,sha,review.observedAt,JSON.stringify(note.sourceUrls),
          JSON.stringify(note.supersedes),note.scope,note.expires,note.effectiveFrom,key,JSON.stringify(note.previousSourceUrls),note.noteType,JSON.stringify(extra));
        removeFts.run(file); removeTerms.run(file);
        // Pending social notes remain discoverable, but result shaping withholds
        // their answer unless the caller uses the current confirmed knowledge API.
        addFts.run(file,note.question,note.answer);
        for (const term of indexTerms(note.question + '\n' + note.answer + '\n' + (note.tags ?? []).join(' '))) addTerm.run(term,file);
        counters.indexWrites++;
      }
      for (const file of retiredPaths) db.prepare('UPDATE notes SET confirmed=0 WHERE path=?').run(file);
      db.prepare("INSERT INTO wiki_meta(key,value) VALUES('review-ledger-initialized','2') ON CONFLICT(key) DO NOTHING").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    initialImport = false;
    log('incremental-sync', { changed:changed.length, removed:removed.length, rulesVersion:RULES_VERSION });
  }

  async function reconcileInternal() {
    counters.directoryScans++;
    const entries = await readdir(vaultDir,{ withFileTypes:true });
    const files = new Set(entries.filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.')).map(e => join(vaultDir,e.name)));
    for (const row of db.prepare('SELECT path FROM notes').all()) files.add(row.path);
    await processFiles([...files],rebuildRequired);
    // Empty vaults must still complete initial import; otherwise the first later
    // prechecked addition would accidentally acquire historical-import approval.
    if (initialImport) {
      const next = { ...ledger,_meta:ledger._meta ?? {schemaVersion:2,sequence:0,retiredPaths:{}} };
      const temp = ledgerPath + '.' + process.pid + '.tmp';
      await writeFile(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600}); await rename(temp,ledgerPath);
      ledger = next; initialImport = false;
      db.prepare("INSERT INTO wiki_meta(key,value) VALUES('review-ledger-initialized','2') ON CONFLICT(key) DO NOTHING").run();
    }
    watcherError = null;
    db.prepare("INSERT INTO wiki_meta(key,value) VALUES('index-schema','2026-09-08.1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    rebuildRequired = false;
  }
  const syncAll = () => enqueue(reconcileInternal);
  async function flushInternal() {
    counters.flushes++;
    for (let round = 0; dirty.size && round < 12; round++) {
      const files = [...dirty]; dirty.clear();
      try { await processFiles(files); }
      catch (error) { for (const file of files) dirty.add(file); throw error; }
    }
    if (dirty.size) throw new Error('Wiki edits are still arriving; retry after the save completes');
    if (watcherError) throw new Error('Wiki file watcher is unavailable; explicit reconciliation is required', {cause:watcherError});
  }
  const flushChanges = (paths = []) => {
    for (const file of Array.isArray(paths) ? paths : [paths]) if (file) markDirty(file);
    clearTimeout(timer);
    return enqueue(flushInternal);
  };
  const day = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  };
  const nowDate = () => day(options.now?.() ?? new Date());
  function currentReason(row) {
    const date = nowDate();
    if (row.valid_until && (!validDate(row.valid_until) || row.valid_until < date)) return 'expired';
    if (row.effective_from && (!validDate(row.effective_from) || row.effective_from > date)) return 'not-yet-effective';
    if (!row.answer.trim()) return 'empty-curated-content';
    const review = ledger[row.review_key];
    if (!review) return 'missing-review';
    if (review.supersededBy) return 'superseded';
    if (!review.confirmed || !row.confirmed) return review.reason || 'unchecked';
    return 'confirmed';
  }
  const current = row => currentReason(row) === 'confirmed';
  function resultRow(row) {
    const extra = JSON.parse(row.extra || '{}');
    // Unchanged v0.1 Markdown can legitimately retain a cached web category.
    // Derive it at read time too, without rebuilding the human approval ledger.
    if (row.note_type === 'social_clip') extra.platform = effectiveNotePlatform(extra.platform, extra.canonicalUrl || extra.sourceUrl);
    const confirmed = current(row);
    return { ...row,...extra,noteType:row.note_type,confirmed,reviewReason:currentReason(row),
      sourceUrls:JSON.parse(row.source_urls || '[]'),previousSourceUrls:JSON.parse(row.previous_source_urls || '[]'),
      modelScope:row.model_scope };
  }

  async function verifyRows(rows) {
    const changed = [];
    const verified = [];
    for (const row of rows) {
      const live = await readStable(row.path);
      if (!live || live.sha !== row.sha256) changed.push(row.path);
      if (live) verified.push({path:row.path,stats:live.stats});
      // Optional observation hook also makes asynchronous save races reproducible
      // in isolated tests; production does not install one.
      await options.onCandidateVerified?.({path:row.path});
    }
    if (changed.length) await processFiles(changed);
    return {changed:changed.length>0,verified};
  }
  async function settledRows(select) {
    for (let attempt=0;attempt<4;attempt++) {
      await flushInternal();
      const rows=select();
      const {changed,verified}=await verifyRows(rows);
      // A save can arrive after its own candidate was verified while other
      // candidates are still being read. Give already-queued watcher callbacks
      // a turn, then consume changes and select a fresh, reviewed result set.
      await new Promise(resolve=>setImmediate(resolve));
      // macOS may deliver coalesced fs.watch events late. A cheap final stat of
      // just the verified candidates catches saves made during this query even
      // when the watcher callback has not fired yet.
      await Promise.all(verified.map(async({path,stats})=>{
        try {
          const after=await stat(path);
          if(after.mtimeMs!==stats.mtimeMs || after.ctimeMs!==stats.ctimeMs || after.size!==stats.size || after.ino!==stats.ino) markDirty(path);
        } catch(error) { if(error.code==='ENOENT') markDirty(path);else throw error; }
      }));
      if (changed || dirty.size) continue;
      return rows;
    }
    // Ongoing edits are not a stable knowledge snapshot. Returning no evidence
    // is safer than leaking an answer whose approval has just been withdrawn.
    return [];
  }
  function candidateRows(query, {socialOnly=false,confirmedOnly=true,limit=160} = {}) {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const restrictions = (socialOnly ? " AND n.note_type='social_clip'" : '') + (confirmedOnly ? ' AND n.confirmed=1' : '');
    const sql = "SELECT n.*,COUNT(*) AS term_hits FROM notes_terms t JOIN notes n ON n.path=t.path WHERE t.term IN (" +
      terms.map(() => '?').join(',') + ')' + restrictions + ' GROUP BY n.path ORDER BY term_hits DESC,n.updated_at DESC,n.path';
    return limit == null ? db.prepare(sql).all(...terms) : db.prepare(sql + ' LIMIT ?').all(...terms,limit);
  }
  async function search(question, limit = 5) {
    await flushChanges();
    return enqueue(async () => {
      const normalized = normalizeQuestion(question);
      if (!normalized) return [];
      const capped = Math.max(1,Math.min(Number(limit)||5,50));
      const select = () => {
        const exact = exactQuery.all(normalized).filter(current);
        return exact.length ? exact : candidateRows(question).filter(current);
      };
      const rows = await settledRows(select);
      // Rank by token coverage across the complete reviewed answer. Long notes
      // must not be discarded merely because their title has low Jaccard overlap.
      const terms = searchTerms(question);
      return rows.filter(current).map(row => {
        const exact = row.normalized_question === normalized;
        const text = normalizeQuestion(row.question + '\n' + row.answer);
        const coverage = terms.filter(term => text.includes(term)).length / (terms.length || 1);
        const titleScore = similarity(normalized,normalizeQuestion(row.question));
        return { ...resultRow(row),score:exact ? 1 : coverage * 0.8 + titleScore * 0.2,exact };
      }).sort((a,b) => b.score-a.score).slice(0,capped);
    });
  }

  async function reviewStatus(file) {
    const path = resolve(file);
    if (!allowedPath(path)) return { path,confirmed:false,reviewReason:'outside-vault' };
    await flushChanges([path]);
    return enqueue(async () => {
      const rows = await settledRows(()=>{const row=getRow.get(path);return row ? [row] : [];});
      const row = rows[0];
      if (!row) return {path,confirmed:false,reviewReason:'missing-or-invalid-note'};
      const result = resultRow(row);
      return {path,confirmed:result.confirmed,reviewReason:result.reviewReason,fingerprint:ledger[row.review_key]?.fingerprint,
        checked:ledger[row.review_key]?.lastChecked ?? false,title:result.title,noteType:row.note_type};
    });
  }

  async function listSocialNotes(filters = {}) {
    await flushChanges();
    return enqueue(async () => {
      const limit = Math.max(1,Math.min(Number(filters.limit)||100,10000));
      const offset = Math.max(0,Number(filters.offset)||0);
      const queryParts = String(filters.query ?? '').split(/[\s,，;；]+/u).map(normalizeQuestion).filter(Boolean);
      const queryModels = String(filters.query ?? '').normalize('NFKC').match(/\b[a-z]{1,8}\d[a-z\d]*(?:[-_][a-z\d]+)*/giu) ?? [];
      const queryMatches = row => {
        const rawText = (row.question+'\n'+row.answer+'\n'+(row.tags ?? []).join(' ')).normalize('NFKC');
        const text = normalizeQuestion(rawText);
        return queryParts.every(part=>text.includes(part)) && queryModels.every(model=>{
          const escaped=model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          return new RegExp('(?:^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','iu').test(rawText);
        });
      };
      const select = () => {
        let rows = filters.query ? candidateRows(filters.query,{socialOnly:true,confirmedOnly:false,limit:null})
          : db.prepare("SELECT * FROM notes WHERE note_type='social_clip' ORDER BY updated_at DESC,path").all();
        return rows.map(resultRow).filter(row =>
          queryMatches(row) &&
          (!filters.confirmedOnly || row.confirmed) &&
          (!filters.platform || row.platform === filters.platform) &&
          (!filters.from || day(row.createdAt || row.fetchedAt) >= filters.from.slice(0,10)) &&
          (!filters.to || day(row.createdAt || row.fetchedAt) <= filters.to.slice(0,10))
        ).slice(offset,offset+limit);
      };
      const rows = await settledRows(select);
      return rows.map(row => ({...resultRow(getRow.get(row.path)),
        queryMatched:true,
        answer:current(getRow.get(row.path)) ? getRow.get(row.path).answer : '',
        summary:current(getRow.get(row.path)) ? getRow.get(row.path).answer : ''}));
    });
  }

  async function recordAnswerInternal(input) {
    const question = String(input.question ?? '').trim();
    const answer = String(input.answer ?? '').trim();
    const messageId = String(input.messageId ?? '').trim();
    if (!question || !answer || !messageId) return {written:false,reason:'missing-fields'};
    if (isLocalOpenOperation(question)) return {written:false,reason:'local-open-operation'};
    await flushChanges();
    if (byMessage.get(messageId)) return {written:false,reason:'duplicate-message'};
    const modelScope = String(input.modelScope ?? '').normalize('NFKC').trim().toLowerCase();
    const existing = (await search(question,50)).filter(row => row.exact && row.noteType === 'qa' && row.model_scope === modelScope);
    if (existing.some(row => row.answer.trim() === answer)) return {written:false,reason:'identical-confirmed-answer'};
    const created = new Date();
    const stamp = created.toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    const title = question.replace(/\s+/g,' ').replace(/[\\/:*?"<>|#[\]]/g,'-').slice(0,36);
    const filePath = join(vaultDir,stamp+'-'+title+'-'+digest(messageId).slice(0,12)+'.md');
    const sources = [...new Set([...(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),...Array.from(answer.matchAll(/https?:\/\/[^\s<>\)\]"）]+/g),m=>m[0])])];
    const text = renderNote({ question,answer,messageId,answerMessageId:input.answerMessageId,chatId:input.chatId,
      created:created.toISOString(),sourceUrls:sources,previousSourceUrls:[...new Set(existing.flatMap(row => row.sourceUrls.concat(row.previousSourceUrls)))],
      supersedes:existing.map(row=>basename(row.path)),modelScope });
    const tempPath = filePath+'.'+randomUUID()+'.tmp';
    await writeFile(tempPath,text,{encoding:'utf8',flag:'wx',mode:0o600});
    try { await link(tempPath,filePath); }
    catch(error) { if(error.code === 'EEXIST') return {written:false,reason:'duplicate-message-file'}; throw error; }
    finally { await unlink(tempPath); }
    await flushChanges([filePath]);
    log('answer-saved',{file:basename(filePath),revision:existing.length>0});
    return {written:true,path:filePath,revision:existing.length>0};
  }
  function recordAnswer(input) {
    const task = records.then(()=>recordAnswerInternal(input));
    records = task.catch(()=>{});
    return task;
  }
  async function getInstructions() { return readFile(rulesPath,'utf8'); }
  // Attach before startup reconciliation so changes during the scan are queued.
  if (options.watch !== false) {
    watcher = watch(vaultDir,{persistent:true},(_event,filename) => {
      if (closed) return;
      if (filename) {
        markDirty(join(vaultDir,String(filename)));
        clearTimeout(timer);
        timer = setTimeout(()=>void flushChanges().catch(error=>log('sync-failed',{error:error.message})),options.debounceMs ?? 50);
        timer.unref?.();
      } else {
        // An unnamed OS event is the only watcher-triggered reconciliation case;
        // ordinary queries never enumerate the vault as a fallback.
        void syncAll().catch(error=>{watcherError=error;log('sync-failed',{error:error.message});});
      }
    });
    watcher.on('error',error=>{watcherError=error;log('watcher-failed',{error:error.message});});
  }
  try { await syncAll(); await flushChanges(); }
  catch(error) { watcher?.close();db.close();throw error; }
  return {vaultDir,dbPath,rulesVersion:RULES_VERSION,getInstructions,search,recordAnswer,syncAll,flushChanges,listSocialNotes,reviewStatus,
    diagnostics:()=>({...counters,dirtyFiles:dirty.size,watcherHealthy:!watcherError}),
    async close() {
      clearTimeout(timer);watcher?.close();await records;
      if (!closed) {
        try { await flushChanges();await chain; }
        finally { closed=true;db.close(); }
      }
    }};
}

function indexTerms(value) {
  const text = normalizeQuestion(value);
  const terms = new Set();
  for (let i=0;i<text.length-1;i++) terms.add(text.slice(i,i+2));
  for (let i=0;i<text.length-2;i++) terms.add(text.slice(i,i+3));
  for (const word of String(value).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? []) terms.add(word);
  return terms;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function searchTerms(value) {
  const normalized = normalizeQuestion(value);
  if (!normalized) return [];
  // Bigrams support Chinese topics such as 续航, 磁轴, 配重 and short X9/QX
  // model identifiers, which trigram-only FTS cannot match.
  return [...indexTerms(value)].filter(term=>term.length >= 2).slice(0,96);
}
function ngrams(value) {
  if (!value) return [];
  if (value.length <= 3) return [value];
  return [...new Set(Array.from({ length: value.length - 2 }, (_, i) => value.slice(i, i + 3)))];
}
function similarity(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const left = new Set(ngrams(a)); const right = new Set(ngrams(b));
  const overlap = [...left].filter(x => right.has(x)).length;
  return overlap / (left.size + right.size - overlap || 1);
}
function isLocalOpenOperation(value) {
  return /^\/(?:open|打开)(?:\s|$)/iu.test(value) || /^(?:(?:请|麻烦|帮我|给我|直接|现在|把)\s*)*(?:打开|开启|定位并打开)(?:这个|该|一下)?(?:文件|文件夹|目录|路径)?(?:\s|$)/iu.test(value)
    || value.startsWith('/') || value.startsWith('~/') || /^file:\/\/\//iu.test(value) || /^\\\\[^\\]+\\/u.test(value);
}
export function renderNote(input) {
  const scalar = x => JSON.stringify(String(x ?? ''));
  return `---\ncreated: ${scalar(input.created)}\nmessage_id: ${scalar(input.messageId)}\nanswer_message_id: ${scalar(input.answerMessageId)}\nchat_id: ${scalar(input.chatId)}\nsource_urls: ${JSON.stringify(input.sourceUrls ?? [])}\nprevious_source_urls: ${JSON.stringify(input.previousSourceUrls ?? [])}\nmodel_scope: ${scalar(input.modelScope)}\neffective_from: ""\nvalid_until: ""\nreviewed_by: ""\nreviewed_at: ""\nsupersedes: ${JSON.stringify(input.supersedes ?? [])}\n---\n\n# ${input.question.replace(/\s+/g, ' ').slice(0, 120)}\n\n- [ ] 已确认\n\n## 问题\n\n${input.question}\n\n## 答案\n\n${input.answer}\n`;
}
