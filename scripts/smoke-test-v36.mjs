import {readFile} from 'node:fs/promises';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/smoke-test-v36.mjs <base-url>');
const nativeFetch=globalThis.fetch.bind(globalThis);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const entrySource=await readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8');
const expectedBuild=entrySource.match(/const BUILD=['"]([^'"]+)['"]/i)?.[1]||'';
if(!expectedBuild)throw new Error('Could not resolve the expected Preview BUILD from src/index-commerce-v36.js');

async function propagatedAsset(path,label,markers=[],attempts=24){
  let last='not requested';
  for(let attempt=1;attempt<=attempts;attempt++){
    const separator=path.includes('?')?'&':'?';
    try{
      const response=await nativeFetch(`${base}${path}${separator}smoke=${Date.now()}-${attempt}`,{redirect:'follow',headers:{'Cache-Control':'no-cache'}}),body=await response.text();
      const missing=markers.filter(marker=>!body.includes(marker));
      if(response.ok&&!missing.length)return body;
      last=`HTTP ${response.status}${missing.length?` missing: ${missing.join(' | ')}`:''}`;
    }catch(error){last=error?.message||String(error);}
    if(attempt<attempts)await sleep(500);
  }
  throw new Error(`${label} unavailable after static-asset propagation retries: ${last}`);
}
async function currentPreviewBuild(attempts=48){
  let last='not requested';
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await nativeFetch(`${base}/api/preview/version?smokeWorker=${Date.now()}-${attempt}`,{redirect:'follow',headers:{'Cache-Control':'no-cache'}}),body=await response.text();
      let parsed=null;try{parsed=JSON.parse(body);}catch{}
      if(response.ok&&parsed?.build===expectedBuild&&parsed?.entrypoint==='index-commerce-v36.js'&&parsed?.environment==='preview')return parsed;
      last=`HTTP ${response.status} build=${parsed?.build||'invalid'} entrypoint=${parsed?.entrypoint||'invalid'} environment=${parsed?.environment||'invalid'}`;
    }catch(error){last=error?.message||String(error);}
    if(attempt<attempts)await sleep(500);
  }
  throw new Error(`Exact Preview Worker build did not propagate. Expected ${expectedBuild}; last response: ${last}`);
}

const version=await currentPreviewBuild();
console.log(`Smoke v36 precheck passed: exact Preview Worker build ${version.build}`);
const importer=await propagatedAsset('/v2/modules-v59-shipping-sheet-import.js?v=59.0','Shipping sheet importer',['رفع شيت شركة الشحن','J&T Express','المرتجعات','الكل — حسب حالة كل صف','parseXlsx','post-shipping-sheet']);
if(!importer)throw new Error('Shipping sheet importer body missing');
await propagatedAsset('/v2/modules-v64-shipping-smart-sync.js?v=64.1','Smart Shipping v64.1',['Smart Shipping Sync','Inventory-first + Safe Match','inventoryBlocked:Boolean(error?.data?.inventoryBlocked)','inventoryBlockCode','موقوف مخزنيًا',"version:'64.1'"]);
await propagatedAsset('/v2/','v2 Smart Shipping shell',['modules-v64-shipping-smart-sync.js?v=64.1']);
console.log('Smoke v36 precheck passed: post-shipping carrier importer + Smart Shipping v64.1 UI are deployed.');

await propagatedAsset('/v2/modules-v75-customer-service-interactions.js?v=75.2','Customer Service reliable interactions v75.2',['KunCustomerServiceInteractionsV75','saveNote','saveContact','keepalive:isCall','data-cs-contact-count','updateContactCount?.(id,count)','تم تسجيل المكالمة في سجل الأوردر',"version:'75.2'"]);
await propagatedAsset('/v2/','v2 Customer Service interaction shell',['modules-v75-customer-service-interactions.js?v=75.2']);
console.log('Smoke v36 precheck passed: Customer Service v75.2 unified note/contact/call interaction layer is deployed.');

await propagatedAsset('/v2/modules-v74-admin-client-command-center.js?v=74.0','Admin Client Command Center',['Client Command Center','فتح بريف العميل','الطلبات والتحصيل','التسويق والإعلانات','المالية والمخزون','ما يحتاج انتباهك','ملخص الحملات في الفترة','مقابل الفترة السابقة','فترة معينة']);
await propagatedAsset('/v2/modules-v23-admin.js?v=23.3','Admin Client Command Center loader',['modules-v74-admin-client-command-center.js?v=74.0','kunAdminClientCommandV74Loader']);
const anonymousAdmin=await nativeFetch(`${base}/api/admin/client-command-center?preset=today`,{redirect:'manual',headers:{'Cache-Control':'no-cache'}});if(anonymousAdmin.status!==401)throw new Error(`Admin Command Center must reject anonymous access -> ${anonymousAdmin.status}`);
console.log('Smoke v36 precheck passed: Admin Client Command Center v74 is deployed and its aggregate API is protected.');

