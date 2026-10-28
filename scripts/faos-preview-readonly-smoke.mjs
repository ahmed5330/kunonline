// FAOS Preview public smoke checks: NO credentials, NO writes, no merchant data.
// Run after the existing Preview deployment ownership and baseline smoke gates.
const base=(process.argv[2]||'https://kunonline-preview.mr-a-mnaa.workers.dev').replace(/\/$/,'');
async function get(path,{method='GET'}={}){
  const r=await fetch(base+path,{method,headers:{'Accept':'application/json'},redirect:'manual'});
  const text=await r.text();
  return {status:r.status,headers:r.headers,text};
}
const asset=await get('/v2/modules-v155-accounting-faos.js?v=155.5');
if(asset.status!==200||(!asset.text.includes('مركز الحسابات والدفتر المحاسبي')||!asset.text.includes('kunFaosNavShortcut')))
  throw new Error('FAOS v155 Preview UI asset is not served by the deployed Worker');
console.log('FAOS Preview asset served: 200; Arabic finance workspace present');
for(const path of ['/api/accounting/faos/catalog','/api/accounting/faos/overview','/api/accounting/faos/simulation']){
  const response=await get(path);
  if(response.status!==401&&response.status!==403)
    throw new Error('FAOS unauthenticated GET must be denied; '+path+' returned '+response.status);
  if(response.status===401&&!response.text.includes('AUTH_REQUIRED'))
    throw new Error('Expected explicit FAOS auth rejection: '+path);
  console.log(path+': unauthenticated request rejected ('+response.status+')');
}
// Never call POST even in smoke; code-mode D1 tests separately verify the write gate.
console.log('PASS: Preview FAOS deployed asset and unauthenticated read-access guard. No financial data queried or mutated.');
