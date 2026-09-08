import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const METRIC_NAMES = ['likes', 'comments', 'views', 'shares', 'favorites', 'coins'];
export const SOCIAL_TIME_ZONE = 'Asia/Shanghai';

export function shanghaiDate(value = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: SOCIAL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function normalizeMetrics(metrics = {}) {
  return Object.fromEntries(METRIC_NAMES.map(name => {
    const input = metrics?.[name];
    if (!input || typeof input !== 'object' || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0) return [name, null];
    const action = /\b(Like|Comment|View|Watch|Read|Share|Bookmark|Save)Action\b/iu.exec(String(input.source ?? ''))?.[1]?.toLowerCase();
    const actionMetric = { like: 'likes', comment: 'comments', view: 'views', watch: 'views', read: 'views', share: 'shares', bookmark: 'favorites', save: 'favorites' };
    if (action && actionMetric[action] !== name) return [name, null];
    return [name, { value: input.value, raw: String(input.raw ?? input.value), approximate: Boolean(input.approximate), source: String(input.source ?? '') }];
  }));
}

function keyOf(clip) {
  const key = String(clip?.sourceKey ?? '').trim();
  if (!key) throw new Error('social sourceKey is required');
  return key;
}

function matches(clip, filters = {}) {
  if (filters.platform && clip.platform !== filters.platform) return false;
  const day = shanghaiDate(clip.createdAt || clip.created || clip.fetchedAt);
  if (filters.from && (!day || day < filters.from)) return false;
  if (filters.to && (!day || day > filters.to)) return false;
  const terms = String(filters.query ?? filters.topic ?? '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [clip.title, clip.summary, clip.author, ...(clip.tags ?? [])].join(' ').normalize('NFKC').toLowerCase();
  if (terms.some(term => !haystack.includes(term))) return false;
  // The caller must supply current approval observations. Cached clip.checked is never authoritative.
  if (filters.confirmedOnly === true && !filters.confirmedPaths?.has(clip.path)) return false;
  if (filters.pendingOnly === true && !filters.pendingPaths?.has(clip.path)) return false;
  return true;
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) for (const key of [].concat(field(item) || '未提供')) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

/** Rebuildable active-source catalog and durable historical observations. Never stores review authority. */
export function createSocialStore({ stateDir } = {}) {
  if (!stateDir) throw new Error('createSocialStore requires an explicit stateDir');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(stateDir, 'social-store.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS social_sources (
      source_key TEXT PRIMARY KEY, platform TEXT NOT NULL, path TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, clip_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS social_sources_activity ON social_sources(active,platform,created_at);
    CREATE TABLE IF NOT EXISTS social_snapshots (
      source_key TEXT NOT NULL, observed_at TEXT NOT NULL, metrics_json TEXT NOT NULL,
      PRIMARY KEY(source_key,observed_at));`);
  const find = db.prepare('SELECT * FROM social_sources WHERE source_key=?');
  const put = db.prepare(`INSERT INTO social_sources(source_key,platform,path,created_at,updated_at,active,clip_json)
    VALUES(?,?,?,?,?,1,?) ON CONFLICT(source_key) DO UPDATE SET platform=excluded.platform,path=excluded.path,
    updated_at=excluded.updated_at,active=1,clip_json=excluded.clip_json`);
  const snapshotPut = db.prepare('INSERT OR IGNORE INTO social_snapshots(source_key,observed_at,metrics_json) VALUES(?,?,?)');
  const hydrate = row => row ? { ...JSON.parse(row.clip_json), sourceKey: row.source_key, createdAt: row.created_at, active: Boolean(row.active) } : null;
  function getSource(sourceKey) { const row = find.get(String(sourceKey)); return row?.active ? hydrate(row) : null; }
  function upsertSource(clip) {
    const key = keyOf(clip);
    const previous = hydrate(find.get(key));
    const createdAt = previous?.createdAt || clip.createdAt || clip.created || clip.fetchedAt || new Date().toISOString();
    const merged = { ...previous, ...clip, sourceKey: key, createdAt, active: true };
    merged.tags = [...new Set((Array.isArray(merged.tags) ? merged.tags : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
    if (clip.metrics !== undefined) merged.metrics = normalizeMetrics(clip.metrics);
    put.run(key, String(merged.platform || 'web'), String(merged.path || ''), createdAt, new Date().toISOString(), JSON.stringify(merged));
    return merged;
  }
  function recordSnapshot(clip) {
    const key = keyOf(clip);
    const observed = new Date(clip.fetchedAt);
    if (!clip.fetchedAt || !Number.isFinite(observed.getTime())) throw new Error('metric snapshot requires a valid fetchedAt');
    const observedAt = observed.toISOString();
    const metrics = normalizeMetrics(clip.metrics);
    const result = snapshotPut.run(key, observedAt, JSON.stringify(metrics));
    return { sourceKey: key, observedAt, metrics, recorded: result.changes > 0 };
  }
  function listSources(filters = {}) {
    const rows = db.prepare(`SELECT * FROM social_sources ${filters.includeInactive ? '' : 'WHERE active=1'} ORDER BY created_at DESC,source_key`).all();
    return rows.map(hydrate).filter(clip => matches(clip, filters));
  }
  function statistics(filters = {}) {
    const clips = listSources(filters);
    return { total: clips.length, timeZone: SOCIAL_TIME_ZONE,
      byPlatform: countBy(clips, x => x.platform), byDate: countBy(clips, x => shanghaiDate(x.createdAt)),
      byTopic: countBy(clips, x => x.tags?.length ? x.tags : ['未分类']),
      confirmed: filters.confirmedPaths ? clips.filter(x => filters.confirmedPaths.has(x.path)).length : null,
      pending: filters.pendingPaths ? clips.filter(x => filters.pendingPaths.has(x.path)).length : null };
  }
  function compareMetrics(sourceKey) {
    const key = String(sourceKey);
    const source = hydrate(find.get(key));
    const rows = db.prepare('SELECT observed_at,metrics_json FROM social_snapshots WHERE source_key=? ORDER BY observed_at DESC LIMIT 2').all(key);
    const current = rows[0] && { observedAt: rows[0].observed_at, metrics: normalizeMetrics(JSON.parse(rows[0].metrics_json)) };
    const previous = rows[1] && { observedAt: rows[1].observed_at, metrics: normalizeMetrics(JSON.parse(rows[1].metrics_json)) };
    const snapshotCount = db.prepare('SELECT COUNT(*) AS n FROM social_snapshots WHERE source_key=?').get(key).n;
    const metrics = Object.fromEntries(METRIC_NAMES.map(name => {
      const a = current?.metrics[name] ?? null, b = previous?.metrics[name] ?? null;
      let status = !current ? 'no_snapshot' : !previous ? 'single_snapshot' : !a || !b ? 'missing' : 'comparable';
      if (status === 'comparable' && (!a.source || !b.source || a.source !== b.source)) status = 'incomparable';
      return [name, { current: a, previous: b, status, delta: status === 'comparable' ? a.value - b.value : null,
        approximate: Boolean(a?.approximate || b?.approximate),
        reason: status === 'incomparable' ? '指标来源或口径未明确或发生变化，未计算差值' : status === 'missing' ? '至少一次采集缺失，未知不视为零' : status === 'single_snapshot' ? '只有一次快照，不能判断变化' : status === 'no_snapshot' ? '尚无互动快照' : a.approximate || b.approximate ? '原始页面为近似数，差值也为估计值' : '' }];
    }));
    return { sourceKey: key, platform: source?.platform, title: source?.title, path: source?.path, sourceUrl: source?.canonicalUrl || source?.sourceUrl,
      snapshotCount, currentAt: current?.observedAt ?? null, previousAt: previous?.observedAt ?? null, metrics };
  }
  function reconcileSources(clips) {
    if (!Array.isArray(clips)) throw new Error('reconcileSources requires the full active source list');
    for (const clip of clips) keyOf(clip);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('UPDATE social_sources SET active=0');
      for (const clip of clips) upsertSource(clip);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { active: db.prepare('SELECT COUNT(*) AS n FROM social_sources WHERE active=1').get().n };
  }
  let closed = false;
  return { getSource, upsertSource, recordSnapshot, listSources, statistics, compareMetrics, reconcileSources, close() { if (!closed) { db.close(); closed = true; } } };
}
