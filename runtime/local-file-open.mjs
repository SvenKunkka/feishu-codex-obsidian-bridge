import { lstat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";

const OPEN_INTENT_RE = /(?:打开|开启|帮我找|帮我打开|找到并打开|定位|在访达中显示|显示这个|查看这个(?:文件|文档)|本地(?:文件|文档)|文件路径|文档路径|\bopen\b)/iu;
const EXPLICIT_OPEN_RE = /^\s*\/(?:open|打开)(?:\s|$)/iu;
const BRIDGE_COMMAND_RE = /^\s*\/(?:new|reset|cd|ws|resume|status|help|account|config|stop|timeout|ps|exit|doctor|reconnect|doc|invite|remove|meeting)(?:\s|$)/iu;
const MAX_PATHS_PER_MESSAGE = 8;

export async function handleLocalOpenRequest(text, options = {}) {
  const source = normalizeFeishuUncLinks(String(text ?? "")).trim();
  if (!source) return { matched: false, resolved: [], opened: [], missing: [], failed: [] };
  if (BRIDGE_COMMAND_RE.test(source)) return { matched: false, resolved: [], opened: [], missing: [], failed: [] };

  const rawCandidates = extractPathCandidates(source);
  const looksLikePathOnly = rawCandidates.length > 0 && isPathOnlyMessage(source);
  const explicit = EXPLICIT_OPEN_RE.test(source);
  const hasIntent = OPEN_INTENT_RE.test(source);
  if (!explicit && !hasIntent && !looksLikePathOnly) {
    return { matched: false, resolved: [], opened: [], missing: [], failed: [] };
  }
  if (rawCandidates.length === 0) {
    return {
      matched: explicit,
      resolved: [],
      opened: [],
      missing: explicit ? [source.replace(EXPLICIT_OPEN_RE, "").trim()] : [],
      failed: []
    };
  }

  const resolved = [];
  const missing = [];
  for (const raw of rawCandidates.slice(0, MAX_PATHS_PER_MESSAGE)) {
    const path = await longestExistingPath(raw);
    if (path) resolved.push(path);
    else missing.push(cleanCandidate(raw));
  }

  const unique = [...new Set(resolved)];
  if (options.dryRun) {
    return { matched: true, resolved: unique, opened: [], missing: [...new Set(missing.filter(Boolean))], failed: [] };
  }
  const opened = [];
  const failed = [];
  const openPath = options.openPath ?? openWithMacOS;
  for (const path of unique) {
    try {
      await openPath(path);
      opened.push(path);
    } catch (error) {
      failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { matched: true, resolved: unique, opened, missing: [...new Set(missing.filter(Boolean))], failed };
}

function normalizeFeishuUncLinks(value) {
  return value.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\n]+)\)/giu, (full, label, url, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 2), offset);
    if (prefix !== "\\\\") return full;
    try {
      return new URL(url).hostname === label ? label : full;
    } catch {
      return full;
    }
  });
}

export function extractPathCandidates(text) {
  const source = String(text ?? "");
  const found = [];
  const add = (value) => {
    const candidate = cleanCandidate(value);
    if (!isPathLike(candidate) || found.includes(candidate)) return;
    found.push(candidate);
  };

  for (const match of source.matchAll(/\[[^\]\n]*\]\((file:\/\/\/[^)\n]+|\/[^)\n]+)\)/giu)) add(match[1]);
  for (const match of source.matchAll(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’/gu)) {
    add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
  }
  for (const match of source.matchAll(/file:\/\/\/[^\s<>"'`\]\[）)】}]+/giu)) add(match[0]);

  for (let index = 0; index < source.length - 1; index++) {
    if (source[index] !== "\\" || source[index + 1] !== "\\") continue;
    let end = index + 2;
    while (end < source.length && !/[\n\r，。；！？<>“”‘’`\]\[）)【】{}]/u.test(source[end])) end++;
    add(source.slice(index, end));
    index = Math.max(index, end - 1);
  }

  for (let index = 0; index < source.length; index++) {
    const startsHome = source[index] === "~" && source[index + 1] === "/";
    const startsAbsolute = source[index] === "/" && source[index + 1] !== "/";
    if (!startsHome && !startsAbsolute) continue;
    const previous = index > 0 ? source[index - 1] : "";
    if (previous && /[A-Za-z0-9_:/.]/u.test(previous)) continue;
    let end = index;
    while (end < source.length && !/[\n\r，。；！？<>“”‘’`\]\[）)【】{}]/u.test(source[end])) end++;
    add(source.slice(index, end));
    index = Math.max(index, end - 1);
  }
  return found;
}

async function longestExistingPath(raw) {
  let candidates;
  try {
    candidates = toLocalPaths(cleanCandidate(raw));
  } catch {
    return void 0;
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const attempts = [candidate];
    let current = candidate;
    while (true) {
      const cut = current.search(/\s+\S+\s*$/u);
      if (cut < 0) break;
      current = current.slice(0, cut).trimEnd();
      if (current) attempts.push(current);
    }
    for (const path of attempts) {
      try {
        await lstat(path);
        return path;
      } catch {
      }
    }
  }
  return void 0;
}

function cleanCandidate(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/(?:open|打开)\s+/iu, "")
    .replace(/^[<({\[（【“”'"`]+/u, "")
    .replace(/[>)}\]）】“”'"`，。；！？,:;]+$/u, "")
    .trim();
}

function isPathLike(value) {
  return value.startsWith("/") || value.startsWith("~/") || /^file:\/\/\//iu.test(value) || isUncPath(value);
}

function isPathOnlyMessage(source) {
  const stripped = source
    .replace(/^\s*\/(?:open|打开)\s*/iu, "")
    .replace(/^\s*(?:路径|文件|文档)\s*[:：]\s*/u, "")
    .trim();
  return isPathLike(cleanCandidate(stripped));
}

function toLocalPaths(value) {
  if (/^file:\/\/\//iu.test(value)) return [fileURLToPath(value)];
  if (value.startsWith("~/")) return [join(homedir(),value.slice(2))];
  if (isUncPath(value)) {
    const parts = value.replace(/^\\\\/u, "").split("\\").filter(Boolean);
    if (parts.length < 2) return [];
    const [server, share, ...rest] = parts;
    return [
      join("/Volumes", share, ...rest),
      join("/Volumes", server, share, ...rest)
    ];
  }
  return [value];
}

function isUncPath(value) {
  return /^\\\\[^\\]+\\[^\\]+/u.test(value);
}

function openWithMacOS(path) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", [path], {
      detached: false,
      shell: false,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`/usr/bin/open exited with code ${code}`));
    });
  });
}
