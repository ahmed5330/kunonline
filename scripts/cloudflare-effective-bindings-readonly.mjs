// Safe Cloudflare release preflight. GET Worker settings only.
// No D1 queries, exports, writes, migrations, deployments or credential output.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export function parseWorkerConfig(source) {
  let section='',value=null;
  const result={name:null,d1:[],services:[]};
  for(const raw of String(source).split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#'))continue;
    if(/^\[\[d1_databases\]\]$/.test(line)){section='d1';value={};result.d1.push(value);continue;}
    if(/^\[\[services\]\]$/.test(line)){section='service';value={};result.services.push(value);continue;}
    if(/^\[.+\]$/.test(line)){section='other';value=null;continue;}
    const pair=line.match(/^([a-z_]+)\s*=\s*"([^"]+)"(?:\s*#.*)?$/);
    if(!pair)continue;
    const [,key,item]=pair;
    if(section===''&&key==='name')result.name=item;
    else if(section==='d1'&&['binding','database_name','database_id'].includes(key))value[key]=item;
    else if(section==='service'&&['binding','service'].includes(key))value[key]=item;
  }
  return result;
}
const fail=(code)=>{throw Object.assign(new Error('CLOUDFLARE_BINDING_AUDIT_'+code),{code:'CLOUDFLARE_BINDING_AUDIT_'+code})};
const lower=value=>String(value||'').toLowerCase();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requireBinding=(bindings,{type,name,id,service})=>{
  const found=bindings.filter(b=>b?.name===name);
  if(found.length!==1||found[0].type!==type)fail('MISSING_OR_DUPLICATE_'+name);
  const value=found[0];
  if(type==='d1'&&lower(value.database_id||value.id)!==lower(id))fail('DATABASE_ID_MISMATCH_'+name);
  if(type==='service'&&value.service!==service)fail('SERVICE_MISMATCH_'+name);
};
export async function auditEffectiveBindings({productionConfig,previewConfig,accountId,token,fetcher=fetch}){
  const prod=parseWorkerConfig(productionConfig),prev=parseWorkerConfig(previewConfig);
  if(prod.name!=='kunonline'||prev.name!=='kunonline-preview')fail('WORKER_IDENTITY');
  const prodDb=prod.d1.find(x=>x.binding==='DB'),previewDb=prod.d1.find(x=>x.binding==='PREVIEW_DB'),
    previewSource=prev.d1.find(x=>x.binding==='DB');
  if(!prodDb||!previewDb||!previewSource||prod.d1.length!==2||prev.d1.length!==1)fail('D1_CONFIG');
  if(!uuid.test(lower(prodDb.database_id))||!uuid.test(lower(previewDb.database_id))||
    lower(prodDb.database_id)===lower(previewDb.database_id)||
    lower(previewDb.database_id)!==lower(previewSource.database_id)||
    previewDb.database_name!==previewSource.database_name)fail('SHARED_PREVIEW_CONFIG');
  const bridge=prod.services.find(x=>x.binding==='PREVIEW_APP');
  if(prod.services.length!==1||!bridge||bridge.service!==prev.name)fail('PREVIEW_SERVICE_CONFIG');
  if(!/^[a-f0-9]{32}$/i.test(String(accountId||''))||!String(token||'').trim())fail('AUTH_UNAVAILABLE');
  const settings=async(name)=>{
    // Only hardcoded, configured Worker names; the token is not embedded in a URL.
    const url='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'+name+'/settings';
    let response;
    try{response=await fetcher(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(15000)});}
    catch{fail('SETTINGS_NETWORK_UNAVAILABLE');}
    if(response?.status!==200)fail('SETTINGS_HTTP_'+Number(response?.status||0));
    const payload=await response.json().catch(()=>null);
    if(payload?.success!==true||!Array.isArray(payload.result?.bindings))fail('SETTINGS_SHAPE');
    return payload.result.bindings;
  };
  const [productionBindings,previewBindings]=await Promise.all([settings(prod.name),settings(prev.name)]);
  requireBinding(productionBindings,{name:'DB',type:'d1',id:prodDb.database_id});
  requireBinding(productionBindings,{name:'PREVIEW_DB',type:'d1',id:previewDb.database_id});
  requireBinding(productionBindings,{name:'PREVIEW_APP',type:'service',service:prev.name});
  requireBinding(previewBindings,{name:'DB',type:'d1',id:previewSource.database_id});
  return {ok:true,remoteBindingsVerified:true,productionWorker:prod.name,previewWorker:prev.name,
    productionD1MatchesConfig:true,canonicalPreviewD1MatchesConfig:true,previewServiceMatchesConfig:true,
    customerDataIsolationVerified:false,backupRestoreVerified:false,releaseApproved:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const [productionConfig,previewConfig]=await Promise.all([
    readFile('wrangler.production.toml','utf8'),readFile('wrangler.preview.toml','utf8')
  ]);
  const out=await auditEffectiveBindings({
    productionConfig,previewConfig,
    accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
    token:process.env.CLOUDFLARE_API_TOKEN
  });
  console.log(JSON.stringify(out));
  console.log('Read-only runtime bindings verified. BACKUP+RESTORE and isolated QA still REQUIRED. NO DEPLOYMENT PERMITTED.');
}
