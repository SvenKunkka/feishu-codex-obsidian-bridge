import { createHash } from 'node:crypto';
import { normalizePlatformData } from './link-platforms.mjs';

const START = '<!-- social-source:start -->';
const END = '<!-- social-source:end -->';
const hash = value => createHash('sha256').update(value).digest('hex');
const scalar = value => JSON.stringify(String(value ?? ''));
const text = value => String(value ?? '').replace(/\u0000/g, '');

export function parseSocialNote(raw) {
  raw = text(raw);
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const fields = {};
  for (const line of (front?.[1] || '').split(/\r?\n/)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    try { fields[match[1]] = JSON.parse(match[2]); }
    catch { fields[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); }
  }
  const content = raw.slice(front?.[0].length || 0);
  const title = /^# (.+)$/m.exec(content)?.[1]?.trim() || '';
  const sections = headingSections(content);
  const firstSection = sections[0]?.start ?? content.length;
  const controls = [];
  let fence = null;
  for (const line of content.slice(0, firstSection).split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
    if (/^- \[[ xX]\] 已确认\s*$/.test(line)) controls.push(line);
  }
  const checked = controls.length === 1 && /^- \[[xX]\]/.test(controls[0]);
  const machineStart = /^<!-- social-source:start -->\s*$/m.exec(content)?.index ?? content.length;
  const find = (names, curated = false) => sections.find(section => names.includes(section.title) && (!curated || section.start < machineStart))?.body.trim() || '';
  const summary = find(['摘要与要点', '摘要'], true);
  const personal = find(['我的补充'], true);
  const rawSection = find(['原文摘录', '正文／字幕', '正文/字幕']);
  const excerpt = /<summary>[^]*?<\/summary>\s*([^]*?)^<\/details>/m.exec(rawSection)?.[1];
  const rawText = excerpt === undefined ? rawSection : excerpt.replace(/^> ?/gm, '').trim();
  const curatedText = [summary, personal && `我的补充：\n${personal}`].filter(Boolean).join('\n\n');
  const identity = { source_key: fields.source_key || '', canonical_url: fields.canonical_url || fields.source_url || '', source_urls: fields.source_urls || [], model_scope: fields.model_scope || 'social_clip', effective_from: fields.effective_from || '', valid_until: fields.valid_until || '' };
  const fingerprint = hash(JSON.stringify({ title, curatedText, identity }));
  return { title, summary, personal, curatedText, rawText, checked, fields, fingerprint };
}

function headingSections(content) {
  const headings = [];
  let fence = null;
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    const trimmed = line.trimEnd();
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      offset += line.length; continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; offset += line.length; continue; }
    if (!fence && /^## [^#]/.test(trimmed)) headings.push({ title: trimmed.slice(3).trim(), start: offset, bodyStart: offset + line.length });
    offset += line.length;
  }
  return headings.map((heading, index) => ({ ...heading, body: content.slice(heading.bodyStart, headings[index + 1]?.start ?? content.length).replace(/<!-- social-source:(?:start|end) -->/g, '') }));
}

export function renderSocialNote(input) {
  const fields = {
    note_type: 'social_clip', social_version: 2, platform: input.platform,
    source_key: input.sourceKey, source_url: input.sourceUrl, canonical_url: input.canonicalUrl,
    source_urls: [input.canonicalUrl], source_aliases: input.aliases || [input.sourceUrl, input.canonicalUrl].filter(Boolean),
    author: input.author || '', published_at: input.publishedAt || '', created: input.created || input.fetchedAt,
    fetched_at: input.fetchedAt, fetch_status: input.fetchStatus, capture_kind: input.captureKind || 'article',
    summary_kind: input.summaryKind || 'model', body_hash: hash(text(input.body)), metrics: input.metrics || {}, platform_data: normalizePlatformData(input.platformData),
    tags: input.tags || [], message_id: input.messageId || '', chat_id: input.chatId || '',
    model_scope: 'social_clip', effective_from: '', valid_until: '', reviewed_by: '', reviewed_at: '',
    supersedes: [], previous_source_urls: []
  };
  const front = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value ?? '')}`).join('\n');
  return `---\n${front}\n---\n\n# ${singleLine(input.title)}\n\n- [${input.checked ? 'x' : ' '}] 已确认\n\n## 摘要与要点\n\n${text(input.summary).trim()}\n\n## 我的补充\n\n${text(input.personal).trim()}\n\n${sourceSection(input)}\n`;
}

