// All article text, accounts, IDs and URLs below are synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractArticlePageData } from '../runtime/article-page-extractors.mjs';
import { validateContent } from '../runtime/social-link-collector.mjs';

function capture(platform, url, html, head = '', styles = {}) {
  const { document } = parseHTML(`<html><head><title>Article test</title>${head}</head><body>${html}</body></html>`);
  for (const element of document.querySelectorAll('[data-mock-clipped]')) {
    Object.defineProperties(element, { scrollHeight: { value: 200 }, clientHeight: { value: 50 } });
  }
  const style = element => ({ display: element.style.display || 'block', visibility: element.style.visibility || 'visible', overflowY: 'visible', webkitLineClamp: 'none', ...styles });
  // Evaluate a fresh function without any module closure, as Browser Use does.
  return new Function('document', 'location', 'getComputedStyle', `return (${extractArticlePageData.toString()})(${JSON.stringify(platform)});`)(document, new URL(url), style);
}

const WECHAT = 'https://mp.weixin.qq.com/s/SyntheticArticleAbc';
const LONG_WECHAT = 'https://mp.weixin.qq.com/s?__biz=ExampleAccount&mid=123456789&idx=1&sn=example-signature';
const GH = 'https://github.com/example-owner/example-project';
function githubHead(url = GH, visibility = 'true', repository = 'example-owner/example-project') {
  return `<meta name="octolytics-dimension-repository_nwo" content="${repository}"><meta name="octolytics-dimension-repository_public" content="${visibility}"><meta property="og:url" content="${url}"><meta property="og:title" content="Example project article">`;
}
function wechatArticle(body = '<p>这是用于测试的公开文章正文。</p>') {
  return `<section id="js_article"><h1 id="activity-name">合成公众号文章</h1><span id="js_name">合成公众号</span><span id="publish_time">2025年1月2日 09:00</span><div id="js_content">${body}</div><aside id="js_cmt_area">不应采集的读者评论</aside><footer>阅读 999999 点赞 999999</footer></section>`;
}

test('WeChat extracts only article text and current article metadata; the function is closure-free', () => {
  const result = capture('wechat', WECHAT, `<nav>公共导航</nav>${wechatArticle('<h2>标题一</h2><p>正文段落一。</p><p>正文段落二。</p><script>doNotExecute()</script><span style="display:none">隐藏污染</span>')}`);
  assert.equal(result.title, '合成公众号文章'); assert.equal(result.author, '合成公众号');
  assert.equal(result.publishedAt, '2025年1月2日 09:00'); assert.equal(result.status, 'complete');
  assert.match(result.body, /正文段落一。\n\n正文段落二。/);
  assert.doesNotMatch(result.body, /公共导航|读者评论|999999|doNotExecute|隐藏污染/);
  assert.ok(Object.values(result.metrics).every(value => value === null));
});

test('WeChat identity proof comes exclusively from canonical/OG metadata, not article hyperlinks', () => {
  const result = capture('wechat', WECHAT, wechatArticle(`<p>正文。</p><a href="https://mp.weixin.qq.com/s/UnrelatedArticle">引用另一篇文章</a>`), `<link rel="canonical" href="${LONG_WECHAT.replaceAll('&', '&amp;')}"><meta property="og:url" content="${WECHAT}">`);
  assert.equal(result.canonicalUrl, LONG_WECHAT);
  assert.deepEqual(result.identityUrls, [LONG_WECHAT, WECHAT]);
  assert.equal(result.contentRoot, true);
  const noProof = capture('wechat', WECHAT, wechatArticle(`<a href="${LONG_WECHAT.replaceAll('&', '&amp;')}">正文链接不是身份凭证</a>`));
  assert.deepEqual(noProof.identityUrls, []);
});

test('WeChat refuses verification, deleted pages, non-article URLs and hidden not-yet-loaded content', () => {
  const cases = [
    [WECHAT, '<div class="weui-msg__title">环境异常，请完成安全验证</div>', /验证/],
    [WECHAT, '<div class="weui_msg_title">该内容已被发布者删除</div>', /删除/],
    ['https://mp.weixin.qq.com/mp/profile_ext', wechatArticle(), /仅支持/]
  ];
  for (const [url, html, message] of cases) {
    const result = capture('wechat', url, html);
    assert.ok(['failed', 'login'].includes(result.status)); assert.match(result.error, message);
    assert.equal(result.body, ''); assert.equal(result.contentRoot, false);
  }
});

test('WeChat saves only the visible free preview as partial and discloses untranscribed embedded video', () => {
  const preview = capture('wechat', WECHAT, wechatArticle('<p>付费文章的免费预览。</p><button>付费阅读全文</button>'));
  assert.equal(preview.status, 'partial'); assert.match(preview.platformData.access.raw, /免费预览/);
  assert.doesNotMatch(preview.body, /付费阅读全文/);
  const video = capture('wechat', WECHAT, wechatArticle('<p>本段介绍嵌入视频。</p><video></video>'));
  assert.equal(video.status, 'partial'); assert.match(video.platformData.media.raw, /未转录/);
  const complaint = capture('wechat', WECHAT, wechatArticle() + '<div class="weui-msg__title" style="display:none">确认提交投诉，安全验证</div>');
  assert.equal(complaint.status, 'complete');
});

