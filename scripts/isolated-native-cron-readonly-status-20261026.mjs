// Fixed existing QA resources only. GET metadata and one SELECT; no invoke/deploy.
const run='40274370734',app=`kunonline-isolated-qa-${run}`,scheduler=`kunonline-isolated-qa-sync-${run}`;
const sql='SELECT config_json FROM store_connections WHERE id=? AND client_id=? AND external_store_id=?';
async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('QA_STATUS_RUNTIME_UNAVAILABLE');
 let database;
 async function api(method,path,body){
  const allowedGet=[`workers/scripts/${app}/settings`,`workers/scripts/${scheduler}/settings`,`workers/scripts/${scheduler}/schedules`];
  if(!(method==='GET'&&allowedGet.includes(path))&&!(method==='POST'&&database&&path===`d1/database/${database}/query`&&body?.sql===sql&&JSON.stringify(body.params)===JSON.stringify([`CON-QA-EASYORDERS-${run}`,'QA-SYNTHETIC-TENANT','EO-SYNTHETIC-QA'])))throw Error('QA_STATUS_MUTATION_FORBIDDEN');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok||data.success!==true)throw Error('QA_STATUS_METADATA_UNAVAILABLE');return data.result;
 }
 const settings=await api('GET',`workers/scripts/${app}/settings`),bindings=settings.bindings||[],db=bindings.filter(x=>x.type==='d1');
 if(db.length!==1||db[0].name!=='DB'||bindings.some(x=>x.type==='service')||['31cd5cdf-fc01-42d7-ba1e-571f3dd58495','c426601d-182f-486e-a5c1-bb1bca0ecb0b'].includes(db[0].id)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db[0].id||''))throw Error('QA_STATUS_APP_NOT_ISOLATED');database=db[0].id;
 const identity=await fetch(`https://${app}.mr-a-mnaa.workers.dev/__qa/identity`,{redirect:'error',signal:AbortSignal.timeout(15000)}).then(r=>r.json());
 if(identity.syntheticOnly!==true||identity.sourceSha!=='9f39190bf882f2302d3ccf0a477676f771f076b8')throw Error('QA_STATUS_SOURCE_CHANGED');
 const sb=(await api('GET',`workers/scripts/${scheduler}/settings`)).bindings||[],services=sb.filter(x=>x.type==='service');
 const serviceBindingVerified=services.length===1&&services[0].name==='APP_SYNC'&&services[0].service===app&&services[0].entrypoint==='SyncEntrypoint'&&!sb.some(x=>x.type==='d1');
 const schedules=(await api('GET',`workers/scripts/${scheduler}/schedules`)).schedules||[];
 const result=await api('POST',`d1/database/${database}/query`,{sql,params:[`CON-QA-EASYORDERS-${run}`,'QA-SYNTHETIC-TENANT','EO-SYNTHETIC-QA']});
 const cfg=JSON.parse(result?.[0]?.results?.[0]?.config_json||'null');if(cfg?.qaSynthetic!==true)throw Error('QA_STATUS_FIXTURE_CHANGED');
 const cronAt=cfg.easyOrdersRecoveryLastCronAt||null;if(cronAt!==null&&!/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(cronAt))throw Error('QA_STATUS_RECEIPT_INVALID');
 console.log(JSON.stringify({kind:'EXISTING_ISOLATED_NATIVE_CRON_READONLY_STATUS',testedAt:new Date().toISOString(),qaSourceSha:identity.sourceSha,serviceBindingVerified,schedules:schedules.map(x=>x.cron),lastCronAt:cronAt,recoveryStatus:String(cfg.easyOrdersRecoveryLastStatus||''),recoveryErrorPresent:!!cfg.easyOrdersRecoveryLastError,syntheticOnly:true,invokedCron:false,cloudflareMutated:false,customerRowsModified:false,qaRowsModified:false}));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(e?.message||'')?e.message:'QA_STATUS_FAILED',cloudflareMutated:false,customerRowsModified:false}));process.exitCode=1;});
