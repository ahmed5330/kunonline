// Read-only release gate: Production depends on the canonical Preview Worker
// for API data. Never deploy a new production frontend against an old backend.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export const REQUIRED_RELEASE='kun-growth-wallet-20261015-r1';
export const REQUIRED_CAPABILITIES=[
  'growth-scenario','stock-catalog','operating-evidence','accounting-cod-quality','wallet-ledger-integrity'
];
export function validatePreviewRelease(data){
  const capabilities=Array.isArray(data?.capabilities)?data.capabilities:[];
  return {ok:data?.ok===true&&data?.release===REQUIRED_RELEASE&&data?.environment==='preview'&&
    REQUIRED_CAPABILITIES.every(key=>capabilities.includes(key)),
    foundRelease:String(data?.release||''),environment:String(data?.environment||''),
    missing:REQUIRED_CAPABILITIES.filter(key=>!capabilities.includes(key))};
}
export async function preflightPreview({fetcher=fetch,origin='https://kunonline-preview.mr-a-mnaa.workers.dev'}={}){
  if(origin!=='https://kunonline-preview.mr-a-mnaa.workers.dev')
    throw Error('Refusing release gate for an unexpected Preview origin');
  const response=await fetcher(origin+'/api/preview/growth-release?verify='+encodeURIComponent(REQUIRED_RELEASE),
    {headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
  if(response.status!==200)throw Error('Preview release gate HTTP '+response.status+
    ' — release preview backend first; production deployment blocked');
  const data=await response.json();
  const result=validatePreviewRelease(data);
  if(!result.ok)throw Error('Preview backend release incompatible: '+
    JSON.stringify(result)+'; production deployment blocked');
  return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  await preflightPreview();
  console.log('Production/Preview release compatibility PASS');
}
