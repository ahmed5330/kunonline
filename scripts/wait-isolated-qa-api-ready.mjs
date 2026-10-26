// GET-only readiness for new Workers.dev registration, before synthetic writes.
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {loadIsolatedPreviewQaConfig}=await import(pathToFileURL(join(resolve('qa-backend'),'scripts/isolated-preview-qa-config.mjs')));
const base=process.env.KUN_PREVIEW_QA_BASE_URL;
await loadIsolatedPreviewQaConfig(base);
let consecutive=0;
const deadline=Date.now()+90000;
while(Date.now()<deadline){
 try{
  const response=await fetch(base+'/api/me?qaRoutingReadiness='+Date.now(),{method:'GET',redirect:'error',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  consecutive=response.status===200&&data.role===null?consecutive+1:0;
  if(consecutive===3){console.log(JSON.stringify({kind:'ISOLATED_QA_PUBLIC_API_READY',anonymousApiVerified:true,consecutivePasses:3,customerRowsModified:false}));process.exit(0);}
 }catch{consecutive=0;}
 await new Promise(resolve=>setTimeout(resolve,2000));
}
console.error('ISOLATED_QA_API_ROUTING_NOT_READY');process.exitCode=1;
