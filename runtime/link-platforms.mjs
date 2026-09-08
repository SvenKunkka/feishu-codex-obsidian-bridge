// URL identity is deliberately separate from browser extraction. Never infer
// that two different projects, files or articles are equivalent from a title.
export const EXTENDED_PLATFORM_LABELS = Object.freeze({ wechat: '微信公众号', github: 'GitHub', kickstarter: 'Kickstarter', indiegogo: 'Indiegogo' });

export function extendedPlatformForUrl(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'mp.weixin.qq.com') return 'wechat';
  if (host === 'github.com') return 'github';
  if (host === 'kickstarter.com') return 'kickstarter';
  if (host === 'indiegogo.com') return 'indiegogo';
  return null;
}

export function wechatArticleIdentity(value) {
  try {
    const url = new URL(String(value).replaceAll('&amp;', '&'));
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (extendedPlatformForUrl(url.href) !== 'wechat') return null;
    const short = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    if (short) return { kind: 'short', key: `short:${short}` };
    const biz = url.searchParams.get('__biz'), mid = url.searchParams.get('mid'), idx = url.searchParams.get('idx');
    if (/^\/s\/?$/.test(url.pathname) && biz && /^\d+$/.test(mid || '') && /^\d+$/.test(idx || '')) {
      return { kind: 'long', key: JSON.stringify([biz, mid, idx]) };
    }
  } catch {}
  return null;
}

export function canonicalExtendedUrl(value, platform = extendedPlatformForUrl(value)) {
  if (!Object.hasOwn(EXTENDED_PLATFORM_LABELS, platform)) return null;
  const url = new URL(String(value).replaceAll('&amp;', '&'));
  if (extendedPlatformForUrl(url.href) !== platform) throw new Error('链接平台与规范来源不一致');
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.username || url.password || url.port) throw new Error('不支持包含认证信息或自定义端口的平台链接');
  const fragment = url.hash;
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (platform === 'wechat' && wechatArticleIdentity(url.href)) {
    const keep = new Set(['__biz', 'mid', 'idx', 'sn']);
    for (const key of [...url.searchParams.keys()]) if (!keep.has(key)) url.searchParams.delete(key);
    if (/^\/s\//.test(url.pathname)) url.search = '';
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|spm|ref|ref_tag|referral|referral_code|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
  }
  if (platform === 'github') {
    const parts = url.pathname.split('/');
    // Owner/repository names are case-insensitive; refs and file paths are not.
    if (parts[1]) parts[1] = parts[1].toLowerCase();
    if (parts[2]) parts[2] = parts[2].toLowerCase();
    if (parts.length === 3) parts[2] = parts[2].replace(/\.git$/i, '');
    url.pathname = parts.join('/');
    if (parts.length === 3 && url.searchParams.get('tab') === 'readme-ov-file') url.searchParams.delete('tab');
    if (parts[3] === 'blob') url.searchParams.delete('plain');
  }
  if (platform === 'kickstarter') url.pathname = url.pathname.replace(/^(\/projects\/[^/]+\/[^/]+)\/description$/, '$1');
  if (platform === 'indiegogo') {
    // Only a trailing legacy referral suffix is an alias; child content routes
    // and localized modern /en/projects/creator/slug pages stay independent.
    url.pathname = url.pathname.replace(/^(\/projects\/[^/]+)\/x\/\d+$/, '$1');
    // Match the browser extractor's recognized SPA routes. Posts, FAQs and
    // hashbang routes identify independent content, never the campaign root.
    const route = fragment.replace(/^#!?\/?/, '');
    if (/^(?:story|description|faq|faqs|updates|posts|comments|rewards|perks)(?:\/|$)/.test(route)) url.hash = `#/${route}`;
  }
  url.searchParams.sort();
  return url.href;
}

// v0.1 notes retain their immutable source key/canonical/approval identity.
// The new platform is a derived catalog field, not a rewrite of user Markdown.
export function effectiveNotePlatform(stored, url) {
  if (stored && stored !== 'web') return stored;
  try { return extendedPlatformForUrl(url) || stored || 'web'; }
  catch { return stored || 'web'; }
}

export function normalizePlatformData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe = value => String(value).replace(/<!-- social-source:(?:start|end) -->/g, '').replace(/\u0000/g, '').replace(/[\r\n]/g, ' ');
  return Object.fromEntries(Object.entries(value).slice(0, 16).filter(([key, item]) =>
    /^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) && item && typeof item === 'object' && typeof item.raw === 'string' && item.raw.trim()
  ).map(([key, item]) => [key, { label: safe(item.label || key).slice(0, 60), raw: safe(item.raw).slice(0, 600), source: safe(item.source || 'page-visible').slice(0, 160) }]));
}
