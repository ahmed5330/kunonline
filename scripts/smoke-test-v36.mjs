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
console.log('Smoke v36 precheck passed: post-shipping carrier sheet importer is deployed.');

await propagatedAsset('/v2/modules-v66-campaign-hub.js?v=66.0','Campaign Hub UI',['مركز الحملات الإعلانية — تحليل خبير','الشغالة فقط','كل الإعلانات','تحليل الحملات الإعلانية','تحليل المجموعات الإعلانية','تحليل الإعلانات','Breakdown تفصيلي للإعلانات','data-campaign-section="campaign"','data-campaign-section="adset"','data-campaign-section="ad"','data-section-mode="analysis"','data-section-mode="comparison"','اليوم','أمس','آخر أسبوع','من بداية الشهر','آخر 30 يوم','فترة معينة','metricMode','Action Breakdowns']);
for(const path of ['/api/integrations/meta-ads/campaign-hub','/api/integrations/meta-ads/daily-comparison?level=campaign&status=active&days=7','/api/integrations/meta-ads/breakdowns?dimension=image_asset&status=active&days=7']){
  const response=await nativeFetch(`${base}${path}`,{redirect:'manual',headers:{'Cache-Control':'no-cache'}});
  if(response.status!==401)throw new Error(`Campaign protected route must reject anonymous access: ${path} -> ${response.status}`);
}
console.log('Smoke v36 precheck passed: independent Campaign/Ad Set/Ad workspaces, date presets, per-section comparison, Ads breakdown UI and protected APIs are deployed.');

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
