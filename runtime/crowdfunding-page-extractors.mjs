/** Browser-side extractor. Keep every dependency inside this function: callers
 * serialize it with toString() and execute it in the currently selected tab. */
export function extractCrowdfundingPageData(platform) {
  const url=String(location.href);
  const metrics={likes:null,comments:null,views:null,shares:null,favorites:null,coins:null};
  const clean=value=>String(value ?? '').replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const query=(selector,root=document)=>{try{return root.querySelector(selector);}catch{return null;}};
  const queryAll=(selector,root=document)=>{try{return [...root.querySelectorAll(selector)];}catch{return [];}};
  const meta=name=>query('meta[property="'+name+'"],meta[name="'+name+'"]')?.getAttribute('content') || '';
  const absolute=value=>{try{return new URL(value,url).href;}catch{return '';}};
  const route=value=>{
    try {
      const u=new URL(value,url);const host=u.hostname.toLowerCase();
      if(platform==='kickstarter' ? !/(^|\.)kickstarter\.com$/.test(host) : !/(^|\.)indiegogo\.com$/.test(host))return null;
      const parts=u.pathname.split('/').filter(Boolean);
      const start=platform==='indiegogo' && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] || '') ? 1 : 0;
      if(parts[start]!=='projects' || !parts[start+1])return null;
      const special=new Set(['story','description','faq','faqs','updates','posts','comments','rewards','perks','community','x']);
      const length=platform==='kickstarter' || (parts[start+2] && !special.has(parts[start+2])) ? start+3 : start+2;
      if(platform==='kickstarter' && !parts[start+2])return null;
      let tail=parts.slice(length);
      if(tail[0]==='x')tail=[]; // legacy referral suffix, not project content
      const hash=u.hash.replace(/^#!?\/?/,'');
      if(!tail.length && /^(?:story|description|faq|faqs|updates|posts|comments|rewards|perks)(?:\/|$)/.test(hash))tail=hash.split('/').filter(Boolean);
      const first=tail[0] || '';
      const pageType=/^(?:faq|faqs)$/.test(first)?'faq':/^(?:updates|posts)$/.test(first)?(tail[1] && tail[1]!=='all'?'update':'updates'):first==='comments'?'comments':/^(?:rewards|perks)$/.test(first)?'rewards':first==='community'?'community':'story';
      const project=parts.slice(start,length).join('/');
      const page=[project,...tail].join('/');
      return {project,page,pageType,slug:parts[length-1],locale:parts.slice(0,start).join('/'),unknown:!!first && !special.has(first)};
    }catch{return null;}
  };
  const current=route(url);
  const cleanTitle=value=>clean(value).replace(/^🐴\s*/u,'');
  const failed=(error,isLoginWall=false)=>({title:cleanTitle(document.title),body:'',author:'',publishedAt:'',canonicalUrl:url,url,contentRoot:false,isLoginWall,metrics,error,status:'failed',captureKind:'description',platformData:{}});
  if(!['kickstarter','indiegogo'].includes(platform) || !current || current.unknown)return failed('不是受支持的众筹项目内容页面');
  const headTitle=cleanTitle(document.title);
  if(/just a moment|attention required|access denied|captcha|verify (?:you are|your)|security (?:check|verification)|安全验[证證]|安全驗證|人机验证|人機驗證|[请請]稍候|^(?:log ?in|sign ?in)(?:\s|$)/i.test(headTitle))return failed('众筹页面需要登录或安全验证',true);
  if(/(?:^|[|—-]\s*)(?:404|page not found|project not found)|project (?:has been|was) (?:removed|deleted)|项目(?:不存在|已删除)/i.test(headTitle))return failed('众筹项目页面不存在或已删除');
  const advertised=absolute(query('link[rel="canonical"]')?.getAttribute('href') || meta('og:url'));
  if(advertised) {
    const other=route(advertised);
    if(!other || other.project!==current.project || (other.page!==current.page && other.page!==other.project))return failed('当前页与 canonical 所指项目或子页面不一致');
  }
  // Many platforms put the campaign root in subpage canonical metadata. Retain
  // the actual FAQ/update route so its content cannot overwrite the main story.
  const canonicalUrl=advertised && route(advertised)?.page===current.page && route(advertised)?.locale===current.locale ? advertised : url;
  const exclusions='nav,footer,aside,[role="navigation"],.recommendations,.related-projects,.recommended-projects,[data-related-project],[data-testid*="recommend"],[data-test-id*="recommend"],[data-testid*="related"],[data-test-id*="related"]';
  function belongs(node) {
    if(!node || node.closest?.(exclusions))return false;
    for(let parent=node;parent && parent!==document;parent=parent.parentElement) {
      const binding=parent.getAttribute?.('data-project-url') || parent.getAttribute?.('data-campaign-url');
      if(binding && route(binding)?.project!==current.project)return false;
      const slug=parent.getAttribute?.('data-project-slug') || parent.getAttribute?.('data-campaign-slug');
      if(slug && slug!==current.slug && slug!==current.project.replace(/^projects\//,''))return false;
      if(parent.hasAttribute?.('hidden') || parent.getAttribute?.('aria-hidden')==='true')return false;
      try{if(typeof getComputedStyle==='function' && (getComputedStyle(parent).display==='none' || getComputedStyle(parent).visibility==='hidden'))return false;}catch{}
    }
    return true;
  }
  const first=selectors=>{for(const selector of selectors)for(const node of queryAll(selector))if(belongs(node))return node;return null;};
  const storySelectors=platform==='kickstarter'
    ? ['[data-test-id="project-description"]','.full-description','[data-testid="project-story"]','[data-project-story]','#project-story']
    : ['[data-testid="project-story"]','[data-test-id="project-story"]','[data-project-story]','.project-story .rich-text','.project-story','.campaign-story','.basicsSection-story','#project-story'];
  const pageSelectors={
    story:storySelectors,
    faq:['[data-testid="project-faq"]','[data-test-id="project-faq"]','[data-project-faq]','.project-faq','.project-faqs','.NS_projects__faq','#project-faq'],
    updates:['[data-testid="project-updates"]','[data-test-id="project-updates"]','[data-project-updates]','.project-updates','.NS_projects__updates','#project-updates'],
    update:['[data-testid="project-update"]','[data-test-id="project-update"]','[data-project-update]','.project-update .body','.project-update-body','.NS_projects__posts .body','.update-body','article[data-update-id]'],
    comments:['[data-testid="project-comments"]','[data-project-comments]','.project-comments'],
    rewards:['[data-testid="project-rewards"]','[data-project-rewards]','.project-rewards'],
    community:['[data-testid="project-community"]','[data-project-community]','.project-community']
  };
  let root=first(pageSelectors[current.pageType] || []);
  let modernStorySection=null;
  // Current Indiegogo serves its story as the first emphasized section inside
  // this description main. Timeline, risk and recommendations are siblings;
  // never fall back to their containing main or the whole project page.
  if(!root && platform==='indiegogo' && current.pageType==='story') {
    const candidate=first(['main.gfu-project-description.js-main-content > section.gfu-project-description-section--emphasized']);
    if(candidate && (query('[data-qa="project-description-section-title:Project story"]',candidate) || /^(?:project story|story|项目故事|專案故事|项目介绍|storia del progetto)$/i.test(clean(query('h2',candidate)?.textContent)))) {
      modernStorySection=candidate;
      root=query('.gfu-richtext.gfu-richtext--article[data-qa="richtext-article"]',candidate);
      // If the known story wrapper exists but its article is still loading,
      // keep the root empty; creator/tags/widgets are not an article fallback.
    }
  }
  if(root && current.pageType==='update') {
    const bound=root.getAttribute('data-update-url') || root.querySelector?.('a[rel="bookmark"]')?.getAttribute('href');
    if(bound && route(bound)?.page!==current.page)return failed('更新文章不属于当前项目子页面');
    const id=root.getAttribute('data-update-id');
    if(id && !current.page.endsWith('/'+id))return failed('更新文章编号与当前页面不一致');
  }
  function textOf(node) {
    if(!node)return '';
    const blocks=new Set(['P','DIV','SECTION','ARTICLE','UL','OL','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','TR']);
    function visit(node) {
      if(node.nodeType===3)return node.textContent || '';
      if(node.nodeType!==1)return '';
      if(node.matches?.('script,style,noscript,template,button,form,[hidden],[aria-hidden="true"],'+exclusions))return '';
      const binding=node.getAttribute('data-project-url') || node.getAttribute('data-campaign-url');
      if(binding && route(binding)?.project!==current.project)return '';
      const slug=node.getAttribute('data-project-slug') || node.getAttribute('data-campaign-slug');
      if(slug && slug!==current.slug && slug!==current.project.replace(/^projects\//,''))return '';
      try{if(typeof getComputedStyle==='function' && (getComputedStyle(node).display==='none' || getComputedStyle(node).visibility==='hidden'))return '';}catch{}
      if(node.tagName==='BR')return '\n';
      const value=[...node.childNodes].map(visit).join('');
      return blocks.has(node.tagName)?'\n'+value+'\n':value;
    }
    return clean(visit(node));
  }
  const jsonObjects=[];
  for(const script of queryAll('script[type="application/ld+json"]')) {
    try {
      const pending=[JSON.parse(script.textContent)];let count=0;
      while(pending.length && count++<1500) {
        const item=pending.shift();if(!item || typeof item!=='object')continue;
        if(Array.isArray(item)){pending.push(...item);continue;}
        jsonObjects.push(item);if(item['@graph'])pending.push(item['@graph']);if(item.mainEntity)pending.push(item.mainEntity);
      }
    }catch{}
  }
  const jsonPages=jsonObjects.filter(item=>{
    const type=[].concat(item['@type'] || []);
    if(!type.some(x=>/^(?:Article|BlogPosting|NewsArticle|CreativeWork|Project|Product|WebPage|FAQPage)$/.test(x)))return false;
    const binding=item.url || (typeof item.mainEntityOfPage==='string'?item.mainEntityOfPage:item.mainEntityOfPage?.['@id']) || item['@id'];
    return typeof binding==='string' && route(binding)?.page===current.page && route(binding)?.locale===current.locale;
  });
  const jsonPage=jsonPages.find(item=>typeof item.articleBody==='string' && clean(item.articleBody)) || jsonPages.find(item=>[].concat(item['@type'] || []).includes('FAQPage') && item.mainEntity) || jsonPages.find(item=>item.description) || jsonPages[0];
  const boundName=value=>typeof value==='string'?value:Array.isArray(value)?value.map(boundName).filter(Boolean).join(', '):value?.name || '';
  const projectRoot=first(['[data-testid="project-detail"]','[data-test-id="project-detail"]','[data-project-url]','[data-campaign-url]','#project-profile','.NS_projects__show','.campaign-page']);
  let title=cleanTitle((current.pageType==='update'?root?.querySelector('h1,h2'):null)?.textContent || meta('og:title') || jsonPage?.headline || jsonPage?.name || projectRoot?.querySelector('h1')?.textContent || headTitle);
  title=title.replace(/\s+(?:by .+\s+)?[—|–-]\s*(?:Kickstarter|Indiegogo)\s*$/i,'').trim();
  const rootBody=textOf(root);
  let body=rootBody;
  const articleBody=typeof jsonPage?.articleBody==='string'?clean(jsonPage.articleBody):'';
  let structuredFullContent=!!articleBody;
  let complete=Boolean(root && body);
  if(!body && articleBody){body=articleBody;complete=true;}
  if(!body && current.pageType==='faq' && [].concat(jsonPage?.['@type'] || []).includes('FAQPage')) {
    const items=[].concat(jsonPage.mainEntity || []).filter(item=>item?.['@type']==='Question');
    body=items.map(item=>[clean(item.name),clean(item.acceptedAnswer?.text)].filter(Boolean).join('\n')).join('\n\n');complete=!!body && items.every(item=>item.acceptedAnswer?.text);structuredFullContent=!!body;
  }
  const visibleArticle=!!rootBody;
  const visible=visibleArticle?'':textOf(document.body).slice(0,1800);
  // Stale JSON-LD/meta may survive behind a gate, but a fully visible article
  // may coexist with an optional sign-in widget. Only the latter is readable.
  if(!visibleArticle && (query('#challenge-form,#challenge-running,.g-recaptcha,[data-testid="login-required"]') || /please (?:log|sign) in|sign in to continue|login to (?:continue|view)|verify you are human|checking your browser|请先登录|請先登入|安全验[证證]|安全驗證|验证[码碼]|驗證(?:碼|成功)|[请請]稍候/i.test(visible)))return failed('众筹页面需要登录或安全验证',true);
  if(!visibleArticle && /project (?:not found|has been removed|was deleted)|page (?:not found|does not exist)|页面不存在|项目已删除/i.test(visible))return failed('众筹项目页面不存在或已删除');
  if(!body) {
    const desc=typeof jsonPage?.description==='string'?jsonPage.description:(current.pageType==='story'?meta('og:description') || meta('description'):'');
    body=clean(desc);complete=false;
  }
  if(!body)return failed('当前项目正文尚未加载，未采集导航或推荐项目');
  const limitations=[];
  if(!root && !structuredFullContent){complete=false;limitations.push('仅取得项目简介，完整故事尚未加载');}
  if(!root && structuredFullContent && !complete)limitations.push('当前结构化问答存在未提供的答案');
  if(root && query('[aria-expanded="false"],.story-preview,.is-truncated,[data-truncated="true"],[data-read-more]',root)) {
    complete=false;limitations.push('当前内容存在折叠或未展开部分');
  }
  if(root && query('video,iframe[src*="youtube"],iframe[src*="vimeo"]',root)) {
    complete=false;limitations.push('包含视频，未取得视频字幕或音频');
  }
  if(root && query('img',root) && body.replace(/\s/g,'').length<80) {
    complete=false;limitations.push('项目说明主要为图片，未解析图片文字');
  }
  if(body.length>100000){body=body.slice(0,100000);complete=false;limitations.push('正文超过长度限制，已截取前100000字符');}
  const creator=(modernStorySection && query('[data-qa="project-properties:CreatorName"],.gfu-creators-line__name',modernStorySection)) || (projectRoot && query('[data-testid="project-creator"],[data-test-id="creator-name"],[data-project-creator],.creator-name,.basicsCampaignOwner-details-name',projectRoot));
  const author=clean(creator?.textContent || boundName(jsonPage?.author || jsonPage?.creator));
  const publishedAt=clean(jsonPage?.datePublished || (root && query('time[datetime]',root)?.getAttribute('datetime')) || meta('article:published_time'));
  const platformData={pageType:{label:'页面类型',raw:current.pageType}};
  if(limitations.length)platformData.limitations={label:'采集限制',raw:limitations.join('；')};
  const fundingRoots=[];
  for(const selector of ['[data-testid="project-funding"]','[data-test-id="project-funding"]','[data-project-funding]','#project-stats','.basicsGoalProgress'])for(const node of queryAll(selector))if(belongs(node))fundingRoots.push(node);
  if(projectRoot)fundingRoots.push(projectRoot);
  const fields={
    pledged:{label:'已筹金额',selectors:['[data-test-id="pledged-amount"]','[data-testid="pledged-amount"]','[data-testid="amount-raised"]','[data-funding-raised]','#pledged','.basicsGoalProgress-amountSold'],attribute:'data-funding-raised'},
    goal:{label:'目标金额',selectors:['[data-test-id="goal-amount"]','[data-testid="goal-amount"]','[data-funding-goal]'],attribute:'data-funding-goal'},
    backers:{label:'支持人数',selectors:['[data-test-id="backers-count"]','[data-testid="backers-count"]','[data-backers-count]','#backers_count'],attribute:'data-backers-count'},
    currency:{label:'币种',selectors:['[data-funding-currency]','[data-currency-code]'],attribute:'data-funding-currency'}
  };
  for(const [key,field] of Object.entries(fields)) {
    for(const container of fundingRoots) {
      let found;
      for(const selector of field.selectors){found=[...(container.matches?.(selector)?[container]:[]),...queryAll(selector,container)].find(belongs);if(found)break;}
      const raw=clean(found?.getAttribute(field.attribute) || (key==='currency' && found?.getAttribute('data-currency-code')) || found?.textContent);
      if(raw){platformData[key]={label:field.label,raw:raw.slice(0,600),source:'project-dom'};break;}
    }
  }
  return {title,body,author,publishedAt,canonicalUrl,url,contentRoot:!!(root || structuredFullContent),isLoginWall:false,metrics,status:complete?'complete':'partial',captureKind:complete?(current.pageType==='update'?'update':current.pageType==='faq'?'faq':'article'):'description',platformData};
}
