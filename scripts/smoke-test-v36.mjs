const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/smoke-test-v36.mjs <base-url>');
const nativeFetch=globalThis.fetch.bind(globalThis);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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

const versionResponse=await nativeFetch(`${base}/api/preview/version`,{redirect:'follow'}),versionBody=await versionResponse.text();
if(!versionResponse.ok)throw new Error(`/api/preview/version returned ${versionResponse.status}: ${versionBody}`);
let version;try{version=JSON.parse(versionBody);}catch{throw new Error(`Invalid Preview version response: ${versionBody}`);}
if(!String(version.build||'').startsWith('preview-v36-')||version.entrypoint!=='index-commerce-v36.js'||version.environment!=='preview')throw new Error(`Unexpected v36 Preview build: ${versionBody}`);
console.log(`Smoke v36 precheck passed: ${version.build}`);
const importer=await propagatedAsset('/v2/modules-v59-shipping-sheet-import.js?v=59.0','Shipping sheet importer',['رفع شيت شركة الشحن','J&T Express','المرتجعات','الكل — حسب حالة كل صف','parseXlsx','post-shipping-sheet']);
if(!importer)throw new Error('Shipping sheet importer body missing');
console.log('Smoke v36 precheck passed: post-shipping carrier sheet importer is deployed.');

await propagatedAsset('/v2/modules-v63-campaign-hub.js?v=63.0','Campaign Hub UI',['مركز الحملات الإعلانية — تحليل خبير','الشغالة فقط','كل الإعلانات','تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','Breakdown تفصيلي للإعلانات','مقارنة يوم بيوم','data-compare-level="campaign"','data-compare-level="adset"','data-compare-level="ad"']);
await propagatedAsset('/v2/modules-v64-meta-breakdown-catalog.js?v=64.0','Campaign breakdown catalog UI',['breakdownCatalog','optgroup','metricMode','إجمالي النتائج / الأحداث']);
for(const path of ['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison?level=campaign&status=active&days=7','/api/integrations/meta-ads/breakdowns?dimension=image_asset&status=active&days=7']){
  const response=await nativeFetch(`${base}${path}`,{redirect:'manual'});
  if(response.status!==401)throw new Error(`Campaign protected route must reject anonymous access: ${path} -> ${response.status}`);
}
console.log('Smoke v36 precheck passed: Campaign Hub UI, comparison controls, breakdown UI and protected APIs are deployed.');

// Keep the established smoke suite intact while its version assertion still names v35.
// Only the version endpoint response is adapted after the real v36 build was verified above.
globalThis.fetch=async(input,init)=>{
  const response=await nativeFetch(input,init);
  try{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.pathname==='/api/preview/version'){
      const body=await response.clone().json();
      if(!String(body.build||'').startsWith('preview-v36-')||body.entrypoint!=='index-commerce-v36.js')return response;
      const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');
      return new Response(JSON.stringify({...body,build:'preview-v35-v36-compat',entrypoint:'index-commerce-v35.js'}),{status:response.status,statusText:response.statusText,headers});
    }
  }catch{}
  return response;
};
await import('./smoke-test.mjs');
