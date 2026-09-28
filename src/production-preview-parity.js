const TABLES=['clients','users','stores','orders','customers','products','store_connections','integration_secrets','campaign_daily_metrics','meta_ad_entities','meta_ad_daily_metrics'];
const TARGET_USER_EMAIL_HASH='f0098ef5258eb658';

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0'}});
}

async function tableExists(db,name){
  if(!db)return false;
  const row=await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(name).first().catch(()=>null);
  return !!row;
}

async function countTable(db,name){
  if(!TABLES.includes(name)||!(await tableExists(db,name)))return null;
  const row=await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first().catch(()=>null);
  return row?Number(row.n||0):null;
}

async function columns(db,name){
  if(!TABLES.includes(name)||!(await tableExists(db,name)))return [];
  const out=await db.prepare(`PRAGMA table_info('${name}')`).all().catch(()=>({results:[]}));
  return (out.results||[]).map(row=>String(row.name||'')).filter(Boolean);
}

async function groupedIntegrationMetadata(db){
  const result={storeConnections:[],secretKeys:[]};
  if(await tableExists(db,'store_connections')){
    const cols=await columns(db,'store_connections');
    const provider=cols.includes('provider')?'provider':cols.includes('type')?'type':null;
    const status=cols.includes('status')?'status':null;
    if(provider){
      const statusExpr=status?`, ${status} AS status`:`, '' AS status`;
      const group=status?`, ${status}`:'';
      const out=await db.prepare(`SELECT ${provider} AS provider${statusExpr}, COUNT(*) AS n FROM store_connections GROUP BY ${provider}${group} ORDER BY ${provider}${group}`).all().catch(()=>({results:[]}));
      result.storeConnections=(out.results||[]).map(row=>({provider:String(row.provider||''),status:String(row.status||''),count:Number(row.n||0)}));
    }
  }
  if(await tableExists(db,'integration_secrets')){
    const cols=await columns(db,'integration_secrets');
    if(cols.includes('connection_id')&&cols.includes('secret_name')&&await tableExists(db,'store_connections')){
      const out=await db.prepare("SELECT COALESCE(c.provider,'') AS provider,s.secret_name AS secret_name,COUNT(*) AS n FROM integration_secrets s LEFT JOIN store_connections c ON c.id=s.connection_id GROUP BY c.provider,s.secret_name ORDER BY c.provider,s.secret_name").all().catch(()=>({results:[]}));
      result.secretKeys=(out.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.secret_name||''),count:Number(row.n||0)}));
    }else if(cols.includes('provider')&&cols.includes('key_name')){
      const out=await db.prepare('SELECT provider,key_name,COUNT(*) AS n FROM integration_secrets GROUP BY provider,key_name ORDER BY provider,key_name').all().catch(()=>({results:[]}));
      result.secretKeys=(out.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.key_name||''),count:Number(row.n||0)}));
    }
  }
  return result;
}

async function digest(value){
  const bytes=new TextEncoder().encode(String(value||''));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
}

async function idFingerprints(db,table){
  if(!['clients','stores'].includes(table)||!(await tableExists(db,table)))return [];
  const cols=await columns(db,table);
  if(!cols.includes('id'))return [];
  const out=await db.prepare(`SELECT id FROM ${table} ORDER BY id LIMIT 250`).all().catch(()=>({results:[]}));
  const values=[];
  for(const row of out.results||[]) values.push(await digest(`${table}:${row.id}`));
  return values.sort();
}

