import {createHash} from 'node:crypto';
const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex');
const sourceId='31cd5cdf-fc01-42d7-ba1e-571f3dd58495';

export function candidateConnections(stores,connections){
  const map=new Map(stores.map(row=>[String(row.id),row]));
  return connections.filter(row=>{
    const store=map.get(String(row.config_store_id||''));
    return store&&String(store.client_id)===String(row.client_id);
  });
}
export function summarizeCandidate(row,orders){
  const external=String(row.external_store_id||'');
  return {clientFingerprint:fingerprint(row.client_id),storeFingerprint:fingerprint(row.config_store_id),
    connectionFingerprint:fingerprint(row.id),status:row.status,
    externalStoreBound:!!external&&external!==row.id&&!/^CON-/i.test(external),
    externalStoreFingerprint:external?fingerprint(external):null,
    encryptedApiKeyPresent:Number(row.key_count)>0,lastErrorPresent:Number(row.last_error_present)>0,
    storedRecoveryHighestShortId:Number(row.highest)||0,storedRecoveryCursor:Number(row.cursor)||0,
    sourceOrderCount:Number(orders?.total)||0,ordersSince20261023:Number(orders?.recent)||0,
    upstreamIdentityVerified:false,providerAuditExecuted:false,missingOrderCount:null,realOrdersRecovered:0};
}

async function main(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw new Error('SCOPE_RUNTIME_UNAVAILABLE');
  async function request(method,path,body){
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{
      method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.success!==true)throw new Error(`SCOPE_HTTP_${response.status}`);
    return payload.result;
  }
  const settings=await request('GET','workers/scripts/kunonline-preview/settings');
  if(!(settings.bindings||[]).some(x=>x.type==='d1'&&x.name==='DB'&&x.id===sourceId))throw new Error('SCOPE_SOURCE_BINDING_CHANGED');
  async function select(sql,params=[]){
    if(!/^SELECT\b/.test(sql)||/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i.test(sql))throw new Error('SCOPE_SQL_NOT_READONLY');
    const result=await request('POST',`d1/database/${sourceId}/query`,{sql,params});
    if(result?.some(x=>x.success===false))throw new Error('SCOPE_SELECT_FAILED');
    return result?.[0]?.results||[];
  }
  const labels=['%وفاق%','%wefaq%','%wifaq%'];
  const legacy=await select(`SELECT json_extract(c.value,'$.id') AS id FROM state s,
    json_each(CASE WHEN json_valid(s.json) THEN s.json ELSE '{"clients":[]}' END,'$.clients') c
    WHERE s.id=1 AND (json_extract(c.value,'$.name') LIKE ? OR json_extract(c.value,'$.name') LIKE ? OR json_extract(c.value,'$.name') LIKE ?)`,labels);
  const clients=legacy.map(x=>String(x.id||'')).filter(Boolean);
  const stores=await select(`SELECT id,client_id FROM stores WHERE name LIKE ? OR name LIKE ? OR name LIKE ?${clients.length?' OR client_id IN ('+clients.map(()=>'?').join(',')+')':''}`,[...labels,...clients]);
  if(!stores.length){console.log(JSON.stringify({kind:'WEFAQ_READONLY_SCOPE_METADATA',matchingStoreCount:0,metadataScopeUnambiguous:false,providerAuditExecuted:false,customerRowsModified:false}));return;}
  const ids=[...new Set(stores.map(x=>String(x.client_id)))];
  const connections=await select(`SELECT c.id,c.client_id,c.external_store_id,c.status,
    CASE WHEN json_valid(c.config_json) THEN COALESCE(json_extract(c.config_json,'$.kunStoreId'),json_extract(c.config_json,'$.storeId')) END AS config_store_id,
    CASE WHEN json_valid(c.config_json) THEN json_extract(c.config_json,'$.easyOrdersRecoveryHighestShortId') END AS highest,
    CASE WHEN json_valid(c.config_json) THEN json_extract(c.config_json,'$.easyOrdersRecoveryCursor') END AS cursor,
    CASE WHEN COALESCE(TRIM(c.last_error),'')<>'' THEN 1 ELSE 0 END AS last_error_present,
    (SELECT COUNT(*) FROM integration_secrets k WHERE k.connection_id=c.id AND k.client_id=c.client_id AND k.secret_name='api_key' AND LENGTH(k.ciphertext_b64)>0 AND LENGTH(k.iv_b64)>0) AS key_count
    FROM store_connections c WHERE c.provider='easyorders' AND c.client_id IN (${ids.map(()=>'?').join(',')})`,ids);
  const candidates=candidateConnections(stores,connections),reports=[];
  for(const row of candidates){
    const orders=await select("SELECT COUNT(*) AS total,SUM(CASE WHEN date>='2026-10-23' THEN 1 ELSE 0 END) AS recent FROM orders WHERE client_id=? AND store_id=?",[row.client_id,row.config_store_id]);
    reports.push(summarizeCandidate(row,orders[0]));
  }
  console.log(JSON.stringify({kind:'WEFAQ_READONLY_SCOPE_METADATA',testedAt:new Date().toISOString(),sourceDatabaseFingerprint:fingerprint(sourceId),
    matchingStoreCount:stores.length,matchingConnectionCount:candidates.length,metadataScopeUnambiguous:candidates.length===1,
    candidates:reports,customerPayloadsRead:false,providerSecretsRead:false,providerAuditExecuted:false,customerRowsModified:false},null,2));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
  main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'SCOPE_INVENTORY_FAILED',customerRowsModified:false}));process.exitCode=1;});
