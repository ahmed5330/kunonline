import {decryptSecret} from './integration-secrets.js';

const TABLES=['clients','users','stores','orders','customers','products','store_connections','integration_secrets','campaign_daily_metrics','meta_ad_entities','meta_ad_daily_metrics'];
const TARGET_USER_EMAIL_HASH='f0098ef5258eb658';
const SAFE_NAME=/^[A-Za-z_][A-Za-z0-9_]*$/;

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0'}});}
async function tableExists(db,name){if(!db)return false;const row=await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(name).first().catch(()=>null);return !!row;}
async function columnsAny(db,name){if(!SAFE_NAME.test(String(name||''))||!(await tableExists(db,name)))return [];const out=await db.prepare(`PRAGMA table_info('${name}')`).all().catch(()=>({results:[]}));return (out.results||[]).map(row=>String(row.name||'')).filter(Boolean);}
async function columns(db,name){if(!TABLES.includes(name))return [];return columnsAny(db,name);}
async function countTable(db,name){if(!TABLES.includes(name)||!(await tableExists(db,name)))return null;const row=await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first().catch(()=>null);return row?Number(row.n||0):null;}

async function groupedIntegrationMetadata(db){
  const result={storeConnections:[],secretKeys:[]};
  if(await tableExists(db,'store_connections')){
    const cols=await columns(db,'store_connections');const provider=cols.includes('provider')?'provider':cols.includes('type')?'type':null;const status=cols.includes('status')?'status':null;
    if(provider){const statusExpr=status?`, ${status} AS status`:`, '' AS status`;const group=status?`, ${status}`:'';const out=await db.prepare(`SELECT ${provider} AS provider${statusExpr}, COUNT(*) AS n FROM store_connections GROUP BY ${provider}${group} ORDER BY ${provider}${group}`).all().catch(()=>({results:[]}));result.storeConnections=(out.results||[]).map(row=>({provider:String(row.provider||''),status:String(row.status||''),count:Number(row.n||0)}));}
  }
  if(await tableExists(db,'integration_secrets')){
    const cols=await columns(db,'integration_secrets');
    if(cols.includes('connection_id')&&cols.includes('secret_name')&&await tableExists(db,'store_connections')){const out=await db.prepare("SELECT COALESCE(c.provider,'') AS provider,s.secret_name AS secret_name,COUNT(*) AS n FROM integration_secrets s LEFT JOIN store_connections c ON c.id=s.connection_id GROUP BY c.provider,s.secret_name ORDER BY c.provider,s.secret_name").all().catch(()=>({results:[]}));result.secretKeys=(out.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.secret_name||''),count:Number(row.n||0)}));}
    else if(cols.includes('provider')&&cols.includes('key_name')){const out=await db.prepare('SELECT provider,key_name,COUNT(*) AS n FROM integration_secrets GROUP BY provider,key_name ORDER BY provider,key_name').all().catch(()=>({results:[]}));result.secretKeys=(out.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.key_name||''),count:Number(row.n||0)}));}
  }
  return result;
}

async function digest(value){const bytes=new TextEncoder().encode(String(value||''));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);}
async function idFingerprints(db,table){if(!['clients','stores'].includes(table)||!(await tableExists(db,table)))return [];const cols=await columns(db,table);if(!cols.includes('id'))return [];const out=await db.prepare(`SELECT id FROM ${table} ORDER BY id LIMIT 250`).all().catch(()=>({results:[]}));const values=[];for(const row of out.results||[])values.push(await digest(`${table}:${row.id}`));return values.sort();}

async function resolveTargetIds(db){
  if(!(await tableExists(db,'users')))return null;const userCols=await columnsAny(db,'users');if(!userCols.includes('email'))return null;
  const fields=['id','email'];for(const name of ['client_id','role','store_id'])if(userCols.includes(name))fields.push(name);
  const out=await db.prepare(`SELECT ${fields.join(',')} FROM users`).all().catch(()=>({results:[]}));let user=null;
  for(const row of out.results||[]){if(await digest(`user-email:${String(row.email||'').trim().toLowerCase()}`)===TARGET_USER_EMAIL_HASH){user=row;break;}}
  if(!user)return null;const clientId=user.client_id==null?'':String(user.client_id);let storeId='';
  if(clientId&&await tableExists(db,'stores')){const storeCols=await columnsAny(db,'stores');if(storeCols.includes('client_id')&&storeCols.includes('id')){const store=await db.prepare('SELECT id FROM stores WHERE client_id=? ORDER BY is_default DESC,id LIMIT 1').bind(clientId).first().catch(()=>null);if(store)storeId=String(store.id||'');}}
  return {user,clientId,storeId};
}

