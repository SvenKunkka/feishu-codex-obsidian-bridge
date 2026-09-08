/** Runs inside the current browser page. Keep every dependency inside this
 * function: Browser Use serializes it with toString(), not an imported closure.
 * It reads rendered public DOM only; it never fetches or executes page scripts.
 */
export function extractArticlePageData(platform) {
  const MAX_BODY = 100000;
  const url = String(location.href);
  const current = new URL(url);
  const metrics = Object.fromEntries(['likes', 'comments', 'views', 'shares', 'favorites', 'coins'].map(key => [key, null]));
  const clean = value => String(value || '').replace(/^🐴\s*/u, '').trim();
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || '';
  const plain = node => (node?.innerText || node?.textContent || '').trim();
  const canonicalValue = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || meta('og:url') || url;
  let canonicalUrl;
  try { canonicalUrl = new URL(canonicalValue, url).href; } catch { canonicalUrl = url; }
  const identityUrls = [...new Set([document.querySelector('link[rel="canonical"]')?.getAttribute('href'), meta('og:url')].filter(Boolean).map(value => {
    try { return new URL(value, url).href; } catch { return ''; }
  }).filter(Boolean))];
  const base = { title: clean(meta('og:title') || document.title), body: '', author: '', publishedAt: '', canonicalUrl, url,
    contentRoot: false, isLoginWall: false, metrics, error: '', status: 'failed', captureKind: 'article', platformData: {}, identityUrls };
  const fail = (error, login = false) => ({ ...base, error, isLoginWall: login, status: login ? 'login' : 'failed' });
  // A missing SPA root is not a terminal access error. Browser Use may retry
  // within its bounded loading loop; final validation still rejects empty text.
  const pending = captureWarning => ({ ...base, status: 'partial', captureWarning });
  const first = (selectors, scope = document) => {
    for (const selector of selectors) {
      const node = [...scope.querySelectorAll(selector)].find(visible);
      if (node) return node;
    }
    return null;
  };

  if (platform === 'wechat') return wechat();
  if (platform === 'github') return github();
  return fail('此提取器仅支持微信公众号文章和 GitHub 页面');

  function visible(node) {
    if (!node || node.nodeType !== 1) return false;
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') return false;
      try {
        const style = getComputedStyle(n);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
      } catch {}
    }
    return true;
  }

  function contentText(node) {
    if (!node || !visible(node)) return '';
    const block = /^(?:ARTICLE|SECTION|DIV|P|PRE|BLOCKQUOTE|H[1-6]|LI|UL|OL|TABLE|TR|DL|DT|DD)$/;
    const skip = /^(?:SCRIPT|STYLE|NOSCRIPT|NAV|FORM|BUTTON|INPUT|TEXTAREA|SELECT|SVG|CANVAS|IFRAME)$/;
    const walk = n => {
      if (n.nodeType === 3) return n.textContent || '';
      if (n.nodeType !== 1 || skip.test(n.tagName) || !visible(n)) return '';
      if (n.tagName === 'BR') return '\n';
      const value = [...n.childNodes].map(walk).join('');
      return block.test(n.tagName) ? `\n${value}\n` : value;
    };
    return walk(node).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function clipped(node) {
    if (!node || !visible(node)) return false;
    try {
      const style = getComputedStyle(node);
      return node.scrollHeight > node.clientHeight + 4 && (['hidden', 'clip'].includes(style.overflowY) || (style.webkitLineClamp && style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '0'));
    } catch { return false; }
  }

  function finish(root, fields = {}) {
    const full = fields.body ?? contentText(root);
    if (!full.trim()) return pending('未找到当前页面可读取的正文；不把导航、登录提示或仅有标题当作文章');
    return { ...base, ...fields, body: full.slice(0, MAX_BODY), contentRoot: true,
      status: fields.status === 'partial' || full.length > MAX_BODY || clipped(root) ? 'partial' : 'complete' };
  }

  function wechat() {
    if (current.hostname.toLowerCase() !== 'mp.weixin.qq.com' || !/^\/s(?:\/|$)/.test(current.pathname)) return fail('仅支持微信公众号文章页面，不采集账号列表或登录入口');
    const root = first(['#js_content']);
    const article = root?.closest('#js_article,.rich_media_area_primary,.rich_media') || document;
    const title = clean(plain(first(['#activity-name', '.rich_media_title'], article)) || base.title);
    const errorText = [...document.querySelectorAll('.weui-msg__title,.weui_msg_title,.weui-msg__desc,.weui_msg_desc,#js_error_msg,#js_err_msg,#js_no_article,#js_verify,#js_wx_verify,#js_verify_code')].filter(visible).map(plain).join('\n');
    if (/安全验证|验证码|访问过于频繁|环境异常|完成验证/.test(errorText) || /安全验证|环境异常|captcha/i.test(document.title)) return fail('微信公众号页面要求安全验证，未采集；请在 Chrome 完成验证后重试', true);
    if (/已被(?:发布者)?删除|内容已删除|内容无法查看|该内容已被|已停止访问|违反相关法律|链接已过期/.test(errorText) || /^(?:该)?内容已删除$/.test(title)) return fail('微信公众号文章已删除、失效或不可访问，未采集');
    if (!root) return /登录|扫码/.test(errorText) ? fail('微信公众号文章要求登录后访问', true) : pending('未找到微信公众号正文，可能尚未加载或访问受限');
    const payment = first(['#js_pay', '#js_paywall', '#js_pay_preview', '.paywall', '.article-paywall', '.rich_media_pay_area']);
    const actionLabels = [...article.querySelectorAll('button,a,[role="button"],#js_pay_preview,#js_paywall')].filter(visible).map(plain);
    const paywall = Boolean(payment && /付费|购买|订阅|pay|purchase/i.test(plain(payment))) || actionLabels.some(value => /付费(?:后|阅读)|购买(?:后|全文)|订阅后|解锁全文|阅读全文.*[¥￥]|pay to read|subscribe to read/i.test(value));
    const video = Boolean(first(['video', 'mpvideo', 'mp-common-videosnap', 'iframe[data-src*="v.qq.com"]', 'iframe[src*="v.qq.com"]', '.js_video_iframe'], root));
    const body = contentText(root);
    const truncated = paywall || /(?:付费后|购买后|登录后)(?:继续|查看|阅读)|展开全文|以下为付费内容|剩余内容.{0,15}付费|试读结束|仅展示.{0,10}预览/.test(body);
    return finish(root, { title, author: plain(first(['#js_name', '.rich_media_meta_nickname'], article)),
      publishedAt: plain(first(['#publish_time'], article)), status: truncated || video ? 'partial' : 'complete',
      platformData: { kind: { label: '页面类型', raw: '微信公众号文章' },
        scope: { label: '采集范围', raw: '仅文章可见文字；未识别图片或转录音视频' },
        ...(paywall ? { access: { label: '采集范围', raw: '仅可见免费预览；未读取付费正文' } } : {}),
        ...(video ? { media: { label: '视频范围', raw: '仅页面文字；未转录嵌入视频' } } : {}) } });
  }

  function github() {
    if (current.hostname.toLowerCase() !== 'github.com') return fail('仅支持 github.com 的公开仓库页面');
    const parts = current.pathname.split('/').filter(Boolean);
    if (/^(?:login|session|sessions|signup)$/.test(parts[0] || '') || /^sign in\b/i.test(clean(document.title))) return fail('GitHub 页面要求登录，未采集', true);
    if (/page not found|404\s*[-·]|access denied|rate limit|abuse detection|secondary rate limit/i.test(document.title + ' ' + base.title)) return fail('GitHub 页面不存在或访问受限，未采集');
    if (parts.length < 2 || ['settings', 'notifications', 'search', 'orgs', 'users', 'account', 'marketplace', 'explore', 'topics'].includes(parts[0])) return fail('仅支持仓库、文件、issue、PR、讨论或发布说明页面');
    const repository = `${parts[0]}/${parts[1]}`;
    const repositoryMeta = meta('octolytics-dimension-repository_nwo');
    if (repositoryMeta && repositoryMeta.toLowerCase() !== repository.toLowerCase()) return fail('GitHub 仓库身份与当前 URL 不一致，拒绝采集其他仓库');
    const header = document.querySelector('#repository-container-header');
    const visibilityLabels = header ? [...header.querySelectorAll('.Label,[data-testid="repository-visibility-label"],[itemprop="isAccessibleForFree"]')].filter(visible).map(plain) : [];
    const publicFlag = meta('octolytics-dimension-repository_public').toLowerCase();
    if (publicFlag === 'false' || visibilityLabels.some(value => /^(?:Private|Internal|私有|内部)$/i.test(value))) return fail('此 GitHub 仓库是私有或内部仓库，本采集功能仅支持公开内容');
    if (!repositoryMeta && ![...(header?.querySelectorAll('a[href]') || [])].some(link => samePath(link.getAttribute('href'), `/${repository}`))) return pending('缺少与当前 GitHub 仓库相符的身份元数据，等待页面加载');
    if (publicFlag !== 'true' && !visibilityLabels.some(value => /^(?:Public|公开)$/i.test(value))) return pending('未能确认 GitHub 仓库是公开的，等待公开性标记加载');
    if (!samePath(canonicalUrl, url)) return fail('GitHub 正文规范地址与当前页面不一致，拒绝串页内容');
    const main = document.querySelector('main#js-repo-pjax-container') || document.querySelector('main');
    if (!main) return pending('GitHub 仓库正文尚未加载');
    const kind = parts.length === 2 ? 'repository' : parts[2] === 'blob' ? 'file' : parts[2] === 'issues' && /^\d+$/.test(parts[3] || '') ? 'issue' : parts[2] === 'pull' && /^\d+$/.test(parts[3] || '') ? 'pull-request' : parts[2] === 'discussions' && /^\d+$/.test(parts[3] || '') ? 'discussion' : parts[2] === 'releases' && parts[3] === 'tag' && parts.length > 4 ? 'release' : parts[2] === 'wiki' && parts.length > 3 ? 'wiki' : '';
    if (!kind) return fail('此 GitHub 页面不是已支持的单篇正文；不采集列表、文件树或活动动态');
    if (['issue', 'pull-request', 'discussion'].includes(kind) && parts.length !== 4) return fail('仅采集 issue、PR 或讨论主页面，不把 diff、提交或列表当作主帖');
    const platformData = { repository: { label: 'GitHub 仓库', raw: repository }, kind: { label: '页面类型', raw: kind } };
    let root, ownContainer, body, title = base.title, author = '', publishedAt = '', status = 'complete';
    if (kind === 'repository' || kind === 'file') {
      root = first(['#readme article.markdown-body', '[data-testid="readme"] article.markdown-body', 'article.markdown-body[itemprop="text"]', 'article.markdown-body'], main);
      if (kind === 'file' && !root) {
        const code = first(['.react-code-file-contents', '.react-code-lines', 'table.js-file-line-container'], main);
        const cells = code ? [...code.querySelectorAll('[data-testid="code-cell"],td.blob-code')].filter(visible) : [];
        if (cells.length) { root = code; body = cells.map(contentText).join('\n'); }
      }
      author = repository.split('/')[0];
      // Repo ownership is not authorship of individual code contributions.
      platformData.scope = { label: '采集范围', raw: kind === 'repository' ? '仅当前仓库 README 正文；不包含整个代码库' : '仅当前文件可见内容；不包含其他文件或提交历史' };
      if (kind === 'repository') {
        title = repository;
        for (const [key, suffix, label] of [['stars', '/stargazers', 'Stars'], ['forks', '/forks', 'Forks']]) {
          const candidates = [...main.querySelectorAll('a[href]')].filter(node => visible(node) && samePath(node.getAttribute('href'), `/${repository}${suffix}`));
          const value = candidates.map(link => plain(first(['.Counter', '.social-count', '[id$="-count"]', '[id$="-counter-star"]'], link) || link)).find(value => /\d/.test(value));
          if (value && /\d/.test(value)) platformData[key] = { label, raw: value.slice(0, 100) };
        }
      }
    } else if (kind === 'issue') {
      ownContainer = first(['[data-testid="issue-body"]'], main);
      const permalink = ownContainer?.querySelector('[data-testid="issue-body-header-link"][href]');
      if (permalink && !samePath(permalink.getAttribute('href'), url)) return fail('GitHub issue 主帖身份与当前 URL 不一致');
      root = ownContainer && first(['[data-testid="markdown-body"]', '.markdown-body'], ownContainer);
      title = clean(plain(first(['[data-testid="issue-title"]'], main)) || title);
      author = plain(ownContainer && first(['[data-testid="issue-body-header-author"]', 'a.author'], ownContainer));
      publishedAt = dateOf(ownContainer);
      status = 'partial';
    } else if (kind === 'pull-request' || kind === 'discussion') {
      const suffix = kind === 'pull-request' ? '/partials/body' : '/body';
      ownContainer = [...main.querySelectorAll('.js-comment-container[data-url]')].find(node => samePath(node.getAttribute('data-url'), `${current.pathname}${suffix}`));
      root = ownContainer && first(['.js-comment-body.markdown-body', '.comment-body.markdown-body'], ownContainer);
      author = authorOf(ownContainer);
      publishedAt = dateOf(ownContainer);
      title = clean(plain(first(['.js-issue-title', '.gh-header-title'], main)) || title);
      status = 'partial';
    } else if (kind === 'release') {
      const candidates = [...main.querySelectorAll('[data-test-selector="body-content"].markdown-body, .release-body.markdown-body')].filter(visible);
      // A tag-detail page has one release body. Multiple candidates can be a
      // list or stale navigation result: do not guess based on ancestor order.
      root = candidates.length === 1 ? candidates[0] : null;
      if (candidates.length > 1) return fail('GitHub 当前发布说明正文不唯一，拒绝猜测其他发布条目');
      ownContainer = root?.closest('.Box,.release-entry');
      author = authorOf(ownContainer);
      publishedAt = dateOf(ownContainer);
      platformData.scope = { label: '采集范围', raw: '仅当前发布说明；未下载附件或源代码包' };
    } else if (kind === 'wiki') {
      root = first(['#wiki-body .markdown-body', '#wiki-body'], main);
      platformData.scope = { label: '采集范围', raw: '仅当前 Wiki 页面；不含侧栏和其他页面' };
    }
    if (['issue', 'pull-request', 'discussion'].includes(kind)) platformData.scope = { label: '采集范围', raw: '仅主帖正文；未采集回复、评论、评审或完整讨论' };
    if (!root) return pending('未找到当前 GitHub 页面对应的正文；不采集导航、评论或其他条目替代');
    return finish(root, { title, author, publishedAt, ...(body !== undefined ? { body } : {}), status, platformData });
  }

  function samePath(a, b) {
    try {
      const left = new URL(a, url), right = new URL(b, url);
      const path = target => target.pathname.replace(/\/$/, '').split('/').map((part, index) => target.hostname.toLowerCase() === 'github.com' && index < 3 ? part.toLowerCase() : part).join('/');
      return left.hostname.toLowerCase() === right.hostname.toLowerCase() && path(left) === path(right);
    } catch { return false; }
  }

  function dateOf(container) {
    const time = container && [...container.querySelectorAll('relative-time,time[datetime]')].find(node => visible(node) && !node.closest('.markdown-body'));
    return time?.getAttribute('datetime') || plain(time);
  }

  function authorOf(container) {
    if (!container) return '';
    for (const selector of ['.timeline-comment-header a.author', 'a.author', '[rel="author"]', 'a[data-hovercard-type="user"]']) {
      const author = [...container.querySelectorAll(selector)].find(node => visible(node) && !node.closest('.markdown-body') && plain(node));
      if (author) return plain(author);
    }
    return '';
  }
}
