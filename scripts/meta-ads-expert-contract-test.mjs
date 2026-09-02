import {readFile} from 'node:fs/promises';

const [migration,entry,ui,index,preview,v36,hub,detail,reload,catalogUi,allFilter]=await Promise.all([
  readFile(new URL('../migrations/0021_meta_ads_granular_analysis.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v48-ad-expert.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v63-campaign-hub.js',import.meta.url),'utf8'),
  readFile(new URL('../src/meta-ads-campaign-detail.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v64-meta-breakdown-catalog.js',import.meta.url),'utf8'),
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
for(const marker of ['allEntitiesIncluded','meta_ad_entities',"statusFilter!=='all'",'zeroMetrics','includeInactiveExpertEntities','includeInactiveComparisonEntities'])assert(allFilter.includes(marker),`Exhaustive all-ad helper missing marker: ${marker}`);
for(const level of ["'campaign'","'adset'","'ad'"])assert(detail.includes(level),`Daily comparison level missing: ${level}`);
for(const bd of ['image_asset','video_asset','body_asset','title_asset','region','country','zip','publisher_platform','platform_position','device_platform','impression_device','product_brand_breakdown','product_category_breakdown','gen_ai_asset_type','creative_automation_asset_id'])assert(detail.includes(bd),`Requested Meta breakdown missing: ${bd}`);
for(const action of ['action_type','action_device','action_destination','action_carousel_card_name','standard_event_content_type'])assert(detail.includes(`actionBreakdown('${action}'`),`Action breakdown support missing: ${action}`);
assert(detail.includes("[catalogItem.param]:catalogItem.key")&&detail.includes("param:'action_breakdowns'"),'Breakdown endpoint must route regular and action breakdown parameters separately');
assert(detail.includes("metricMode:'actions'")&&detail.includes('actionBreakdownRows')&&detail.includes('لا نوزّع Spend أو CPM'),'Action Breakdowns must be modeled as event/result data instead of duplicated delivery spend');
for(const label of ['الشغالة فقط','كل الإعلانات','تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','Breakdown تفصيلي للإعلانات','مقارنة يوم بيوم'])assert(hub.includes(label),`Campaign hub UI contract missing: ${label}`);
assert(hub.includes("state.status==='all'?rows:rows.filter(isActive)")&&hub.includes("status:state.status"),'Active/all filter must drive analysis and data APIs together');
assert(hub.includes("data-compare-level=\"campaign\"")&&hub.includes("data-compare-level=\"adset\"")&&hub.includes("data-compare-level=\"ad\""),'Daily comparison must support Campaign, Ad Set and Ad levels');
assert(reload.includes('modules-v63-campaign-hub.js?v=63.0')&&reload.includes('modules-v64-meta-breakdown-catalog.js?v=64.0'),'Campaign hub/full breakdown loaders are missing');
assert(catalogUi.includes('breakdownCatalog')&&catalogUi.includes('optgroup')&&catalogUi.includes('metricMode')&&catalogUi.includes('إجمالي النتائج / الأحداث'),'Full breakdown selector and Action Breakdown result table must hydrate the Campaigns UI');
new Function(hub);new Function(catalogUi);new Function(reload);
console.log('Meta Ads expert analysis contract passed, including exhaustive active/all Campaign-AdSet-Ad filtering, expert recommendations, full Meta/action breakdown catalog, safe Action Breakdown accounting and day-by-day comparison.');