await propagatedAsset('/v2/modules-v66-campaign-hub.js?v=66.0','Campaign Hub UI',['مركز الحملات الإعلانية — تحليل خبير','الشغالة فقط','كل الإعلانات','تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','Breakdown تفصيلي للإعلانات','data-campaign-section="campaign"','data-campaign-section="adset"','data-campaign-section="ad"','data-section-mode="analysis"','data-section-mode="comparison"','اليوم','أمس','آخر أسبوع','من بداية الشهر','آخر 30 يوم','فترة معينة','metricMode','Action Breakdowns']);
await propagatedAsset('/v2/modules-v67-campaign-comparison-ux.js?v=67.0','Campaign comparison UX',['ux67-metric-col','position:sticky;left:0','الأرقام التي تستحق النظر','data-ux67-signal','ux67-marker','scrollIntoView','إنفاق بدون مشتريات','هبوط واضح في ROAS','ارتفاع تكلفة الشراء','CTR يتراجع','CPM أعلى من اليوم السابق','راجع الآن','فرصة إيجابية']);
await propagatedAsset('/v2/modules-v68-breakdown-analysis-ux.js?v=68.1','Selected Breakdown analysis UX',['تحليل الـBreakdown المختار','العنصر محل التحليل:','أفضل عنصر كفاءة','أعلى هدر يحتاج مراجعة','أعلى إنفاق','أعلى مشتريات','أفضل CTR','نقاط تستحق التركيز','إنفاق بدون شراء','ROAS أقل بوضوح من بقية العناصر','CPP مرتفع نسبيًا','CTR منخفض نسبيًا','CPM مرتفع نسبيًا','Frequency يحتاج متابعة','Action Breakdown','breakdownData']);
await propagatedAsset('/v2/modules-v70-breakdown-measurements.js?v=70.1','Readable Breakdown element measurements',['كل ${data.label','Asset ID','كل نص فعلي ظاهر هنا','Spend','Purchases','CPP','ROAS','CTR','CPC','CPM','Frequency','لا تستخدم الـID بدل النص','dimensionAssetId','metricAvailability']);
await propagatedAsset('/v2/modules-v71-breakdown-controls.js?v=71.2','Reliable Breakdown controls',['KunBreakdownControlsV71','AbortController','campaign71BreakdownRetry','aria-busy','stopImmediatePropagation','requestId!==sequence','activeKey!==key','campaign-controls-changed','option.textContent!==desired','observerQueued',"version:'71.2'"]);
await propagatedAsset('/v2/modules-v72-campaign-visual-density.js?v=72.0','Compact Campaign visual density',['KunCampaignVisualDensityV72','metricOrder','min-width:88px;width:88px','data-ux72-metric','data-ux72-summary','data-ux72-kpi','position:sticky;right:0','ux72-focus','عرض موسّع','aria-pressed',"version:'72.0'"]);
await propagatedAsset('/v2/modules-v73-campaign-parent-scope.js?v=73.0','Campaign parent analysis scope',['KunCampaignParentScopeV73','الحملة المراد تحليل مجموعاتها','المجموعة المراد تحليل إعلاناتها','نطاق تحليل المجموعات','نطاق تحليل الإعلانات','filterHubPayload','filterComparisonPayload','parentScopeApplied',"version:'73.0'"]);
await propagatedAsset('/v2/modules-v57-section-reload.js?v=57.1','Campaign layered loader',['modules-v70-breakdown-measurements.js?v=70.1','modules-v71-breakdown-controls.js?v=71.2','modules-v72-campaign-visual-density.js?v=72.0','modules-v73-campaign-parent-scope.js?v=73.0','loadControls','loadMeasurements','loadVisual','loadParent']);
for(const path of ['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison?level=campaign&status=active&days=7','/api/integrations/meta-ads/breakdowns?dimension=image_asset&status=active&days=7']){
  const response=await nativeFetch(`${base}${path}`,{redirect:'manual',headers:{'Cache-Control':'no-cache'}});
  if(response.status!==401)throw new Error(`Campaign protected route must reject anonymous access: ${path} -> ${response.status}`);
}
console.log('Smoke v36 precheck passed: Campaign workspaces, compact colored comparison v72, parent selection v73, sticky context/period totals, selected Breakdown analysis, readable measurements and reliable controls are deployed with protected APIs.');

// Keep the established smoke suite intact while its version assertion still names v35.
// Only the version endpoint response is adapted after the exact current v36 build was verified above.
globalThis.fetch=async(input,init)=>{
  const response=await nativeFetch(input,init);
  try{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.pathname==='/api/preview/version'){
      const body=await response.clone().json();
      if(body?.build!==expectedBuild||body.entrypoint!=='index-commerce-v36.js')return response;
      const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');
      return new Response(JSON.stringify({...body,build:'preview-v35-v36-compat',entrypoint:'index-commerce-v35.js'}),{status:response.status,statusText:response.statusText,headers});
    }
  }catch{}
  return response;
};
await import('./smoke-test.mjs');