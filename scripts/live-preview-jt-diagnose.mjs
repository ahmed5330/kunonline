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
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`D1 query failed ${response.status}: ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);
  return result?.results||[];
}
const rows=await d1("SELECT id,client_id,store_name,status,external_store_id,last_error,created_at,updated_at FROM store_connections WHERE provider='jt' ORDER BY CASE WHEN COALESCE(TRIM(last_error),'')<>'' THEN 0 ELSE 1 END, updated_at DESC");
if(!rows.length){console.log('JT_DIAG no J&T connections found in Preview');process.exit(0);}
console.log(`JT_DIAG connections=${rows.length}`);
for(const row of rows){
  const names=(await d1('SELECT secret_name FROM integration_secrets WHERE client_id=? AND connection_id=? ORDER BY secret_name',[row.client_id,row.id])).map(x=>x.secret_name);
  const stores=await d1('SELECT id,name FROM stores WHERE client_id=? ORDER BY created_at LIMIT 5',[row.client_id]);
  console.log('JT_DIAG connection',JSON.stringify({id:row.id,clientId:row.client_id,storeName:row.store_name,status:row.status,externalStoreId:row.external_store_id,lastError:row.last_error||null,createdAt:row.created_at,updatedAt:row.updated_at,secretNames:names,stores}));
}
