// Names, product codes, URLs, IDs and measurements below are synthetic test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractPageData, normalizeMetrics, validateContent, sourceKeyFor } from '../runtime/social-link-collector.mjs';

// Use the project's declared DOM-parser dependency. These fixtures never launch
// a browser, execute page scripts, or make network requests.

function page(url, html) {
  const { document } = parseHTML(`<html><head><title>测试页面</title><link rel="canonical" href="${url}"></head><body>${html}</body></html>`);
  const old = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = document; globalThis.location = new URL(url);
  globalThis.getComputedStyle = () => ({ overflowY: 'visible', webkitLineClamp: 'none' });
  return { document, restore() { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}

const DOYIN = 'https://www.douyin.com/video/9000000000000000001';
const caption = '这是用于解析器测试的虚构科普视频，介绍示例星球的三个阶段：形成、变化与稳定。';
function douyinDetail(id, title, values = ['12.3万', '4.5万', '6.7万']) {
  return `<section data-e2e="video-detail">
    <div data-e2e="detail-video-info" data-e2e-aweme-id="${id}"><h1>${title}</h1><span data-e2e="detail-video-publish-time">发布时间：2025-01-02 08:00</span></div>
    <div data-e2e="user-info"><a href="/user/author123"><img alt="头像"></a><a href="/user/author123">测试科普作者</a></div>
    <div class="chapters-changes-every-build"><div>章节要点</div><div><p>00:01 恒星形成</p><p>00:34 恒星演化</p><p>02:38 最终结局</p><p>内容由AI生成</p></div></div>
    <div data-e2e="video-player-digg">${values[0]}</div><div data-e2e="video-player-collect">${values[1]}</div><div data-e2e="video-player-share">${values[2]}</div>
    <section data-e2e="comments"><p>全部评论 456</p><p>不应进入正文的观众评论</p></section><aside>相关推荐：不应采集的其他视频</aside>
  </section>`;
}

test('Douyin public caption and bounded chapters survive an optional HD login modal', () => {
  const fixture = page(DOYIN, douyinDetail('9000000000000000001', caption) + '<article role="dialog">登录后免费畅享高清视频，扫码登录</article>');
  try {
    const result = extractPageData('douyin');
    assert.equal(result.title, caption); assert.equal(result.author, '测试科普作者');
    assert.equal(result.publishedAt, '2025-01-02 08:00');
    assert.equal(result.isLoginWall, false); assert.equal(validateContent(result, 'douyin'), true);
    assert.equal(result.status, 'partial'); assert.equal(result.captureKind, 'description');
    assert.match(result.body, /00:01/); assert.match(result.body, /内容由AI生成/);
    assert.doesNotMatch(result.body, /观众评论|相关推荐|12\.3万|456/);
    const metrics = normalizeMetrics(result.metrics);
    assert.equal(metrics.likes.value, 123000); assert.equal(metrics.favorites.value, 45000); assert.equal(metrics.shares.value, 67000);
    assert.equal(metrics.comments, null);
  } finally { fixture.restore(); }
});

test('Douyin selects the requested aweme even when a different video appears first', () => {
  const fixture = page(DOYIN, douyinDetail('777777777', '其他视频不能冒认', ['999', '888', '777']) + douyinDetail('9000000000000000001', caption));
  try {
    const result = extractPageData('douyin');
    assert.equal(result.title, caption); assert.doesNotMatch(result.body, /其他视频不能冒认/);
    assert.equal(normalizeMetrics(result.metrics).likes.value, 123000);
  } finally { fixture.restore(); }
});

test('Douyin caption-only public content is partial without requiring chapters or reading the whole container', () => {
  const fixture = page(DOYIN, `<section data-e2e="video-detail"><div data-e2e="detail-video-info" data-e2e-aweme-id="9000000000000000001"><h1>${caption}</h1></div><aside>相关推荐和评论不能加入正文</aside></section><article>登录后免费畅享高清视频，扫码登录</article>`);
  try {
    const result = extractPageData('douyin');
    assert.equal(result.body, caption); assert.equal(result.status, 'partial');
    assert.equal(validateContent(result, 'douyin'), true);
  } finally { fixture.restore(); }
});

test('Douyin wrong aweme and real login-only page still fail closed', () => {
  const wrong = page(DOYIN, douyinDetail('777777777', '其他视频不能冒认'));
  try { assert.throws(() => validateContent(extractPageData('douyin'), 'douyin'), /aweme ID/); } finally { wrong.restore(); }
  const login = page(DOYIN, '<article role="dialog">请先登录，扫码登录后继续</article>');
  try { assert.throws(() => validateContent(extractPageData('douyin'), 'douyin'), /登录/); } finally { login.restore(); }
});

const WEIBO = 'https://weibo.com/9000000001/9000000000000001';
const headline = '示例品牌 × SAMPLEPLAYER 虚构外设系列发布';
function weiboPost(timeUrl, body, numbers = ['41', '3', '17', '1600']) {
  return `<article class="woo-panel-main _wrap_newhash_2">
    <header><a usercard="9000000001" href="/u/9000000001">合成外设品牌</a><a class="_time_randomhash_3" href="${timeUrl}">25-1-3 08:00</a></header>
    <div class="wbpro-feed-ogText"><div class="_wbtext_modernhash_1">${body}</div></div>
    <div class="_plusInfo_current_2">${numbers[3]}次观看</div>
    <footer><button title="赞"><span class="woo-like-count">${numbers[0]}</span></button>
      <div><div><i title="评论"></i></div><span class="_num_random_1">${numbers[1]}</span></div>
      <div><div><i title="转发"></i></div><span class="_num_random_1">${numbers[2]}</span></div>
    </footer>
  </article>`;
}

test('Weibo modern article binds numeric URL to base62 permalink and extracts its own fields', () => {
  assert.equal(sourceKeyFor(WEIBO), sourceKeyFor('https://weibo.com/9000000001/1s00000001'));
  const fixture = page(WEIBO, weiboPost('https://weibo.com/9000000001/1s00000001', `${headline}<br>这篇正文介绍联名外设产品及设计主题。`));
  fixture.document.title = '🐴 微博正文 - 微博';
  try {
    const result = extractPageData('weibo');
    assert.equal(result.title, headline); assert.doesNotMatch(result.title, /🐴|微博正文/);
    assert.equal(result.author, '合成外设品牌'); assert.equal(result.publishedAt, '25-1-3 08:00');
    assert.match(result.body, /联名外设产品/); assert.doesNotMatch(result.body, /合成外设品牌|1600次观看/);
    assert.equal(validateContent(result, 'weibo'), true); assert.equal(result.status, 'complete');
    const values = normalizeMetrics(result.metrics);
    assert.equal(values.likes.value, 41); assert.equal(values.comments.value, 3); assert.equal(values.shares.value, 17); assert.equal(values.views.value, 1600);
  } finally { fixture.restore(); }
});

test('Weibo metrics and content ignore unrelated article and mark untranscribed video partial', () => {
  const fixture = page(WEIBO, weiboPost('https://weibo.com/111/1111111111111111', '错误文章', ['99999', '88888', '77777', '999999']) + weiboPost('https://weibo.com/9000000001/1s00000001', `${headline}<video src="https://example.org/not-requested.mp4"></video>`));
  try {
    const result = extractPageData('weibo');
    assert.doesNotMatch(result.body, /错误文章/); assert.equal(normalizeMetrics(result.metrics).likes.value, 41);
    assert.equal(result.status, 'partial'); assert.equal(result.captureKind, 'description');
  } finally { fixture.restore(); }
});

test('Weibo cannot save another article just because the page URL is the requested status', () => {
  const fixture = page(WEIBO, weiboPost('https://weibo.com/111/1111111111111111', '这是别人的完整正文，不得归入用户给定的微博链接。'));
  try { assert.throws(() => validateContent(extractPageData('weibo'), 'weibo'), /状态 ID/); } finally { fixture.restore(); }
});

test('Weibo does not reinterpret an unrelated plus-info number as views', () => {
  const fixture = page(WEIBO, weiboPost('https://weibo.com/9000000001/1s00000001', headline).replace('1600次观看', '粉丝 999999'));
  try { assert.equal(normalizeMetrics(extractPageData('weibo').metrics).views, null); } finally { fixture.restore(); }
});
