import { readFile, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSocialNote } from './social-note.mjs';

const NOTICE = '> 审核提示：内容已变更，当前不参与回答；请核对后重新勾选“已确认”。';
function controlRange(raw) {
  const front = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw);
  let offset = front?.[0].length ?? 0, fence;
  const found = [];
  for (const line of raw.slice(offset).split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.trimEnd());
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker) fence = marker[1];
    else if (/^##[ \t]+/.test(line)) break;
    else if (/^- \[[ xX]\] 已确认[ \t]*\r?\n?$/.test(line)) found.push({ start: offset, end: offset + line.trimEnd().length });
    offset += line.length;
  }
  return found.length === 1 ? found[0] : null;
}
// This controller only changes a v2 note's review control, never its curated text.
export async function refreshReviewControl(file, wiki) {
  const raw = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!raw || !/^## 摘要与要点\s*$/m.test(raw)) return false;
  const note = parseSocialNote(raw);
  if (note?.fields.note_type !== 'social_clip' || Number(note.fields.social_version) !== 2) return false;
  const control = controlRange(raw);
  if (!control) return false;
  const status = await wiki.reviewStatus(file);
  const reason = status?.reviewReason ?? status?.reason ?? '';
  const confirmed = Boolean(status?.confirmed);
  let next = raw;
  if (note.checked && !confirmed && /content.changed|reconfirmation|required|new.note/i.test(reason)) {
    next = raw.slice(0, control.start) + '- [ ] 已确认' + (raw.includes(NOTICE) ? '' : `\n\n${NOTICE}`) + raw.slice(control.end);
  } else if (note.checked && confirmed && raw.includes(NOTICE)) next = raw.replace(`\n\n${NOTICE}`, '');
  if (next === raw) return false;
  const temp = `${file}.review-${randomUUID()}.tmp`;
  await writeFile(temp, next, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  // Compare again after asynchronous staging to avoid replacing a concurrent Obsidian save.
  if (await readFile(file, 'utf8').catch(() => null) !== raw) { await unlink(temp); return false; }
  await rename(temp, file);
  await wiki.flushChanges?.([file]);
  return true;
}

export async function attachReviewControls(wiki, { onError = () => {}, watchDirectory = watch } = {}) {
  let stopped = false, timer;
  let queue = Promise.resolve();
  const dirty = new Set();
  const flush = () => {
    clearTimeout(timer);
    const task = queue.then(async () => {
      if (stopped) return;
      const files = [...dirty]; dirty.clear();
      await wiki.flushChanges?.(files);
      for (const file of files) await refreshReviewControl(file, wiki);
    });
    queue = task.catch(onError);
    return task;
  };
  const watcher = watchDirectory(wiki.vaultDir, (_event, filename) => {
    if (!filename || basename(String(filename)) !== String(filename) || !String(filename).endsWith('.md')) return;
    dirty.add(join(wiki.vaultDir, String(filename)));
    clearTimeout(timer); timer = setTimeout(() => void flush().catch(onError), 350);
  });
  watcher.on('error', onError);
  try {
    for (const entry of await readdir(wiki.vaultDir, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.md')) dirty.add(join(wiki.vaultDir, entry.name));
    await flush();
    return { flush, async close() { stopped = true; clearTimeout(timer); watcher.close(); await queue; } };
  } catch (error) {
    stopped = true; clearTimeout(timer); watcher.close(); await queue.catch(() => {});
    throw error;
  }
}
