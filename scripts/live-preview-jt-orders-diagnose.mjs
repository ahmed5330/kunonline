import {readFile} from 'node:fs/promises';

const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Cloudflare Preview credentials are required');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
async function d1(sql,params=[]){
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({})),result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 read-only query failed ${response.status}: ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);
  return result?.results||[];
}
const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const parse=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
const counts=(await d1(`SELECT COUNT(*) total_orders,
 SUM(CASE WHEN COALESCE(TRIM(awb),'')<>'' THEN 1 ELSE 0 END) orders_with_awb,
 SUM(CASE WHEN history LIKE '%jt_shipment_created%' THEN 1 ELSE 0 END) jt_created_events,
 SUM(CASE WHEN history LIKE '%jt_label_printed%' THEN 1 ELSE 0 END) jt_printed_events
 FROM orders`))[0]||{};
console.log('JT_ORDERS counts',JSON.stringify(counts));
const rows=await d1(`SELECT id,client_id,store_id,ref,state,awb,source,created_at,history
 FROM orders
 WHERE COALESCE(TRIM(awb),'')<>'' OR history LIKE '%jt_shipment_created%'
 ORDER BY created_at DESC LIMIT 30`);
console.log(`JT_ORDERS rows=${rows.length}`);
for(const row of rows){
  const history=parse(row.history),events=history.filter(x=>/^jt_/i.test(clean(x?.type,100)));
  console.log('JT_ORDERS order',JSON.stringify({id:row.id,clientId:row.client_id,storeId:row.store_id||null,ref:clean(row.ref,120),state:row.state,awb:clean(row.awb,160),source:clean(row.source,100),createdAt:row.created_at||null,jtEvents:events.map(e=>({type:clean(e.type,100),awb:clean(e.awb,160),txlogisticId:clean(e.txlogisticId,160),sortingCode:clean(e.sortingCode,160),at:e.at||null,qa:Boolean(e.qa)}))}));
}
console.log('JT_ORDERS complete read_only=true');
