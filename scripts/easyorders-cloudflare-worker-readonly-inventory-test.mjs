import assert from 'node:assert/strict';
import {inventoryEasyOrdersWorkers} from './easyorders-cloudflare-worker-readonly-inventory.mjs';

const accountId='a'.repeat(32),token='TEST_ONLY_CLOUDFLARE_TOKEN_SHOULD_NEVER_PRINT';
const called=[];
let omitCron=false,omitRpc=false,httpDenied=false;
const fetcher=async(url,opts)=>{
  called.push({url,opts});
  assert.equal(opts.method,'GET','Remote Cloudflare calls may not mutate');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'));
  assert.doesNotMatch(url,/token|secret|key|password/i,'Never put secrets into URLs');
  if(httpDenied)return Response.json({success:false,errors:[{message:'DO_NOT_PRINT_PRIVATE_PROVIDER_PASSWORD'}]},{status:403});
  const kind=url.split('/').at(-1),worker=url.split('/').at(-2);
  let result;
  if(kind==='schedules')result={schedules:worker==='kunonline-sync-preview'&&!omitCron
    ?['*/5 * * * *','*/15 * * * *','0 */2 * * *'].map(cron=>({cron})):[]
  };
  else if(kind==='settings')result={bindings:worker==='kunonline-sync-preview'&& !omitRpc
    ?[{name:'APP_SYNC',type:'service',service:'kunonline-preview',entrypoint:'SyncEntrypoint'},
       {name:'VERY_PRIVATE_KEY',type:'secret_text',text:'DO_NOT_PRINT_PRIVATE_PROVIDER_PASSWORD'}]
    :worker==='kunonline'?
       [{name:'PREVIEW_APP',type:'service',service:'kunonline-preview'},
        {name:'PREVIEW_DB',type:'d1',id:'DO_NOT_PRINT_PRIVATE_D1_UUID'},
        {name:'API_KEY',type:'secret_text',text:'DO_NOT_PRINT_PRIVATE_PROVIDER_PASSWORD'}]:[]
  };
  else if(kind==='deployments')result={deployments:[{versions:[{version_id:'synthetic-version-1234'}]}]};
  else throw Error('Unexpected GET endpoint');
  return Response.json({success:true,result});
};

const baseline=await inventoryEasyOrdersWorkers({accountId,token,fetcher});
assert.equal(baseline.passesMetadataGate,true);
assert.equal(called.length,9);
assert.deepEqual(baseline.workers['kunonline-sync-preview'].crons,
  ['*/15 * * * *','*/5 * * * *','0 */2 * * *'].sort());
assert.equal(baseline.liveCronExecutionProven,false);
assert.equal(baseline.liveD1Read,false);
assert.equal(baseline.wroteCloudflareData,false);
const printed=JSON.stringify(baseline);
for(const secret of [token,accountId,'DO_NOT_PRINT_PRIVATE_PROVIDER_PASSWORD','DO_NOT_PRINT_PRIVATE_D1_UUID']){
  assert.ok(!printed.includes(secret),'Sanitized metadata must never expose credentials or D1 IDs');
}
assert.deepEqual(baseline.workers.kunonline.bindings.map(x=>x.name),['PREVIEW_APP','PREVIEW_DB']);
omitCron=true;
const noCron=await inventoryEasyOrdersWorkers({accountId,token,fetcher});
assert.equal(noCron.passesMetadataGate,false);
assert.equal(noCron.checks.cronFound,false);
omitCron=false;
omitRpc=true;
const noRpc=await inventoryEasyOrdersWorkers({accountId,token,fetcher});
assert.equal(noRpc.passesMetadataGate,false);
assert.equal(noRpc.checks.rpcBinding,false);
omitRpc=false;
httpDenied=true;
const denied=await inventoryEasyOrdersWorkers({accountId,token,fetcher});
assert.equal(denied.passesMetadataGate,false);
assert.equal(denied.checks.allMetadataRead,false);
assert.equal(JSON.stringify(denied).includes('DO_NOT_PRINT_PRIVATE_PROVIDER_PASSWORD'),false);
await assert.rejects(inventoryEasyOrdersWorkers({accountId:'invalid',token,fetcher}),/ID missing or invalid/);
await assert.rejects(inventoryEasyOrdersWorkers({accountId,token:'',fetcher}),/API token unavailable/);
console.log('Easy Orders Cloudflare scheduler metadata inspector OFFLINE TEST PASS: GET only, expected cron/RPC, denied metadata gate, no secrets or D1 IDs. No Cloudflare calls.');