async function targetTenant(db){
  const ids=await resolveTargetIds(db);if(!ids)return {found:false};const {user,clientId}=ids;
  const result={found:true,userIdHash:await digest(`user-id:${user.id}`),clientIdHash:clientId?await digest(`client-id:${clientId}`):'',role:String(user.role||''),stores:[],connections:[],secretKeys:[]};
  if(clientId&&await tableExists(db,'stores')){const storeCols=await columnsAny(db,'stores');if(storeCols.includes('client_id')&&storeCols.includes('id')){const fields=['id'];for(const name of ['name','domain','platform','status'])if(storeCols.includes(name))fields.push(name);const stores=await db.prepare(`SELECT ${fields.join(',')} FROM stores WHERE client_id=? ORDER BY id`).bind(clientId).all().catch(()=>({results:[]}));for(const store of stores.results||[])result.stores.push({idHash:await digest(`store-id:${store.id}`),nameHash:store.name?await digest(`store-name:${String(store.name).trim().toLowerCase()}`):'',domainHash:store.domain?await digest(`store-domain:${String(store.domain).trim().toLowerCase()}`):'',platform:String(store.platform||''),status:String(store.status||'')});}}
  if(clientId&&await tableExists(db,'store_connections')){const conns=await db.prepare('SELECT id,provider,status,store_name,external_store_id FROM store_connections WHERE client_id=? ORDER BY provider,id').bind(clientId).all().catch(()=>({results:[]}));for(const connection of conns.results||[])result.connections.push({idHash:await digest(`connection-id:${connection.id}`),provider:String(connection.provider||''),status:String(connection.status||''),storeNameHash:connection.store_name?await digest(`store-name:${String(connection.store_name).trim().toLowerCase()}`):'',externalStoreIdHash:connection.external_store_id?await digest(`external-store:${connection.external_store_id}`):''});if(await tableExists(db,'integration_secrets')){const secrets=await db.prepare("SELECT c.provider AS provider,s.secret_name AS secret_name,COUNT(*) AS n FROM integration_secrets s JOIN store_connections c ON c.id=s.connection_id WHERE c.client_id=? GROUP BY c.provider,s.secret_name ORDER BY c.provider,s.secret_name").bind(clientId).all().catch(()=>({results:[]}));result.secretKeys=(secrets.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.secret_name||''),count:Number(row.n||0)}));}}
  return result;
}

async function tenantInventory(db){
  const ids=await resolveTargetIds(db);if(!ids)return [];
  const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().catch(()=>({results:[]}));const result=[];
  for(const row of tables.results||[]){const name=String(row.name||'');if(!SAFE_NAME.test(name))continue;const cols=await columnsAny(db,name);let scope='',count=0;
    if(ids.clientId&&cols.includes('client_id')){scope='client_id';const c=await db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE client_id=?`).bind(ids.clientId).first().catch(()=>null);count=Number(c?.n||0);}
    else if(ids.storeId&&cols.includes('store_id')){scope='store_id';const c=await db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE store_id=?`).bind(ids.storeId).first().catch(()=>null);count=Number(c?.n||0);}
    if(scope&&count>0)result.push({table:name,scope,count,hasId:cols.includes('id'),hasClientId:cols.includes('client_id'),hasStoreId:cols.includes('store_id')});
  }
  return result;
}

async function previewSecretCompatibility(db,env){if(!(await tableExists(db,'integration_secrets')))return {checked:0,success:0,failure:0,allDecryptable:false};const out=await db.prepare('SELECT ciphertext_b64,iv_b64 FROM integration_secrets LIMIT 100').all().catch(()=>({results:[]}));let success=0,failure=0;for(const row of out.results||[]){try{await decryptSecret(env,row.ciphertext_b64,row.iv_b64);success++;}catch{failure++;}}const checked=success+failure;return {checked,success,failure,allDecryptable:checked>0&&failure===0};}
async function snapshot(db){const counts={};for(const name of TABLES)counts[name]=await countTable(db,name);return {counts,columns:{users:await columns(db,'users'),stores:await columns(db,'stores'),store_connections:await columns(db,'store_connections'),integration_secrets:await columns(db,'integration_secrets')},integrations:await groupedIntegrationMetadata(db),targetTenant:await targetTenant(db),tenantInventory:await tenantInventory(db),fingerprints:{clients:await idFingerprints(db,'clients'),stores:await idFingerprints(db,'stores')}};}

export async function handleProductionPreviewParity(request,env){
  const url=new URL(request.url);if(request.method!=='GET'||url.pathname!=='/health/preview-parity')return null;if(!env.DB||!env.PREVIEW_DB)return json({ok:false,error:'PARITY_BINDING_UNAVAILABLE'},503);
  try{const [production,preview,keyCompatibility]=await Promise.all([snapshot(env.DB),snapshot(env.PREVIEW_DB),previewSecretCompatibility(env.PREVIEW_DB,env)]);return json({ok:true,mode:'read-only-no-secret-values',production,preview,keyCompatibility,generatedAt:new Date().toISOString()});}
  catch(error){return json({ok:false,error:'PARITY_READ_FAILED',message:String(error?.message||error)},500);}
}
