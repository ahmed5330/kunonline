import {auditEasyOrdersStoreGapRange} from './easyorders-store-gap-audit.js';
const clean=value=>String(value??'').trim();
const failure=code=>Object.assign(new Error(code),{code});
export function readonlyAuditDatabase(database){
  const statementView=statement=>Object.freeze({
    bind:(...values)=>statementView(statement.bind(...values)),
    first:(...values)=>statement.first(...values),
    all:(...values)=>statement.all(...values)
  });
  return Object.freeze({prepare(sql){
    if(typeof sql!=='string'||!/^\s*SELECT\b/i.test(sql)||/;|--|\/\*|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH)\b/i.test(sql))
      throw failure('READONLY_AUDIT_SQL_REJECTED');
    return statementView(database.prepare(sql));
  }});
}
export async function auditEasyOrdersReadOnlyRpc(env,input={},dependencies={}){
  const output={ok:false,mode:'read_only',dbWritesAllowed:false,recoveryPerformed:false,
    status:'invalid_request',requests:0,alreadyInKun:0,missingInKun:0,missingAtProvider:0,
    ambiguousLegacyOrders:0,foreignStoreSkipped:0,checkedShortIds:[],presentShortIds:[],
    missingShortIds:[],providerMissingShortIds:[],unconfirmedShortIds:[],ambiguousShortIds:[],httpStatusCounts:{},
    providerCreatedDays:{oldest:null,newest:null,datedOrders:0}};
  try{
    const clientId=clean(input.clientId),storeId=clean(input.storeId),connectionId=clean(input.connectionId);
    const start=Number(input.fromShortId),end=Number(input.toShortId);
    if(!clientId||!storeId||!connectionId||!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(end)||end<start||end-start>=10)
      throw failure('READONLY_AUDIT_SCOPE_OR_RANGE_INVALID');
    output.startShortId=start;output.endShortId=end;
    const database=readonlyAuditDatabase(env.DB);
    const readonlyEnv=new Proxy(env,{get:(target,key,receiver)=>key==='DB'?database:Reflect.get(target,key,receiver)});
    const fetcher=dependencies.fetcher||fetch;
    for(let id=start;id<=end;id++){
      let httpStatus=null;
      const boundedGet=async(url,init)=>{
        if(url!==`https://api.easy-orders.net/api/v1/external-apps/orders/short/${id}`||init?.method!=='GET')
          throw failure('READONLY_AUDIT_HTTP_REJECTED');
        const response=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)});
        httpStatus=response.status;
        output.httpStatusCounts[httpStatus]=(output.httpStatusCounts[httpStatus]||0)+1;
        return response;
      };
      const result=await auditEasyOrdersStoreGapRange(readonlyEnv,{clientId,storeId,connectionId,
        fromShortId:id,toShortId:id,fetcher:boundedGet,...(dependencies.readSecrets?{readSecrets:dependencies.readSecrets}:{})});
      output.requests+=result.requests;
      output.checkedShortIds.push(id);
      output.alreadyInKun+=result.alreadyInKun;output.missingInKun+=result.missingInKun;
      output.missingAtProvider+=result.missingAtProvider;output.ambiguousLegacyOrders+=result.ambiguousLegacyOrders;
      output.foreignStoreSkipped+=result.foreignStoreSkipped;
      const dates=result.providerCreatedDays;
      if(dates?.datedOrders){
        const summary=output.providerCreatedDays;summary.datedOrders+=dates.datedOrders;
        if(!summary.oldest||dates.oldest<summary.oldest)summary.oldest=dates.oldest;
        if(!summary.newest||dates.newest>summary.newest)summary.newest=dates.newest;
      }
      if(result.alreadyInKun)output.presentShortIds.push(id);
      if(result.missingInKun)output.missingShortIds.push(id);
      if(result.missingAtProvider)output.providerMissingShortIds.push(id);
      if(result.ambiguousLegacyOrders)output.ambiguousShortIds.push(id);
      if(result.foreignStoreSkipped){output.status='provider_store_mismatch';return output;}
      if(!result.ok){
        output.unconfirmedShortIds.push(id);
        // Continuing a READ-ONLY comparison never advances the recovery cursor
        // and never treats a 400 as absence. Other failures stop the batch.
        if(httpStatus===400)continue;
        output.status=['rate_limited','provider_forbidden','provider_error','provider_network_error','provider_payload_invalid','provider_short_id_mismatch'].includes(result.status)?result.status:'audit_failed';
        return output;
      }
    }
    output.ok=output.unconfirmedShortIds.length===0&&output.ambiguousLegacyOrders===0;
    output.status=output.ok?'complete':'complete_with_unconfirmed';
    return output;
  }catch(error){
    output.status='audit_failed';
    output.code=/^(?:EASYORDERS_AUDIT_|READONLY_AUDIT_)[A-Z0-9_]+$/.test(error?.code||'')?error.code:'READONLY_AUDIT_FAILED';
    return output;
  }
}
