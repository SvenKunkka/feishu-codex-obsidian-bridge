// Synthetic fixtures, including the observed public Indiegogo DOM structure.
// No browser, account, network request or funding operation is performed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { extractCrowdfundingPageData } from '../runtime/crowdfunding-page-extractors.mjs';

const KS='https://www.kickstarter.com/projects/example-maker/example-pad';
const IGG='https://www.indiegogo.com/en/projects/example-maker/example-pad';
const story='This synthetic project introduces a compact input device. The creator describes its physical controls, construction choices, and current development stage. Manufacturing estimates are promises, not independently verified delivery facts.';
function extract(platform,url,body,{head='',title='Example project',canonical=url}={}) {
  const {document}=parseHTML(`<html><head><title>${title}</title>${canonical?`<link rel="canonical" href="${canonical}">`:''}${head}</head><body>${body}</body></html>`);
  const context=vm.createContext({document,location:new URL(url),URL,getComputedStyle:node=>({display:node.getAttribute('style')?.includes('display:none')?'none':'block',visibility:'visible'})});
  // This is the production transport, not a direct module call: outer helpers
  // accidentally introduced into the extractor fail this independent realm.
  return JSON.parse(JSON.stringify(vm.runInContext(`(${extractCrowdfundingPageData.toString()})(${JSON.stringify(platform)})`,context)));
}
const json=data=>`<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const ksStory=body=>`<section class="full-description">${body}</section>`;
const iggStory=body=>`<section data-testid="project-story">${body}</section>`;

test('Kickstarter extracts only bound story and raw funding fields, never interaction counts',()=>{
  const result=extract('kickstarter',KS,`<main data-project-url="${KS}"><h1>Example pad</h1><span data-project-creator>Example Maker</span>
    ${ksStory(`<p>${story}</p><aside><p>Recommended project should not be captured</p></aside><p style="display:none">CSS-hidden template</p><div data-project-url="https://www.kickstarter.com/projects/other/other-pad">Unrelated project story</div><div data-project-slug="other-pad">Other project by slug</div>`)}
    <div id="project-stats"><span id="pledged">US$ 12,345</span><span data-funding-goal>US$ 8,000</span><span id="backers_count">97</span><span data-currency-code="USD"></span></div></main>`);
  assert.equal(result.status,'complete');assert.equal(result.author,'Example Maker');
  assert.equal(result.body,story);assert.equal(result.contentRoot,true);
  assert.equal(result.platformData.pledged.raw,'US$ 12,345');assert.equal(result.platformData.goal.raw,'US$ 8,000');
  assert.equal(result.platformData.backers.raw,'97');assert.equal(result.platformData.currency.raw,'USD');
  assert.deepEqual(Object.values(result.metrics),[null,null,null,null,null,null]);
});

test('Modern Indiegogo story excludes adjacent timeline, risks, recommendations and page navigation',()=>{
  const result=extract('indiegogo',IGG,`<nav>Discover all projects</nav><main class="gfu-project-description js-main-content">
    <div class="gfu-table-of-contents">Project story Timeline Risks</div>
    <section class="gfu-project-description-section gfu-project-description-section--emphasized"><h2 data-qa="project-description-section-title:Project story">Project story</h2><div class="gfu-richtext gfu-richtext--article" data-qa="richtext-article"><p>${story}</p></div><span data-qa="project-properties:CreatorName" class="gfu-creators-line__name">Example Maker</span><div>Tags and creator widgets excluded</div></section>
    <div class="gfu-project-description-section">Timeline should stay separate</div><div class="gfu-project-description-section">Risks should stay separate</div>
    <aside class="gfu-project-description-section">Recommended project</aside></main>`,{title:'🐴 Example Pad by Example Maker - Indiegogo'});
  assert.equal(result.status,'complete');assert.match(result.body,/compact input device/);
  assert.doesNotMatch(result.body,/Discover|Timeline|Risks|Recommended|creator widgets|Project story|Example Maker/);
  assert.equal(result.title,'Example Pad');assert.equal(result.author,'Example Maker');
  assert.equal(result.platformData.pageType.raw,'story');
});

test('Current Indiegogo emphasized sections require the story heading, not an arbitrary main container',()=>{
  const result=extract('indiegogo',IGG,'<main class="gfu-project-description js-main-content"><section class="gfu-project-description-section--emphasized"><h2>Featured projects</h2>Not the story</section></main>');
  assert.equal(result.status,'failed');assert.equal(result.body,'');
});

test('Modern Indiegogo metadata widgets do not become story when richtext article is absent',()=>{
  const result=extract('indiegogo',IGG,'<main class="gfu-project-description js-main-content"><section class="gfu-project-description-section--emphasized"><h2 data-qa="project-description-section-title:Project story">Project story</h2><div>Creator: Example Maker. Tags: design.</div></section></main>');
  assert.equal(result.status,'failed');assert.equal(result.body,'');
});

test('Indiegogo localized and legacy project routes use the same scoped extractor',()=>{
  for(const url of [IGG.replace('/en/','/zh/'),IGG.replace('/en/','/it/'),'https://www.indiegogo.com/projects/example-pad']) {
    const result=extract('indiegogo',url,iggStory(`<p>${story}</p>`));
    assert.equal(result.status,'complete');assert.equal(result.canonicalUrl,url);
  }
});

test('Subpage canonical pointing to project root does not discard the FAQ route',()=>{
  const url=IGG+'/faq';
  const result=extract('indiegogo',url,`${iggStory('Parent story must not become FAQ content')}<section data-project-faq><h2>Does this work offline?</h2><p>The synthetic device works offline.</p></section>`,{canonical:IGG});
  assert.equal(result.status,'complete');assert.equal(result.captureKind,'faq');assert.equal(result.canonicalUrl,url);
  assert.equal(result.platformData.pageType.raw,'faq');assert.doesNotMatch(result.body,/Parent story/);
});

test('Update detail is distinct from update index and retains exact ID and hash route',()=>{
  for(const url of [IGG+'/updates/4',IGG+'#/updates/4',KS+'/posts/12345']) {
    const platform=url.includes('kickstarter')?'kickstarter':'indiegogo';
    const id=url.includes('kickstarter')?'12345':'4';
    const result=extract(platform,url,`<article data-update-id="${id}"><h1>Development update</h1><time datetime="2025-01-05"></time><p>${story}</p></article>`,{canonical:url.includes('kickstarter')?KS:IGG});
    assert.equal(result.captureKind,'update');assert.equal(result.title,'Development update');assert.equal(result.publishedAt,'2025-01-05');
    assert.equal(result.canonicalUrl,url);assert.equal(result.platformData.pageType.raw,'update');
  }
  const index=extract('indiegogo',IGG+'/updates','<section data-project-updates><h2>Update 1</h2><p>Public update summary.</p></section>');
  assert.equal(index.platformData.pageType.raw,'updates');
});

test('Update ID or permalink mismatch fails rather than capturing a different article',()=>{
  const byId=extract('indiegogo',IGG+'/updates/4',`<article data-update-id="5"><p>${story}</p></article>`);
  assert.equal(byId.status,'failed');assert.match(byId.error,/编号/);
  const byLink=extract('kickstarter',KS+'/posts/123',`<article data-project-update data-update-url="${KS}/posts/124"><p>${story}</p></article>`);
  assert.equal(byLink.status,'failed');assert.match(byLink.error,/子页面/);
});

test('FAQ and update pages never fall back to project story or campaign meta description',()=>{
  for(const tail of ['/faq','/updates/4']) {
    const result=extract('indiegogo',IGG+tail,iggStory(story),{canonical:IGG,head:'<meta property="og:description" content="Parent project description">'});
    assert.equal(result.status,'failed');assert.equal(result.body,'');
  }
});

test('Wrong project canonical and wrong detail canonical fail closed',()=>{
  for(const canonical of ['https://www.indiegogo.com/en/projects/other-maker/other-pad',IGG+'/updates/5']) {
    const result=extract('indiegogo',IGG+'/updates/4',`<article data-project-update>${story}</article>`,{canonical});
    assert.equal(result.status,'failed');assert.match(result.error,/canonical/);
  }
});

test('A canonical URL in another locale does not collapse the current language route',()=>{
  const localized=IGG.replace('/en/','/zh/');
  const result=extract('indiegogo',localized,iggStory(story),{canonical:IGG});
  assert.equal(result.canonicalUrl,localized);
});

test('Verified JSON-LD article is selected over WebPage description and unrelated recommendations',()=>{
  const result=extract('kickstarter',KS,json({'@graph':[
    {'@type':'WebPage',url:KS,description:'Only metadata'},
    {'@type':'Article',url:'https://www.kickstarter.com/projects/other/other-pad',articleBody:'Other article'},
    {'@type':'Article',mainEntityOfPage:{'@id':KS},headline:'Example story',articleBody:story,author:{name:'Structured Creator'},datePublished:'2025-01-05'}
  ]}));
  assert.equal(result.body,story);assert.equal(result.status,'complete');assert.equal(result.title,'Example story');
  assert.equal(result.author,'Structured Creator');assert.equal(result.publishedAt,'2025-01-05');
  assert.equal(result.platformData.pledged,undefined);
});

test('Unbound JSON-LD and third-party or other-locale content never count as project body',()=>{
  for(const value of [undefined,'https://example.org/story',IGG.replace('/en/','/zh/'),'https://www.indiegogo.com/en/projects/other/other-pad']) {
    const result=extract('indiegogo',IGG,json({'@type':'Article',url:value,articleBody:story}));
    assert.equal(result.status,'failed');assert.equal(result.body,'');
  }
});

test('Verified FAQ JSON-LD is full source content, but missing answers remain partial',()=>{
  const faq={'@type':['WebPage','FAQPage'],url:IGG+'/faq',mainEntity:[{'@type':'Question',name:'Works offline?',acceptedAnswer:{text:'Yes, this synthetic fixture does.'}}]};
  const result=extract('indiegogo',IGG+'/faq',json(faq),{canonical:IGG});
  assert.equal(result.status,'complete');assert.equal(result.captureKind,'faq');assert.equal(result.contentRoot,true);
  assert.match(result.body,/Works offline/);assert.equal(result.platformData.limitations,undefined);
  delete faq.mainEntity[0].acceptedAnswer;
  const missing=extract('indiegogo',IGG+'/faq',json(faq));
  assert.equal(missing.status,'partial');assert.doesNotMatch(missing.body,/undefined/);
});

test('Only project description is partial; empty roots and page navigation are never complete',()=>{
  const partial=extract('kickstarter',KS,'<nav>Discover projects</nav>',{head:'<meta property="og:description" content="A synthetic project summary.">'});
  assert.equal(partial.status,'partial');assert.equal(partial.contentRoot,false);assert.equal(partial.captureKind,'description');
  assert.match(partial.platformData.limitations.raw,/完整故事尚未加载/);
  const empty=extract('kickstarter',KS,ksStory('<div></div>')+'<nav>Very long navigation '.repeat(10)+'</nav>');
  assert.equal(empty.status,'failed');assert.equal(empty.body,'');
});

test('Login, captcha and deleted pages fail even when stale project metadata remains',()=>{
  for(const [body,title,login] of [
    ['<form id="challenge-form">Checking your browser</form>','Example project',true],
    ['<main>Please log in to continue</main>','Example project',true],
    ['<main>Project has been removed</main>','Example project',false],
    ['<main>Challenge</main>','Just a moment...',true],
    ['<main>Missing</main>','404 - Kickstarter',false],
    ['<h2>正在執行安全驗證</h2><p>驗證成功正在等待</p>','🐴 請稍候...',true],
    ['<h2>正在執行安全驗證</h2>','Example project',true]
  ]) {
    const result=extract('kickstarter',KS,body,{title,head:'<meta property="og:description" content="Old project summary">'});
    assert.equal(result.status,'failed');assert.equal(result.body,'');assert.equal(result.isLoginWall,login);
  }
});

test('Optional login UI does not invalidate a fully visible public story',()=>{
  const result=extract('indiegogo',IGG,'<nav>Log in</nav>'+iggStory(story)+'<aside>Sign in to continue commenting</aside>');
  assert.equal(result.status,'complete');assert.equal(result.isLoginWall,false);assert.equal(result.body,story);
});

test('Stale structured article behind a login gate cannot evade failure',()=>{
  const result=extract('indiegogo',IGG,json({'@type':'Article',url:IGG,articleBody:story})+'<main>Please log in to continue</main>');
  assert.equal(result.status,'failed');assert.equal(result.isLoginWall,true);assert.equal(result.body,'');
  const quote=extract('indiegogo',IGG,json({'@type':'Article',url:IGG,articleBody:'This guide explains the phrase please log in to continue in its story.'}));
  assert.equal(quote.status,'complete');
});

test('Hidden, related and wrong-project story roots cannot be selected before the actual project',()=>{
  const result=extract('kickstarter',KS,`<div class="recommended-projects">${ksStory('Related projects')}</div><div data-project-url="https://www.kickstarter.com/projects/other/other-pad">${ksStory('Wrong project')}</div><div hidden>${ksStory('Hidden project')}</div><div style="display:none">${ksStory('Invisible ancestor')}</div><div style="display:none" class="full-description">Invisible project</div>${ksStory(story)}`);
  assert.equal(result.body,story);
});

test('Funding counts in recommended projects are excluded and no currency is inferred from a dollar sign',()=>{
  const result=extract('indiegogo',IGG,`<aside><div data-project-funding><span data-funding-raised="$999,999"></span><span data-backers-count="999"></span></div></aside><main data-project-url="${IGG}" data-funding-goal="$500">${iggStory(story)}<section data-project-funding><span data-funding-raised="$650"></span></section></main>`);
  assert.equal(result.platformData.pledged.raw,'$650');assert.equal(result.platformData.goal.raw,'$500');
  assert.equal(result.platformData.backers,undefined);assert.equal(result.platformData.currency,undefined);
});

test('Collapsed text, video or image-dominant story are visibly partial',()=>{
  for(const [body,reason] of [
    [`<p>${story}</p><button data-read-more>Read more</button>`,/折叠/],
    [`<p>${story}</p><iframe src="https://www.youtube.com/embed/example"></iframe>`,/视频/],
    ['<p>Diagram follows.</p><img src="diagram.png">',/图片/]
  ]) {
    const result=extract('kickstarter',KS,ksStory(body));assert.equal(result.status,'partial');assert.match(result.platformData.limitations.raw,reason);
  }
});

test('Large body truncation is explicit and scripts are never evaluated or mixed into story',()=>{
  const result=extract('kickstarter',KS,ksStory('<script>throw new Error("must never execute")</script><p>'+('A'.repeat(100100))+'</p>'));
  assert.equal(result.status,'partial');assert.equal(result.body.length,100000);assert.match(result.platformData.limitations.raw,/100000/);
  assert.doesNotMatch(result.body,/throw new Error/);
});

test('Platform and unsupported routes are rejected instead of generic full-page collection',()=>{
  for(const [platform,url] of [['web',KS],['kickstarter','https://www.kickstarter.com/discover'],['indiegogo',IGG+'/checkout'],['indiegogo','https://indiegogo.com.example.org/projects/maker/pad']]) {
    const result=extract(platform,url,ksStory(story)+iggStory(story));assert.equal(result.status,'failed');
  }
});