test('GitHub repository captures its README, not file tree or discussions; stars and forks are separate platform fields', () => {
  const result = capture('github', GH, `<div id="repository-container-header"><span class="Label">Public</span></div><main id="js-repo-pjax-container"><nav>文件树 src assets</nav><a href="/other/repository/stargazers">999999</a><a href="/example-owner/example-project/stargazers"><span class="Counter">1.2k</span> stars</a><a href="/example-owner/example-project/forks"><span class="Counter">83</span> forks</a><article class="markdown-body" itemprop="text"><h1>示例项目</h1><p>README 范围的说明文档。</p><pre>example --help</pre></article><aside><div class="markdown-body">另一个讨论不能混入</div></aside></main>`, githubHead());
  assert.equal(result.title, 'example-owner/example-project'); assert.equal(result.author, 'example-owner');
  assert.match(result.body, /README 范围/); assert.doesNotMatch(result.body, /文件树|999999|另一个讨论/);
  assert.equal(result.platformData.stars.raw, '1.2k'); assert.equal(result.platformData.forks.raw, '83');
  assert.ok(Object.values(result.metrics).every(value => value === null));
});

test('GitHub rendered Markdown and code files capture only the selected file', () => {
  const file = `${GH}/blob/main/README.md`;
  const markdown = capture('github', file, '<main><aside>文件树</aside><article class="markdown-body"><p>当前文件的文档说明。</p></article></main>', githubHead(file));
  assert.equal(markdown.status, 'complete'); assert.equal(markdown.body, '当前文件的文档说明。');
  const codeUrl = `${GH}/blob/main/example.js`;
  const code = capture('github', codeUrl, '<main><div class="react-code-file-contents"><div class="line-number">1</div><div data-testid="code-cell">const example = 1;</div><div class="line-number">2</div><div data-testid="code-cell">export { example };</div></div><aside>其他文件</aside></main>', githubHead(codeUrl));
  assert.equal(code.body, 'const example = 1;\nexport { example };'); assert.equal(code.status, 'complete');
  assert.doesNotMatch(code.body, /其他文件/);
});

test('GitHub modern issue captures only its own primary body and metadata, excluding comments', () => {
  const url = `${GH}/issues/42`;
  const result = capture('github', url, `<main><h1 data-testid="issue-title">合成问题</h1><section data-testid="issue-body"><a data-testid="issue-body-header-author">example-author</a><a data-testid="issue-body-header-link" href="${url}#issue-100"><relative-time datetime="2025-01-03T00:00:00Z"></relative-time></a><div data-testid="markdown-body" class="markdown-body">主帖中的问题描述。</div></section><section data-testid="issue-viewer-comments-container"><div class="markdown-body">其他评论不能混入</div></section></main>`, githubHead(url));
  assert.equal(result.title, '合成问题'); assert.equal(result.author, 'example-author'); assert.equal(result.publishedAt, '2025-01-03T00:00:00Z');
  assert.equal(result.body, '主帖中的问题描述。'); assert.equal(result.status, 'partial');
  assert.match(result.platformData.scope.raw, /仅主帖/);
  const visibleDate = capture('github', url, `<main><section data-testid="issue-body"><a data-testid="issue-body-header-link" href="${url}"><relative-time>on Jan 3, 2025</relative-time></a><div class="markdown-body">合成主帖。</div></section></main>`, githubHead(url));
  assert.equal(visibleDate.publishedAt, 'on Jan 3, 2025');
});

test('GitHub PR and discussion primary bodies are bound by current source URLs, never by first comment position', () => {
  for (const [type, suffix] of [['pull', '/partials/body'], ['discussions', '/body']]) {
    const url = `${GH}/${type}/42`;
    const result = capture('github', url, `<main><h1 class="gh-header-title">合成主帖 #42</h1><div class="js-comment-container" data-url="/example-owner/example-project/${type}/99${suffix}"><div class="markdown-body js-comment-body">另一条主帖</div></div><div class="js-comment-container" data-url="/example-owner/example-project/${type}/42${suffix}"><div class="timeline-comment-header"><a class="author">primary-author</a><relative-time datetime="2025-01-04T00:00:00Z"></relative-time></div><div class="markdown-body js-comment-body">当前主帖公开描述。</div></div><div class="markdown-body js-comment-body">用户回复不能冒充主帖</div></main>`, githubHead(url));
    assert.equal(result.body, '当前主帖公开描述。'); assert.equal(result.author, 'primary-author');
    assert.equal(result.publishedAt, '2025-01-04T00:00:00Z'); assert.equal(result.status, 'partial');
  }
});

