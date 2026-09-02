import {readFile} from 'node:fs/promises';

const [migration,entry,ui,index,preview,v36,hub,comparisonUx,detail,detailV2,detailV3,measurements,controls,reload,allFilter]=await Promise.all([
  readFile(new URL('../migrations/0021_meta_ads_granular_analysis.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v48-ad-expert.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v66-campaign-hub.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v67-campaign-comparison-ux.js',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-detail.js',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-detail-v2.js',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-detail-v3.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v70-breakdown-measurements.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v71-breakdown-controls.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-all.js',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
assert(migration.includes('meta_ad_entities')&&migration.includes('meta_ad_daily_metrics'),'Granular Meta tables missing');
assert(migration.includes("'adset','ad'")||migration.includes("'adset', 'ad'"),'Ad set/ad levels missing');
assert(entry.includes('/api/integrations/meta-ads/expert-analysis'),'Expert analysis route missing');
assert(entry.includes('/api/integrations/meta-ads/expert-sync'),'Expert sync route missing');
assert(entry.includes('syncAllMetaAdsGranularScheduled')&&entry.includes("cron==='0 */2 * * *'")&&entry.includes('syncMetaAdsGranular(env,{clientId:row.clientId,days})'),'Deep scheduled Meta refresh must keep Ad Set and Ad analysis current');
assert(entry.includes('syncAllMetaAdsNearLiveScheduled')&&entry.includes("cron==='* * * * *'")&&entry.includes('syncMetaAdsForClient(env,{clientId:row.clientId,days})')&&entry.includes('syncMetaAdsGranular(env,{clientId:row.clientId,days})'),'One-minute Meta refresh must update Campaign + Ad Set + Ad');
assert(entry.includes("from 'cloudflare:workers'")&&entry.includes('class SyncEntrypoint extends WorkerEntrypoint')&&entry.includes('async runCron(cron)'),'App Worker must expose the private RPC sync entrypoint before scheduler isolation');
for(const heading of ['تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','قراءة خبير الإعلانات'])assert(ui.includes(heading),`Dashboard expert heading missing: ${heading}`);
for(const signal of ['مرشح للتوسيع','إجهاد إعلاني','مشكلة بعد النقرة'])assert(ui.includes(signal)||ui.includes('flags'),`Expert signal support missing: ${signal}`);
assert(index.includes('modules-v48-ad-expert.js'),'Expert dashboard bundle is not loaded');
assert(/main\s*=\s*"src\/index-commerce-v3[456]\.js"/.test(preview),'Preview is not routed through the v34 Meta layer or its additive v35/v36 wrapper');
for(const route of ['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison','/api/integrations/meta-ads/breakdowns'])assert(v36.includes(route),`Campaign hub route missing: ${route}`);
assert(v36.includes("requirePermission(me,'campaigns','read')")&&v36.includes('resolveStoreScope'),'Campaign hub must preserve campaign permission and store isolation');
assert(v36.includes('includeInactiveExpertEntities')&&v36.includes('includeInactiveComparisonEntities'),'Campaigns all filter must augment analysis and comparison with inactive zero-spend entities');
assert(v36.includes("from './meta-ads-campaign-detail-v3.js'")&&v36.includes('metaBreakdownScopeGuard:true')&&v36.includes('currentMetaSdkBreakdowns:true')&&v36.includes('readableCreativeBreakdowns:true'),'Preview entrypoint must use the hardened readable Meta breakdown layer');
assert(v36.includes('campaignAuthFailClosed:true')&&v36.includes('catch{')&&v36.includes("code:'AUTH_REQUIRED'"),'Campaign protected routes must fail closed to explicit authentication instead of surfacing session lookup failures');
for(const marker of ['allEntitiesIncluded','meta_ad_entities',"statusFilter!=='all'",'zeroMetrics','includeInactiveExpertEntities','includeInactiveComparisonEntities'])assert(allFilter.includes(marker),`Exhaustive all-ad helper missing marker: ${marker}`);
for(const level of ["'campaign'","'adset'","'ad'"])assert(detail.includes(level),`Daily comparison level missing: ${level}`);
for(const bd of ['image_asset','video_asset','body_asset','title_asset','region','country','zip','publisher_platform','platform_position','device_platform','impression_device','product_brand_breakdown','product_category_breakdown','gen_ai_asset_type','creative_automation_asset_id'])assert(detail.includes(bd),`Requested Meta breakdown missing: ${bd}`);
for(const currentBd of ['affiliate_click_region','affiliate_link_url','msa_seller_name','placement_path'])assert(detailV2.includes(currentBd),`Current Meta SDK breakdown missing: ${currentBd}`);
for(const action of ['action_type','action_device','action_destination','action_carousel_card_name','standard_event_content_type'])assert(detail.includes(`actionBreakdown('${action}'`),`Action breakdown support missing: ${action}`);
assert(detail.includes("[catalogItem.param]:catalogItem.key")&&detail.includes("param:'action_breakdowns'"),'Breakdown endpoint must route regular and action breakdown parameters separately');
assert(detail.includes("metricMode:'actions'")&&detail.includes('actionBreakdownRows')&&detail.includes('لا نوزّع Spend أو CPM'),'Action Breakdowns must be modeled as event/result data instead of duplicated delivery spend');
assert(detailV2.includes("SELECT external_id FROM meta_ad_entities WHERE client_id=? AND level='ad'")&&detailV2.includes("allowed.has(clean(row.adId))")&&detailV2.includes('scopeFiltered:true'),'Meta breakdown rows must be hard-filtered to the selected tenant/store ad catalog');
assert(detailV2.includes('deliveryTotals(rows)')&&detailV2.includes('actionTotals(rows)'),'Breakdown totals must be recomputed after scope filtering');
for(const marker of ['readableBreakdownValue','dimensionAssetId','dimensionResolved','asset_feed_spec','object_story_spec','creative-id','creative-single','COMPOSITE_BREAKDOWNS','metricAvailability','compatibleFetcher'])assert(detailV3.includes(marker),`Readable/compatible creative Breakdown resolver missing marker: ${marker}`);
for(const label of ['الشغالة فقط','كل الإعلانات','تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','Breakdown تفصيلي للإعلانات','Action Breakdowns','اليوم','أمس','آخر أسبوع','من بداية الشهر','آخر 30 يوم','فترة معينة'])assert(hub.includes(label),`Campaign hub UI contract missing: ${label}`);
for(const section of ['data-campaign-section="campaign"','data-campaign-section="adset"','data-campaign-section="ad"'])assert(hub.includes(section),`Independent Campaign Hub section missing: ${section}`);
assert(hub.includes("sections:{campaign:freshSection(),adset:freshSection(),ad:freshSection()}")&&hub.includes("preset:'7d'")&&hub.includes("mode:'analysis'"),'Campaign, Ad Set and Ad must keep independent date/mode state');
assert(hub.includes("data-section-mode=\"analysis\"")&&hub.includes("data-section-mode=\"comparison\""),'Every Campaign Hub section must expose analysis and comparison modes');
assert(hub.includes("if(s.preset==='today')")&&hub.includes("if(s.preset==='yesterday')")&&hub.includes("if(s.preset==='mtd')")&&hub.includes("if(s.preset==='30d')")&&hub.includes("if(s.preset==='custom')"),'Campaign Hub date presets must map to explicit date ranges');
assert(hub.includes("scopedPath('/api/integrations/meta-ads/daily-comparison',level,{level,status:state.status,days})"),'Each section comparison must call the daily comparison API at its fixed level');
assert(hub.includes("level==='ad'?breakdownSection(section):''"),'Detailed Meta breakdown must remain inside the Ads section only');
assert(hub.includes("state.status==='all'?")&&hub.includes('status:state.status'),'Active/all filter must drive analysis and data APIs together');
assert(hub.includes('breakdownCatalog')&&hub.includes('optgroup')&&hub.includes("data.metricMode==='actions'")&&hub.includes('النتائج / الأحداث'),'Full server breakdown catalog and Action Breakdown result table must hydrate the Ads workspace');
for(const metric of ['الإنفاق','المشتريات','تكلفة الشراء','العائد على الإنفاق','نسبة النقر','تكلفة ألف ظهور','التكرار'])assert(comparisonUx.includes(metric),`Comparison UX core metric missing: ${metric}`);
assert(comparisonUx.includes('ux67-metric-col')&&comparisonUx.includes('position:sticky;left:0'),'Comparison measurement column must remain sticky on the left while dates scroll');
assert(comparisonUx.includes('direction:ltr')&&comparisonUx.includes('ux67-scroll'),'Comparison matrix must keep chronological horizontal scrolling independent from the RTL app shell');
assert(comparisonUx.includes('buildSignals')&&comparisonUx.includes("severity:'high'")&&comparisonUx.includes("severity:'watch'")&&comparisonUx.includes("severity:'good'"),'Comparison UX must classify urgent, watch and positive signals');
assert(comparisonUx.includes('data-ux67-signal')&&comparisonUx.includes('ux67-marker')&&comparisonUx.includes('الأرقام التي تستحق النظر'),'Flagged comparison numbers must have visual markers tied to analysis below');
assert(comparisonUx.includes('scrollIntoView')&&comparisonUx.includes('ux67Insight-'),'Clicking a marked number must focus its matching analysis card');
assert(comparisonUx.includes('إنفاق بدون مشتريات')&&comparisonUx.includes('هبوط واضح في ROAS')&&comparisonUx.includes('ارتفاع تكلفة الشراء')&&comparisonUx.includes('CTR يتراجع')&&comparisonUx.includes('CPM أعلى من اليوم السابق'),'Comparison UX must explain the main efficiency signals rather than only coloring numbers');
for(const marker of ['كل نص فعلي ظاهر هنا','Asset ID','لا تستخدم الـID بدل النص','Spend','Purchases','CPP','ROAS','CTR','CPC','CPM','Frequency','metricAvailability'])assert(measurements.includes(marker),`Readable per-element Breakdown UI missing marker: ${marker}`);
assert(measurements.includes('dimensionAssetId')&&measurements.includes('dimensionValue'),'Per-element Breakdown UI must keep technical ID separate from readable value');
for(const marker of ['AbortController','activeController.abort','aria-busy','campaign71BreakdownRetry','decorateCatalog','مشروط','متوافق تلقائيًا','الطلب اشتغل بنجاح'])assert(controls.includes(marker),`Reliable Breakdown controls missing marker: ${marker}`);
assert(reload.includes('modules-v66-campaign-hub.js?v=66.0')&&reload.includes('modules-v67-campaign-comparison-ux.js?v=67.0')&&reload.includes('modules-v68-breakdown-analysis-ux.js?v=68.1')&&reload.includes('modules-v70-breakdown-measurements.js?v=70.1')&&reload.includes('modules-v71-breakdown-controls.js?v=71.1')&&!reload.includes('modules-v65-campaign-hub.js?v=65.0'),'Campaign loader must keep v66 workspaces and load current comparison, analysis, readable measurements and reliable controls layers');
new Function(hub);new Function(comparisonUx);new Function(measurements);new Function(controls);new Function(reload);
console.log('Meta Ads expert analysis contract passed, including independent Campaign/Ad Set/Ad workspaces, per-section dates, sticky comparison metrics, readable creative values, compatible Meta Breakdown requests, per-element measurement cards, reliable controls, exhaustive filtering, current Meta SDK coverage and tenant/store scoping.');
