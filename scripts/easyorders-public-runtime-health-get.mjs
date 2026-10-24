/* Public, unauthenticated and read-only Easy Orders deployment health.
 * Exactly THREE HTTPS GET probes to existing documented public endpoints.
 * No credentials/cookies, no D1/Worker writes, provider calls, webhook POST
 * or customer/order data. Never print raw response bodies, internal errors
 * or user identifiers. A 200 healthz cannot prove Cron ever ran.
 */
const TARGETS=Object.freeze([
 {key:'scheduler',url:'https://kunonline-sync-preview.mr-a-mnaa.workers.dev/healthz'},
 {key:'preview',url:'https://kunonline-preview.mr-a-mnaa.workers.dev/api/preview/version'},
 {key:'production',url:'https://app.kun-online.com/health/easyorders-sync'}
]);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const short=v=>String(v??'').slice(0,90);
const integer=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null};
export async function inspectPublicEasyOrdersRuntime({fetcher=fetch}={}){
 if(typeof fetcher!=='function')throw Error('GET fetcher missing');
 const checks={};
 for(const target of TARGETS){
  const row={httpStatus:null,reachable:false};
  checks[target.key]=row;
  try{
   const response=await fetcher(target.url,{
    method:'GET',redirect:'error',credentials:'omit',
    headers:{Accept:'application/json','Cache-Control':'no-cache'},
    signal:AbortSignal.timeout(12000)
   });
   row.httpStatus=response.status;
   if(!response.ok)continue;
   let data;
   try{data=obj(await response.json());}catch{continue;}
   row.reachable=true;
   if(target.key==='scheduler'){
    row.service=short(data.service);
    row.build=short(data.build);
    row.upstreamHealthResponded=data.upstream?.ok===true;
    row.recoveryCronAdvertised=data.policy?.easyOrdersRecovery==='every-5-minutes';
    // An RPC health response is NOT proof that the five-minute Cron fires.
    row.cronExecutionProven=false;
   }else if(target.key==='preview'){
    row.build=short(data.build);
    row.entrypoint=short(data.entrypoint);
    row.appEnv=short(data.environment);
   }else{
    row.status=short(data.status);
    row.dataSource=short(data.source);
    row.failureCode=short(data.runtimeDiagnostics?.failureCode);
    row.connectedIntegrations=integer(data.canonical?.connections);
    row.staleRecoveryConnections=integer(data.runtimeDiagnostics?.staleRecoveryConnections);
    row.neverRanRecoveryConnections=integer(data.runtimeDiagnostics?.neverRanRecoveryConnections);
    row.staleAfterMinutes=integer(data.runtimeDiagnostics?.staleAfterMinutes);
   }
  }catch{
   // Avoid emitting native fetch exceptions; they can include unexpected
   // proxy/network configuration values. Emit only the safe marker below.
   row.networkFailure=true;
  }
 }
 return {kind:'KUN_PUBLIC_HEALTH_GET_ONLY',checkedAt:new Date().toISOString(),
  noAuthentication:true,noCustomerRows:true,noLiveWrites:true,
  checks,allPublicEndpointsReachable:Object.values(checks).every(x=>x.reachable)};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=await inspectPublicEasyOrdersRuntime();
 console.log(JSON.stringify(result,null,2));
 if(!result.allPublicEndpointsReachable)process.exitCode=1;
}
