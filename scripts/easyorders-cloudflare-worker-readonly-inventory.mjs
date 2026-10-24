/* ONE-SHOT PREVIEW-ENVIRONMENT WORKER METADATA INVENTORY.
 * ALL Cloudflare calls use the fixed public API host and HTTP GET. NO D1,
 * order/customer payload, Workers invoke, provider call or state mutations.
 * Cloudflare API token is accepted ONLY via environment variable, never
 * printed, stored, echoed or embedded in URLs. The output omits secrets,
 * plaintext bindings and D1 IDs by construction.
 */
const NAMES=Object.freeze(['kunonline-sync-preview','kunonline-preview','kunonline']);
const KEYS=Object.freeze(['schedules','settings','deployments']);
const CRONS=Object.freeze(['*/5 * * * *','*/15 * * * *','0 */2 * * *']);
const BINDINGS=new Set(['APP_SYNC','PREVIEW_APP','PREVIEW_DB','DB']);
const strings=xs=>Array.isArray(xs)?xs.filter(x=>typeof x==='string'):[];
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const takeBindings=payload=>{
  const settings=obj(payload?.result);
  const rows=settings.bindings||obj(settings.settings).bindings||[];
  return (Array.isArray(rows)?rows:[])
    .filter(x=>BINDINGS.has(x?.name||x?.binding))
    .map(x=>({
      name:String(x.name||x.binding),
      type:String(x.type||'unknown'),
      service:x.type==='service'?String(x.service||''):'',
      entrypoint:x.type==='service'?String(x.entrypoint||''):''
    }));
};
const takeSchedules=payload=>{
  const r=obj(payload?.result);
  return (Array.isArray(r.schedules)?r.schedules:[])
    .map(x=>String(x?.cron||'')).filter(Boolean).sort();
};
const takeVersion=payload=>{
  const records=obj(payload?.result);
  const arr=Array.isArray(records.deployments)?records.deployments:[];
  const latest=obj(arr[0]);
  const versions=Array.isArray(latest.versions)?latest.versions:[];
  return {deployed:arr.length>0,
    newestVersionIds:versions.map(x=>String(x?.version_id||x?.id||'')).filter(Boolean).slice(0,2)};
};

export async function inventoryEasyOrdersWorkers({accountId,token,fetcher=fetch}={}){
  if(!/^[a-f0-9]{32}$/i.test(accountId||''))throw Error('Cloudflare account ID missing or invalid');
  if(typeof token!=='string'||!token)throw Error('Cloudflare API token unavailable');
  if(typeof fetcher!=='function')throw Error('GET-only fetcher required');
  const results={},httpChecks=[];
  for(const name of NAMES){
    results[name]={};
    for(const kind of KEYS){
      const root='https://api.cloudflare.com/client/v4/accounts/'+accountId+
        '/workers/scripts/'+name+'/'+kind;
      const response=await fetcher(root,{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}
      });
      let payload=null;
      if(response.ok){try{payload=await response.json();}catch{}}
      httpChecks.push({worker:name,kind,httpStatus:response.status,
        success:response.ok&&payload?.success===true});
      if(response.ok&&payload?.success===true){
        if(kind==='schedules')results[name].crons=takeSchedules(payload);
        if(kind==='settings')results[name].bindings=takeBindings(payload);
        if(kind==='deployments')results[name].deployment=takeVersion(payload);
      }
    }
  }
  const scheduler=results['kunonline-sync-preview'],preview=results['kunonline-preview'],production=results.kunonline;
  const cronFound=Array.isArray(scheduler.crons)&&CRONS.every(x=>scheduler.crons.includes(x));
  const rpcBinding=Array.isArray(scheduler.bindings)&&scheduler.bindings.some(x=>
    x.name==='APP_SYNC'&&x.type==='service'&&x.service==='kunonline-preview'&&x.entrypoint==='SyncEntrypoint');
  const previewOwnsNoCron=Array.isArray(preview.crons)&&preview.crons.length===0;
  const prodToPreview=Array.isArray(production.bindings)&&production.bindings.some(x=>
    x.name==='PREVIEW_APP'&&x.type==='service'&&x.service==='kunonline-preview');
  const prodD1Bound=Array.isArray(production.bindings)&&production.bindings.some(x=>
    x.name==='PREVIEW_DB'&&x.type==='d1');
  const allMetadataRead=httpChecks.every(x=>x.success);
  const checks={allMetadataRead,cronFound,rpcBinding,previewOwnsNoCron,prodToPreview,prodD1Bound};
  return {kind:'CLOUDFLARE_READ_ONLY_WORKER_METADATA',
    testedAt:new Date().toISOString(),checks,
    passesMetadataGate:Object.values(checks).every(Boolean),
    // Never print raw Cloudflare responses: they can contain secret text,
    // D1 UUIDs, account IDs or provider binding values.
    workers:results,httpChecks,
    liveCronExecutionProven:false,
    liveOrdersRead:false,
    liveD1Read:false,
    wroteCloudflareData:false};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await inventoryEasyOrdersWorkers({
      accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
      token:process.env.CLOUDFLARE_API_TOKEN
    });
    console.log(JSON.stringify(result,null,2));
    if(!result.passesMetadataGate)process.exitCode=1;
  }catch(error){
    // Do not render a Cloudflare response body or URL with credentials.
    console.error(JSON.stringify({ok:false,code:'READ_ONLY_METADATA_UNAVAILABLE',
      category:error?.name||'Error',liveDataRead:false,cloudflareMutated:false}));
    process.exitCode=1;
  }
}
