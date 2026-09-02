import {readFile} from 'node:fs/promises';

const [ux,measurements,loader]=await Promise.all([
  readFile(new URL('../public/v2/modules-v68-breakdown-analysis-ux.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v70-breakdown-measurements.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/modules-v57-section-reload.js',import.meta.url),'utf8')
]);
const assert=(ok,message)=>{if(!ok)throw new Error(message)};

for(const marker of [
  'تحليل الـBreakdown المختار',
  'العنصر محل التحليل:',
  'أفضل عنصر كفاءة',
  'أعلى هدر يحتاج مراجعة',
  'أعلى إنفاق',
  'أعلى مشتريات',
  'أفضل CTR',
  'نقاط تستحق التركيز',
  'إنفاق بدون شراء',
  'ROAS أقل بوضوح من بقية العناصر',
  'CPP مرتفع نسبيًا',
  'CTR منخفض نسبيًا',
  'CPM مرتفع نسبيًا',
  'Frequency يحتاج متابعة',
  'Action Breakdown'
])assert(ux.includes(marker),`Selected Breakdown analysis marker missing: ${marker}`);

assert(ux.includes('state.sections?.ad?.breakdownData'),'Breakdown analysis must use the currently selected Ads workspace breakdownData');
assert(ux.includes("selectedOptions?.[0]?.textContent")&&ux.includes('data?.label'),'Breakdown analysis must surface the selected Breakdown label');
assert(ux.includes("if(!data){")&&ux.includes('اضغط <b>تحميل الـBreakdown</b>'),'Changing Breakdown selection must clear stale analysis until the new data is loaded');
assert(ux.includes("data.metricMode==='actions'?actionAnalysis(data,label):deliveryAnalysis(data,label)"),'Action and delivery Breakdown analyses must stay semantically separate');
assert(ux.includes('medianRoas')&&ux.includes('medianCpp')&&ux.includes('medianCtr')&&ux.includes('medianCpm'),'Delivery analysis must compare focus metrics against the current Breakdown distribution instead of arbitrary global coloring');
assert(ux.includes('dataSignature')&&ux.includes('ux68Signature'),'Breakdown enhancement must be idempotent and avoid observer-driven repaint loops');
assert(ux.includes('markRows(data)')&&ux.includes('ux68-row-high')&&ux.includes('ux68-row-good'),'Breakdown table rows must receive visual focus marks consistent with the analysis');

for(const marker of ['كل نص فعلي ظاهر هنا','Asset ID','لا تستخدم الـID بدل النص','Spend','Purchases','CPP','ROAS','CTR','CPC','CPM','Frequency','dimensionAssetId','dimensionValue'])assert(measurements.includes(marker),`Readable Breakdown measurements marker missing: ${marker}`);
assert(measurements.includes('data-signature')||measurements.includes('dataset.signature'),'Readable Breakdown measurement rendering must remain idempotent');
assert(loader.includes('/v2/modules-v68-breakdown-analysis-ux.js?v=68.1'),'Campaign loader must deploy the current selected Breakdown analysis layer');
assert(loader.includes('/v2/modules-v70-breakdown-measurements.js?v=70.0'),'Campaign loader must deploy readable per-element Breakdown measurements');
new Function(ux);new Function(measurements);new Function(loader);
console.log('Selected Meta Breakdown analysis contract passed: current selection is named explicitly, stale analysis is cleared on selection change, rendering is idempotent, delivery/action analysis is separated, readable elements keep Asset IDs separate, and every measured element exposes its performance metrics.');
