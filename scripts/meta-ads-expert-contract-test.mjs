import {readFile} from 'node:fs/promises';

const [migration,entry,ui,index,preview]=await Promise.all([
  readFile(new URL('../migrations/0021_meta_ads_granular_analysis.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v34.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v48-ad-expert.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/index.html',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
assert(migration.includes('meta_ad_entities')&&migration.includes('meta_ad_daily_metrics'),'Granular Meta tables missing');
assert(migration.includes("'adset','ad'")||migration.includes("'adset', 'ad'"),'Ad set/ad levels missing');
assert(entry.includes('/api/integrations/meta-ads/expert-analysis'),'Expert analysis route missing');
assert(entry.includes('/api/integrations/meta-ads/expert-sync'),'Expert sync route missing');
assert(entry.includes('syncAllMetaAdsGranularScheduled')&&entry.includes("cron==='0 */2 * * *'")&&entry.includes('syncMetaAdsGranular(env,{clientId,days})'),'Scheduled Meta refresh must keep Ad Set and Ad analysis current, not campaigns only');
for(const heading of ['تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','قراءة خبير الإعلانات'])assert(ui.includes(heading),`Dashboard expert heading missing: ${heading}`);
for(const signal of ['مرشح للتوسيع','إجهاد إعلاني','مشكلة بعد النقرة'])assert(ui.includes(signal)||ui.includes('flags'),`Expert signal support missing: ${signal}`);
assert(index.includes('modules-v48-ad-expert.js'),'Expert dashboard bundle is not loaded');
assert(preview.includes('main = "src/index-commerce-v34.js"'),'Preview is not routed through v34');
console.log('Meta Ads expert analysis contract passed, including scheduled campaign + Ad Set + Ad refresh.');