// Only the generated source region and observational metadata may change.
// Human sections, checkbox, review fields, tags and source identity remain byte-identical.
export function updateSourceSection(raw, input) {
  const parsed = parseSocialNote(raw);
  if (parsed.fields.source_key && parsed.fields.source_key !== input.sourceKey) throw new Error('拒绝用不同来源覆盖已有笔记');
  const updates = { fetched_at: input.fetchedAt, fetch_status: input.fetchStatus, capture_kind: input.captureKind || 'article', author: input.author || '', published_at: input.publishedAt || '', body_hash: hash(text(input.body)), metrics: input.metrics || {}, platform_data: normalizePlatformData(input.platformData), source_aliases: [...new Set([...(Array.isArray(parsed.fields.source_aliases) ? parsed.fields.source_aliases : []), ...(input.aliases || [])])] };
  let result = raw.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (all, front) => {
    for (const [key, value] of Object.entries(updates)) {
      const line = `${key}: ${JSON.stringify(value ?? '')}`;
      const regex = new RegExp(`^${key}:.*$`, 'm');
      front = regex.test(front) ? front.replace(regex, line) : `${front}\n${line}`;
    }
    return `---\n${front}\n---`;
  });
  // Only standalone generated boundaries count. Literal marker text in a
  // quoted source line, frontmatter or old metadata cannot truncate refresh.
  const startMatch = /^<!-- social-source:start -->[\t ]*\r?$/m.exec(result);
  const start = startMatch?.index ?? -1;
  const endMatch = start >= 0 ? /^<!-- social-source:end -->[\t ]*\r?$/m.exec(result.slice(start + startMatch[0].length)) : null;
  const end = endMatch ? start + startMatch[0].length + endMatch.index : -1;
  if (start >= 0 && end >= start) result = result.slice(0, start) + sourceSection(input) + result.slice(end + endMatch[0].length);
  else {
    // Legacy files retain all user text. Append a separately managed capture so a
    // first refresh never guesses which part of an old note the user edited.
    result = `${result.trimEnd()}\n\n${sourceSection(input)}\n`;
  }
  if (parseSocialNote(result).fingerprint !== parsed.fingerprint) throw new Error('刷新被阻止：检测到人工审核区可能发生变化');
  return result;
}

function sourceSection(input) {
  const metricNames = { likes: '点赞', comments: '评论', views: '播放/阅读', shares: '分享', favorites: '收藏', coins: '投币' };
  const metrics = Object.entries(metricNames).map(([key, label]) => {
    const metric = input.metrics?.[key];
    return `- ${label}：${metric == null ? '未知' : `${singleLine(metric.raw || metric.value)}${metric.approximate ? '（近似）' : ''}`}`;
  }).join('\n');
  const quote = text(input.body).replace(/<!-- social-source:(?:start|end) -->/g, '').split(/\r?\n/).map(line => `> ${line}`).join('\n');
  const pageFields = Object.values(normalizePlatformData(input.platformData));
  const pageData = pageFields.length ? `\n\n## 页面信息快照\n\n${pageFields.map(item => `- ${singleLine(item.label)}：${singleLine(item.raw)}`).join('\n')}\n\n仅为本次页面显示，不作为人工确认或自动增长统计；项目承诺不代表实际交付。` : '';
  return `${START}\n## 原文摘录\n\n<details>\n<summary>展开原文（仅作来源，默认不用于已确认知识复用）</summary>\n\n${quote}\n\n</details>\n\n## 来源\n\n- 平台：${singleLine(input.platform)}\n- 来源标题：${singleLine(input.title)}\n- 作者：${singleLine(input.author || '未提供')}\n- 发布时间：${singleLine(input.publishedAt || '未提供')}\n- 原始链接：${singleLine(input.canonicalUrl)}\n- 采集时间：${singleLine(input.fetchedAt)}\n- 获取状态：${singleLine(input.fetchStatus)}${input.captureKind ? `（${singleLine(input.captureKind)}）` : ''}\n- 更新说明：刷新只更新本区域，摘要与个人补充由你校正。${pageData}\n\n<details>\n<summary>互动数据（本次采集快照）</summary>\n\n${metrics}\n\n</details>\n${END}`;
}

function singleLine(value) { return text(value).replace(/<!-- social-source:(?:start|end) -->/g, '').replace(/[\r\n]/g, ' ').trim(); }
