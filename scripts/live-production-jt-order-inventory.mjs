import {readFile} from 'node:fs/promises';

const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Cloudflare Production credentials are required');
const config=await readFile(new URL('../wrangler.production.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Production database_id missing');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
async function d1(sql,params=[]){
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({})),result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`D1 read-only query failed ${response.status}: ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);
  return result?.results||[];
}
function parseHistory(value){try{const x=JSON.parse(value||'[]');return Array.isArray(x)?x:[];}catch{return [];}}
function clean(value,max=220){return String(value??'').trim().slice(0,max);}

const counts=(await d1(`SELECT COUNT(*) AS total_orders,
  SUM(CASE WHEN COALESCE(TRIM(awb),'')<>'' THEN 1 ELSE 0 END) AS orders_with_awb,
  SUM(CASE WHEN COALESCE(TRIM(awb),'')<>'' AND history LIKE '%jt_shipment_created%' THEN 1 ELSE 0 END) AS awb_with_jt_created_history
  FROM orders`))[0]||{};
console.log('JT_PROD_INVENTORY counts',JSON.stringify(counts));

const awbRows=await d1(`SELECT id,client_id,store_id,state,awb,created_at,history
  FROM orders
  WHERE COALESCE(TRIM(awb),'')<>''
  ORDER BY created_at DESC
  LIMIT 50`);
console.log(`JT_PROD_INVENTORY awb_rows=${awbRows.length}`);
for(const row of awbRows){
  const history=parseHistory(row.history),types=history.map(x=>clean(x?.type,100)).filter(Boolean),jt=[...history].reverse().find(x=>/^jt_/i.test(clean(x?.type,100)))||null;
  console.log('JT_PROD_INVENTORY order',JSON.stringify({id:row.id,clientId:row.client_id,storeId:row.store_id||null,state:row.state,awb:clean(row.awb,160),createdAt:row.created_at||null,historyCount:history.length,historyTypes:[...new Set(types)].slice(-20),latestJtEvent:jt?{type:clean(jt.type,100),awb:clean(jt.awb,160),txlogisticId:clean(jt.txlogisticId,160),at:jt.at||null}:null}));
}

const connections=await d1(`SELECT id,client_id,store_name,status,external_store_id,last_error,created_at,updated_at
  FROM store_connections WHERE provider='jt' ORDER BY updated_at DESC`);
console.log(`JT_PROD_INVENTORY connections=${connections.length}`);
for(const row of connections){
  const secretNames=(await d1('SELECT secret_name FROM integration_secrets WHERE client_id=? AND connection_id=? ORDER BY secret_name',[row.client_id,row.id])).map(x=>x.secret_name);
  console.log('JT_PROD_INVENTORY connection',JSON.stringify({id:row.id,clientId:row.client_id,storeName:row.store_name||null,status:row.status,externalStoreId:row.external_store_id||null,lastError:row.last_error||null,createdAt:row.created_at||null,updatedAt:row.updated_at||null,secretNames}));
}

console.log('JT_PROD_INVENTORY complete read_only=true');
