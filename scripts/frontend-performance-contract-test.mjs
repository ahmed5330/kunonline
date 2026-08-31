import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [index,perf,post,ai,rich,ads,recovery,permissions,search,v35,sectionReload]=await Promise.all([
  read('public/v2/index.html'),
  read('public/v2/performance-core-v52.js'),
  read('public/v2/modules-v47-post-shipping.js'),
  read('public/v2/modules-v34-dashboard-ai.js'),
  read('public/v2/modules-v42-customer-service-rich-cards.js'),
  read('public/v2/modules-v48-ad-expert.js'),
  read('public/v2/modules-v49-easyorders-recovery.js'),
  read('public/v2/modules-v51-permission-navigation.js'),
  read('public/v2/modules-v55-customer-search-fifo.js'),
  read('src/index-commerce-v35.js'),
  read('public/v2/modules-v57-section-reload.js')
]);

assert.ok(index.includes('/v2/performance-core-v52.js'), 'shared performance core must be loaded');
assert.ok(index.indexOf('/v2/performance-core-v52.js')<index.indexOf('/v2/modules-v4.js'), 'performance core must load before feature modules');
assert.equal(index.includes('/v2/modules-v45-post-shipping.js'),false,'superseded v45 post-shipping bundle must not load');
assert.ok(index.includes('/v2/modules-v55-customer-search-fifo.js?v=55.1'),'fast customer-search bundle must be cache-busted');
assert.ok(index.includes('/v2/modules-v57-section-reload.js?v=57.1'),'per-section reload bundle must be loaded');
assert.ok(index.indexOf('/v2/modules-v57-section-reload.js')>index.indexOf('/v2/modules-v56-returns-exchanges.js'),'section reload must load last so it can reuse feature-specific refreshers');
assert.ok(post.includes('.ps-page{display:grid'), 'v47 must own its base post-shipping styles after v45 removal');
assert.ok(perf.includes("if(path==='/api/me')return 15000"), 'repeated /api/me calls must be cached');
assert.equal(permissions.includes('new MutationObserver'),false,'permission navigation must not observe every nav class change');
assert.equal(recovery.includes('new MutationObserver'),false,'Easy Orders recovery button must not observe the whole root');
assert.ok(ai.includes("observe(root,{childList:true,subtree:false})"),'dashboard AI observer must stay root-only');
assert.ok(rich.includes("rootMargin:'80px 0px'"),'customer-service enrichment must stay close to viewport');
assert.ok(rich.includes('if(!active()||scanQueued)return'),'customer-service scans must be view-gated and coalesced');
assert.equal(ads.includes('if(data.connected&&noGranular'),false,'Meta granular sync must never start automatically from a dashboard read');
assert.ok(ads.includes('KunPerformanceCore?.idle'),'advanced ads analysis should be deferred until the page is idle');

for(const marker of ['data-kun-section-reload','تحديث بيانات هذا القسم فقط','reloadCurrentSection','KunDashboardV33','KunVariantInventoryV46','KunCustomerServiceV31','KunPostShippingV47','KunReturnsExchangesV56','KunProductCatalogV43','kun:section-reloaded','register:(view,handler)','kun-section-reload-head','kunReloadFallbackHead','root.prepend(fallback)','version:\'57.1\''])assert.ok(sectionReload.includes(marker),`section reload missing ${marker}`);
assert.ok(sectionReload.includes("observer.observe(root,{childList:true,subtree:false})"),'section reload observer must watch root children only');
assert.equal(sectionReload.includes('location.reload'),false,'section reload must never refresh the whole browser page');
assert.doesNotThrow(()=>new Function(sectionReload),'section reload browser module must parse');

assert.ok(search.includes('operationalCustomerMatches'),'customer-service/post-shipping search must list all local matching customers');
assert.ok(search.includes('كل العملاء المطابقين للاسم'),'operational search must clearly expose the full matching list');
assert.equal(search.includes('/api/state?clientId='),false,'operational name search must never load the full /api/state payload');
assert.ok(search.includes("observe(root,{childList:true,subtree:false})"),'customer-search observer must be root-only instead of watching the full document tree');

const dashboardStart=v35.indexOf('async function dashboard');
const reconcileStart=v35.indexOf('async function reconcileRoute');
const dashboardSegment=v35.slice(dashboardStart,reconcileStart);
assert.equal(dashboardSegment.includes('reconcileEasyOrdersDuplicates('),false,'dashboard GET must not rescan thousands of Easy Orders rows');
const stateStart=v35.indexOf("if(path==='/api/state'&&method==='GET')");
const customerServiceStart=v35.indexOf("if(path==='/api/customer-service'&&method==='GET')");
const delegateStart=v35.indexOf('return await commerceV34.fetch(request,env,ctx);',customerServiceStart);
assert.equal(v35.slice(stateStart,customerServiceStart).includes('reconcileEasyOrdersDuplicates('),false,'/api/state GET must not run dedupe reconciliation');
assert.equal(v35.slice(customerServiceStart,delegateStart).includes('reconcileEasyOrdersDuplicates('),false,'customer-service GET must not run dedupe reconciliation');
assert.ok(v35.includes('Fast read paths'),'v35 should document the non-blocking dedupe read policy');

console.log('Frontend performance contract passed');