async function targetTenant(db){
  if(!(await tableExists(db,'users')))return {found:false};
  const userCols=await columns(db,'users');
  if(!userCols.includes('email'))return {found:false,reason:'users.email missing'};
  const select=['id','email'];
  for(const name of ['client_id','role','store_id'])if(userCols.includes(name))select.push(name);
  const out=await db.prepare(`SELECT ${select.join(',')} FROM users`).all().catch(()=>({results:[]}));
  let matched=null;
  for(const row of out.results||[]){
    const emailHash=await digest(`user-email:${String(row.email||'').trim().toLowerCase()}`);
    if(emailHash===TARGET_USER_EMAIL_HASH){matched=row;break;}
  }
  if(!matched)return {found:false};
  const clientId=matched.client_id==null?'':String(matched.client_id);
  const result={
    found:true,
    userIdHash:await digest(`user-id:${matched.id}`),
    clientIdHash:clientId?await digest(`client-id:${clientId}`):'',
    role:String(matched.role||''),
    stores:[],
    connections:[],
    secretKeys:[]
  };
  if(clientId&&await tableExists(db,'stores')){
    const storeCols=await columns(db,'stores');
    if(storeCols.includes('client_id')&&storeCols.includes('id')){
      const fields=['id'];
      for(const name of ['name','domain','platform','status'])if(storeCols.includes(name))fields.push(name);
      const stores=await db.prepare(`SELECT ${fields.join(',')} FROM stores WHERE client_id=? ORDER BY id`).bind(clientId).all().catch(()=>({results:[]}));
      for(const store of stores.results||[]){
        result.stores.push({
          idHash:await digest(`store-id:${store.id}`),
          nameHash:store.name?await digest(`store-name:${String(store.name).trim().toLowerCase()}`):'',
          domainHash:store.domain?await digest(`store-domain:${String(store.domain).trim().toLowerCase()}`):'',
          platform:String(store.platform||''),
          status:String(store.status||'')
        });
      }
    }
  }
  if(clientId&&await tableExists(db,'store_connections')){
    const conns=await db.prepare('SELECT id,provider,status,store_name,external_store_id FROM store_connections WHERE client_id=? ORDER BY provider,id').bind(clientId).all().catch(()=>({results:[]}));
    for(const connection of conns.results||[]){
      result.connections.push({
        idHash:await digest(`connection-id:${connection.id}`),
        provider:String(connection.provider||''),
        status:String(connection.status||''),
        storeNameHash:connection.store_name?await digest(`store-name:${String(connection.store_name).trim().toLowerCase()}`):'',
        externalStoreIdHash:connection.external_store_id?await digest(`external-store:${connection.external_store_id}`):''
      });
    }
    if(await tableExists(db,'integration_secrets')){
      const secrets=await db.prepare("SELECT c.provider AS provider,s.secret_name AS secret_name,COUNT(*) AS n FROM integration_secrets s JOIN store_connections c ON c.id=s.connection_id WHERE c.client_id=? GROUP BY c.provider,s.secret_name ORDER BY c.provider,s.secret_name").bind(clientId).all().catch(()=>({results:[]}));
      result.secretKeys=(secrets.results||[]).map(row=>({provider:String(row.provider||''),secretName:String(row.secret_name||''),count:Number(row.n||0)}));
    }
  }
  return result;
}

async function snapshot(db){
  const counts={};
  for(const name of TABLES)counts[name]=await countTable(db,name);
  return {
    counts,
    columns:{
      users:await columns(db,'users'),
      stores:await columns(db,'stores'),
      store_connections:await columns(db,'store_connections'),
      integration_secrets:await columns(db,'integration_secrets')
    },
    integrations:await groupedIntegrationMetadata(db),
    targetTenant:await targetTenant(db),
    fingerprints:{clients:await idFingerprints(db,'clients'),stores:await idFingerprints(db,'stores')}
  };
}

export async function handleProductionPreviewParity(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/health/preview-parity')return null;
  if(!env.DB||!env.PREVIEW_DB)return json({ok:false,error:'PARITY_BINDING_UNAVAILABLE'},503);
  try{
    const [production,preview]=await Promise.all([snapshot(env.DB),snapshot(env.PREVIEW_DB)]);
    return json({ok:true,mode:'read-only-no-secret-values',production,preview,generatedAt:new Date().toISOString()});
  }catch(error){
    return json({ok:false,error:'PARITY_READ_FAILED',message:String(error?.message||error)},500);
  }
}
