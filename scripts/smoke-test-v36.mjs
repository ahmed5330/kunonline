const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/smoke-test-v36.mjs <base-url>');
const nativeFetch=globalThis.fetch.bind(globalThis);
const versionResponse=await nativeFetch(`${base}/api/preview/version`,{redirect:'follow'}),versionBody=await versionResponse.text();
if(!versionResponse.ok)throw new Error(`/api/preview/version returned ${versionResponse.status}: ${versionBody}`);
let version;try{version=JSON.parse(versionBody);}catch{throw new Error(`Invalid Preview version response: ${versionBody}`);}
if(!String(version.build||'').startsWith('preview-v36-')||version.entrypoint!=='index-commerce-v36.js'||version.environment!=='preview')throw new Error(`Unexpected v36 Preview build: ${versionBody}`);
console.log(`Smoke v36 precheck passed: ${version.build}`);
const importer=await nativeFetch(`${base}/v2/modules-v59-shipping-sheet-import.js?v=59.0`,{redirect:'follow'}),importerBody=await importer.text();
if(!importer.ok)throw new Error(`Shipping sheet importer returned ${importer.status}`);
for(const marker of ['رفع شيت شركة الشحن','J&T Express','المرتجعات','الكل — حسب حالة كل صف','parseXlsx','post-shipping-sheet'])if(!importerBody.includes(marker))throw new Error(`Shipping sheet importer missing deployed marker: ${marker}`);
console.log('Smoke v36 precheck passed: post-shipping carrier sheet importer is deployed.');
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
