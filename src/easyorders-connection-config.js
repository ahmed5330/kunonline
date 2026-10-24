// Optimistic, tenant-scoped Easy Orders config changes. Webhooks, recovery
// cron and diagnostics update the SAME config_json and must never clobber
// each other's last order/cursor by writing a stale whole JSON snapshot.
const text=value=>String(value??'').trim();
const parse=value=>{try{const parsed=JSON.parse(value||'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}}catch{return {}}};
const positiveInt=value=>{const n=Math.floor(Number(value));return Number.isSafeInteger(n)&&n>0?n:0};
const stop=(code,message)=>Object.assign(new Error(message),{status:409,code});
export function mergeEasyOrdersRecoveryPatch(current={},patch={}){
  const next={...current,...patch};
  // The ahead-probe can move past an HTTP 404 only when that unresolved Short
  // ID is durably queued for eventual retry. Apply queue additions/removals
  // against the *fresh* CAS value, never a stale scheduler snapshot.
  if(Object.hasOwn(patch,'easyOrdersRecoveryPendingAdd')||
      Object.hasOwn(patch,'easyOrdersRecoveryPendingRemove')){
    const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):0;
    const saved=Array.isArray(current.easyOrdersRecoveryPendingShortIds)
      ?current.easyOrdersRecoveryPendingShortIds:[];
    const added=Array.isArray(patch.easyOrdersRecoveryPendingAdd)
      ?patch.easyOrdersRecoveryPendingAdd:[];
    const removed=new Set((Array.isArray(patch.easyOrdersRecoveryPendingRemove)
      ?patch.easyOrdersRecoveryPendingRemove:[]).map(positive));
    const pending=[...new Set([...saved,...added].map(positive).filter(v=>v&&!removed.has(v)))]
      .sort((a,b)=>a-b);
    if(pending.length>120)throw stop('EASYORDERS_PENDING_QUEUE_FULL',
      'Easy Orders unresolved ahead queue reached the safe limit');
    next.easyOrdersRecoveryPendingShortIds=pending;
    delete next.easyOrdersRecoveryPendingAdd;
    delete next.easyOrdersRecoveryPendingRemove;
  }
  for(const field of ['webhookLastShortId','easyOrdersRecoveryHighestShortId','easyOrdersRecoveryCursor','easyOrdersRecoveryProbeCursor','easyOrdersRecoveryRecoveredCount']){
    if(Object.hasOwn(patch,field)){
      next[field]=Math.max(positiveInt(current[field]),positiveInt(patch[field]));
    }
  }
  const highest=Math.max(positiveInt(next.webhookLastShortId),positiveInt(next.easyOrdersRecoveryHighestShortId));
  if(highest>0)next.easyOrdersRecoveryHighestShortId=highest;
  if(next.easyOrdersRecoveryLastStatus==='healthy'&&positiveInt(next.easyOrdersRecoveryCursor)<=highest)
    next.easyOrdersRecoveryLastStatus='catching_up';
  return next;
}
export async function mutateEasyOrdersConfig(env,connection,mutate,{lastError}={}){
  const id=text(connection?.id),clientId=text(connection?.client_id);
  if(!id||!clientId||!env?.DB?.prepare)throw stop('EASYORDERS_CONFIG_SCOPE_INVALID','Easy Orders connection scope missing');
  for(let attempt=0;attempt<8;attempt++){
    const fresh=await env.DB.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=? AND status=?')
      .bind(id,clientId,'connected').first();
    if(!fresh)throw stop('EASYORDERS_CONNECTION_NOT_FOUND','Easy Orders connection not connected');
    const next=mutate(parse(fresh.config_json));
    if(!next||typeof next!=='object'||Array.isArray(next))
      throw stop('EASYORDERS_CONFIG_PATCH_INVALID','Invalid Easy Orders sync patch');
    const json=JSON.stringify(next),ts=new Date().toISOString();
    const sql=lastError===undefined
      ? 'UPDATE store_connections SET config_json=?,updated_at=? WHERE id=? AND client_id=? AND status=? AND config_json IS ?'
      : 'UPDATE store_connections SET config_json=?,last_error=?,updated_at=? WHERE id=? AND client_id=? AND status=? AND config_json IS ?';
    const args=lastError===undefined?[json,ts,id,clientId,'connected',fresh.config_json??null]:
      [json,lastError,ts,id,clientId,'connected',fresh.config_json??null];
    const result=await env.DB.prepare(sql).bind(...args).run();
    if(result?.success===false)throw stop('EASYORDERS_CONFIG_WRITE_FAILED','Easy Orders sync checkpoint update failed');
    if(result?.meta?.changes===1){
      connection.config_json=json;
      return next;
    }
    if(result?.meta?.changes===0)continue;
    // An adapter without D1's changes receipt cannot attest a conditional
    // update. Read back instead; never declare success on an unknown write.
    const after=await env.DB.prepare('SELECT config_json FROM store_connections WHERE id=? AND client_id=? AND status=?')
      .bind(id,clientId,'connected').first();
    if(after?.config_json===json){connection.config_json=json;return next;}
  }
  throw stop('EASYORDERS_CONFIG_CONCURRENT_UPDATE','Easy Orders checkpoint changed concurrently; retry');
}