test('GitHub release and Wiki text exclude downloaded assets, navigation and unrelated pages', () => {
  const releaseUrl = `${GH}/releases/tag/v1.2.3`;
  const release = capture('github', releaseUrl, '<main><div class="Box"><a class="author">release-author</a><relative-time datetime="2025-01-05T00:00:00Z"></relative-time><div data-test-selector="body-content" class="markdown-body">本版本改进可维护性。</div><aside>Source code.zip Assets 2</aside></div></main>', githubHead(releaseUrl));
  assert.equal(release.body, '本版本改进可维护性。'); assert.equal(release.status, 'complete');
  assert.match(release.platformData.scope.raw, /未下载附件/);
  const wikiUrl = `${GH}/wiki/Example-page`;
  const wiki = capture('github', wikiUrl, '<main><aside>其他Wiki条目</aside><div id="wiki-body"><div class="markdown-body">当前Wiki页面正文。</div></div></main>', githubHead(wikiUrl));
  assert.equal(wiki.body, '当前Wiki页面正文。');
});

test('GitHub private/internal/unknown visibility and identity mismatches fail closed', () => {
  const content = '<main><article class="markdown-body">不该采集的内容</article></main>';
  const cases = [
    [GH, content, githubHead(GH, 'false'), /私有/],
    [GH, '<div id="repository-container-header"><span class="Label">Private</span></div>' + content, githubHead(), /私有/],
    [GH, content, githubHead(GH, 'true', 'other-owner/other-project'), /仓库身份/],
    [GH, content, githubHead(`${GH}/blob/main/other.md`), /规范地址/],
    [`${GH}/issues/42`, '<main><section data-testid="issue-body"><a data-testid="issue-body-header-link" href="/example-owner/example-project/issues/99">Wrong</a><div class="markdown-body">错误主帖</div></section></main>', githubHead(`${GH}/issues/42`), /主帖身份/],
    [`${GH}/issues`, content, githubHead(`${GH}/issues`), /列表/],
    [`${GH}/pull/42/files`, content, githubHead(`${GH}/pull/42/files`), /diff/]
  ];
  for (const [url, html, head, error] of cases) {
    const result = capture('github', url, html, head);
    assert.equal(result.status, 'failed'); assert.equal(result.body, ''); assert.match(result.error, error);
  }
});

test('GitHub login and 404 pages are rejected while a public page with a sign-in navigation link is allowed', () => {
  const login = capture('github', 'https://github.com/login', '<form>Sign in to continue</form>');
  assert.equal(login.isLoginWall, true);
  const notFound = capture('github', GH, '<main>Not found</main>', '<meta property="og:title" content="Page not found">');
  assert.equal(notFound.status, 'failed'); assert.equal(notFound.body, '');
  const publicPage = capture('github', GH, '<nav><a href="/login">Sign in</a></nav><main><article class="markdown-body">公开的 README 正文。</article></main>', githubHead());
  assert.equal(publicPage.status, 'complete'); assert.equal(publicPage.isLoginWall, false);
});

test('article boundaries mark clipped or oversized content partial and never execute embedded script instructions', () => {
  const long = capture('wechat', WECHAT, wechatArticle(`<p>${'测试正文。'.repeat(21000)}</p><script>throw new Error("never execute")</script>`));
  assert.equal(long.status, 'partial'); assert.equal(long.body.length, 100000);
  assert.doesNotMatch(long.body, /never execute/);
  const clipped = capture('wechat', WECHAT, wechatArticle().replace('id="js_content"', 'id="js_content" data-mock-clipped'), '', { overflowY: 'hidden' });
  assert.equal(clipped.status, 'partial');
  const unknown = capture('web', 'https://example.com', '<article>其他平台</article>');
  assert.equal(unknown.status, 'failed');
});

test('not-yet-hydrated article roots return retryable empty partial data, but final content validation still rejects them', () => {
  const cases = [
    ['wechat', WECHAT, '<h1 id="activity-name">仅标题</h1>', ''],
    ['wechat', WECHAT, '<div id="js_content" style="visibility:hidden">未显示的文章</div>', ''],
    ['wechat', WECHAT, wechatArticle('<p></p>'), ''],
    ['github', GH, '<main><article class="markdown-body">尚未确认公开性</article></main>', githubHead(GH, '')],
    ['github', GH, '<main></main>', githubHead()],
    ['github', `${GH}/blob/main/example.js`, '<main><div class="react-code-file-contents" aria-hidden="true"><div data-testid="code-cell">Hidden SSR text</div></div></main>', githubHead(`${GH}/blob/main/example.js`)]
  ];
  for (const [platform, url, html, head] of cases) {
    const result = capture(platform, url, html, head);
    assert.equal(result.status, 'partial'); assert.equal(result.contentRoot, false); assert.equal(result.error, '');
    assert.equal(result.body, ''); assert.ok(result.captureWarning);
    assert.throws(() => validateContent(result, platform), /正文不足/);
  }
});
