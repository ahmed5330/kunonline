// Three fresh QA resources: canonical backend, separate legacy D1 and Production
// front Worker. No customer rows/credentials are copied into these resources.
import {randomBytes,webcrypto} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),liveIds=new Set(['31cd5cdf-fc01-42d7-ba1e-571f3dd58495','c426601d-182f-486e-a5c1-bb1bca0ecb0b']);
async function main(){
 const backendDir=resolve('qa-backend'),candidateDir=resolve('qa-production');
 const {loadIsolatedPreviewQaConfig}=await import(pathToFileURL(join(backendDir,'scripts/isolated-preview-qa-config.mjs')));
 const config=await loadIsolatedPreviewQaConfig(process.env.KUN_PREVIEW_QA_BASE_URL);
 const run=process.env.GITHUB_RUN_ID,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 const canonical=process.env.KUN_PREVIEW_QA_D1_ID,backend=config.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
 if(!/^\d+$/.test(run||'')||backend!==`kunonline-isolated-qa-${run}`||liveIds.has(canonical)||!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('PROD_QA_RUNTIME_INVALID');
 const name=`kunonline-isolated-production-${run}`,legacyName=`kunonline-isolated-prod-legacy-${run}`;
 async function api(method,path,body){
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(method==='DELETE'&&r.status===404)return null;
  const d=await r.json().catch(()=>({}));if(!r.ok||d.success!==true)throw Error('PROD_QA_CLOUDFLARE_FAILED');return d.result;
 }
 if(process.argv[2]==='--cleanup'){await api('DELETE',`workers/scripts/${name}`);console.log(JSON.stringify({productionQaWorkerRemoved:true,customerWorkerModified:false}));return;}
 const settings=await api('GET',`workers/scripts/${backend}/settings`),b=settings.bindings||[];
 if(b.filter(x=>x.type==='d1').length!==1||!b.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===canonical)||b.some(x=>x.type==='service'))throw Error('PROD_QA_BACKEND_NOT_ISOLATED');
 const identity=await fetch(process.env.KUN_PREVIEW_QA_BASE_URL+'/__qa/identity').then(r=>r.json());
 const backendSha=(await execute('git',['rev-parse','HEAD'],{cwd:backendDir})).stdout.trim(),candidateSha=(await execute('git',['rev-parse','HEAD'],{cwd:candidateDir})).stdout.trim();
 if(identity.syntheticOnly!==true||identity.externalNetworkPolicy!=='synthetic-easyorders-only'||identity.sourceSha!==backendSha||candidateSha!=='0047df6a41769a5f77c234bb16a49e15ec630ae1')throw Error('PROD_QA_SOURCE_IDENTITY_INVALID');
 const allowedIds=new Set([canonical]);
 async function query(id,sql,params=[]){
  if(!allowedIds.has(id)||liveIds.has(id))throw Error('PROD_QA_CUSTOMER_SQL_FORBIDDEN');
  const result=await api('POST',`d1/database/${id}/query`,{sql,params});
  if(result?.some(x=>x.success===false))throw Error('PROD_QA_SQL_FAILED');return result?.[0]?.results||[];
 }
 const dir=await mkdtemp(join(tmpdir(),'kun-production-runtime-qa-'));
 const uid=`QA-PRODUCTION-OWNER-${run}`,legacyUid=`QA-PRODUCTION-LEGACY-${run}`,cid='QA-SYNTHETIC-TENANT',sid='QA-SYNTHETIC-STORE',email=`qa-prod-${run}@example.test`;
 const password=`Canonical!${randomBytes(16).toString('hex')}Aa1`,legacyPassword=`Legacy!${randomBytes(16).toString('hex')}Bb2`;
 let legacy;
 async function cli(args){try{await execute(resolve('node_modules/.bin/wrangler'),args,{env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:300000,maxBuffer:16*1024*1024});}catch{throw Error('PROD_QA_WRANGLER_'+(args[0]==='d1'?args[1]:args[0]).toUpperCase()+'_FAILED');}}
 async function hash(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
 try{
  legacy=await api('POST','d1/database',{name:legacyName});
  if(legacy.name!==legacyName||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(legacy.uuid||'')||liveIds.has(legacy.uuid)||legacy.uuid===canonical)throw Error('PROD_QA_LEGACY_ID_UNSAFE');
  allowedIds.add(legacy.uuid);
  const sourceCfg=join(dir,'source.toml'),targetCfg=join(dir,'target.toml'),schema=join(dir,'schema.sql');
  await writeFile(sourceCfg,'name = "qa-production-schema-reader"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "qa-production-schema-source"\ndatabase_id = "c426601d-182f-486e-a5c1-bb1bca0ecb0b"\n',{mode:0o600});
  await writeFile(targetCfg,`name = "${name}"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${legacyName}"\ndatabase_id = "${legacy.uuid}"\n`,{mode:0o600});
  await cli(['d1','export','qa-production-schema-source','--remote','--no-data','--output',schema,'--config',sourceCfg,'--skip-confirmation']);
  await cli(['d1','execute',legacyName,'--remote','--file',schema,'--config',targetCfg,'--yes']);
  const empty=(await query(legacy.uuid,'SELECT (SELECT COUNT(*) FROM users) AS users_count,(SELECT COUNT(*) FROM orders) AS order_count'))[0];
  if(!empty||Object.values(empty).some(x=>Number(x)!==0))throw Error('PROD_QA_SCHEMA_CONTAINED_CUSTOMER_ROWS');
  const at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const adminUid=`QA-GENERAL-ADMIN-${run}`,adminEmail=`qa-admin-${run}@example.test`,adminPassword=`QAAdmin!${randomBytes(16).toString('hex')}Aa1`;
  await query(canonical,'INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminUid,adminEmail,'Synthetic General Admin',await hash(adminPassword),'admin','active',at]);
  await query(canonical,'INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,?,?,?,NULL)',[uid,email,'Synthetic Production Owner',await hash(password),'client',cid,'active',at]);
  await query(legacy.uuid,'INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[legacyUid,email,'Synthetic Legacy Admin',await hash(legacyPassword),'admin','active',at]);
  await query(canonical,"INSERT OR IGNORE INTO wallet_accounts (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,1000,'EGP',0,0,0,0,'v27',0,'active',?)",[cid,at]);
  const prior=Number((await query(canonical,'SELECT balance FROM wallet_accounts WHERE client_id=?',[cid]))[0].balance);
  const adjustment=1000-prior;
  if(adjustment!==0)await query(canonical,"INSERT INTO wallet_log (id,client_id,type,amount,balance_after,note,created_at,created_by,reference_type,reference_id,idempotency_key,metadata_json) VALUES (?,?,?,?,1000,?,?,?,?,?,?,?)",[`QA-OPEN-${run}`,cid,adjustment>0?'admin_credit':'deduct',Math.abs(adjustment),'Synthetic isolated QA opening balance',at,adminUid,'qa_opening',run,`qa-opening:${run}`,'{"syntheticOnly":true}']);
  await query(canonical,"UPDATE wallet_accounts SET balance=1000,base_order_fee=0,min_order_fee=0,max_order_fee=0,status='active',updated_at=? WHERE client_id=?",[at,cid]);
  await query(canonical,"UPDATE subscriptions SET amount=0,status='active',updated_at=? WHERE client_id=?",[at,cid]);
  await query(canonical,"INSERT INTO subscriptions (id,client_id,status,amount,created_at,updated_at) SELECT ?,?,'active',0,?,? WHERE NOT EXISTS(SELECT 1 FROM subscriptions WHERE client_id=?)",[`QA-SUB-${run}`,cid,at,at,cid]);
  await query(canonical,'UPDATE orders SET date=? WHERE client_id=? AND store_id=?',[day,cid,sid]);
  const orders=await query(canonical,'SELECT id FROM orders WHERE client_id=? AND store_id=? ORDER BY id',[cid,sid]);
  if(orders.length!==3||orders.some(x=>!/^QA-PROVIDER-[123]$/.test(x.id)))throw Error('PROD_QA_ORDERS_FIXTURE_INVALID');
  await query(canonical,"UPDATE orders SET state='confirmed',name='Synthetic Production Confirmed' WHERE id=? AND client_id=? AND store_id=?",[orders[0].id,cid,sid]);
  await query(canonical,'INSERT INTO store_connections (id,client_id,provider,external_store_id,status,config_json,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[`QA-FOREIGN-ERROR-${run}`,'PREVIEW-STORE-001','easyorders','EO-SYNTHETIC-FOREIGN','connected',JSON.stringify({kunStoreId:'STR-CD14EDC5',easyOrdersRecoveryLastStatus:'error',easyOrdersRecoveryLastError:'Synthetic other-store error',easyOrdersRecoveryLastCronAt:at}),'Synthetic other-store error',at,at]);
  let session=randomBytes(32).toString('hex');
  if(session===config.match(/^SESSION_SECRET\s*=\s*"([^"]+)"/m)?.[1])throw Error('PROD_QA_SIGNERS_NOT_DISTINCT');
  const entry=join(dir,'entry.mjs');
  await writeFile(entry,`import app from ${JSON.stringify(join(candidateDir,'src/index-production-mobile-update.js'))};\nimport {syntheticProviderFetch} from ${JSON.stringify(join(backendDir,'sandbox/easyorders-synthetic-provider.mjs'))};\nglobalThis.fetch=syntheticProviderFetch;\nexport default {fetch(request,env,ctx){if(env.KUN_ISOLATED_QA!=='true')return new Response('QA required',{status:503});if(new URL(request.url).pathname==='/__qa/identity')return Response.json({syntheticOnly:true,candidateSha:${JSON.stringify(candidateSha)},backendSha:${JSON.stringify(backendSha)}});return app.fetch(request,env,ctx)}};\n`,{mode:0o600});
  const frontCfg=join(dir,'front.toml');
  await writeFile(frontCfg,`name = "${name}"
main = ${JSON.stringify(entry)}
compatibility_date = "2026-08-23"
[assets]
directory = ${JSON.stringify(join(candidateDir,'public'))}
binding = "ASSETS"
run_worker_first = ["/", "/index.html", "/v2/", "/v2/index.html"]
[[d1_databases]]
binding = "DB"
database_name = "${legacyName}"
database_id = "${legacy.uuid}"
[[d1_databases]]
binding = "PREVIEW_DB"
database_name = "${backend}"
database_id = "${canonical}"
[[services]]
binding = "PREVIEW_APP"
service = "${backend}"
[vars]
APP_ENV = "production"
KUN_ISOLATED_QA = "true"
FAOS_WRITE_ENABLED = "1"
SESSION_SECRET = "${session}"
TRACKING_PROVIDER = "track123"
META_GRAPH_API_VERSION = "v25.0"
[triggers]
crons = []
[ai]
binding = "AI"
[observability]
enabled = false
`,{mode:0o600});
  await cli(['deploy','--config',frontCfg]);
  const front=await api('GET',`workers/scripts/${name}/settings`),fb=front.bindings||[];
  if(fb.filter(x=>x.type==='d1').length!==2||!fb.some(x=>x.type==='d1'&&x.name==='DB'&&x.id===legacy.uuid)||!fb.some(x=>x.type==='d1'&&x.name==='PREVIEW_DB'&&x.id===canonical)||fb.filter(x=>x.type==='service').length!==1||!fb.some(x=>x.type==='service'&&x.name==='PREVIEW_APP'&&x.service===backend))throw Error('PROD_QA_FRONT_BINDING_INVALID');
  const host=new URL(process.env.KUN_PREVIEW_QA_BASE_URL).hostname.split('.').slice(1).join('.'),base=`https://${name}.${host}`;
  let ready=false;for(let i=0;i<25;i++){try{const x=await fetch(base+'/__qa/identity',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());if(x.syntheticOnly===true&&x.candidateSha===candidateSha){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,2000));}if(!ready)throw Error('PROD_QA_FRONT_NOT_READY');
  let cookie='';
  async function request(path,{method='GET',body,status=200}={}){
   const r=await fetch(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const d=await r.json().catch(()=>({}));if(r.status!==status){const code=/^[A-Z0-9_]+$/.test(d.code||'')?d.code:'FAILED';throw Error(`PROD_QA_HTTP_${path.split('?')[0].toUpperCase().replace(/[^A-Z0-9]/g,'_')}_${r.status}_${code}`);}return {r,d};
  }
  const manifest=(await request('/api/preview/growth-release')).d;if(manifest.release!=='kun-growth-wallet-20261015-r1'||!manifest.capabilities?.includes('wallet-ledger-integrity')||['uid','clientId','orders','users'].some(k=>Object.hasOwn(manifest,k)))throw Error('PROD_QA_RELEASE_MANIFEST_INVALID');
  const login=await request('/api/login',{method:'POST',body:{email,password}});cookie=(login.r.headers.get('set-cookie')||'').split(';')[0];if(!cookie)throw Error('PROD_QA_COOKIE_MISSING');
  const me=(await request('/api/me')).d;if(me.role!=='client'||me.clientId!==cid)throw Error('PROD_QA_CANONICAL_AUTH_FAILED');
  const wrong=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:legacyPassword})});if(![400,401,403].includes(wrong.status))throw Error('PROD_QA_LEGACY_AUTH_FALLBACK');
  const q='?'+new URLSearchParams({clientId:cid,storeId:sid}),state=(await request('/api/state'+q)).d;
  const rows=Array.isArray(state.orders)?state.orders:state.state?.orders;
  if(!Array.isArray(rows)||orders.some(o=>!rows.some(x=>x.id===o.id)))throw Error('PROD_QA_STATE_PARITY_FAILED');
  const board=(await request('/api/customer-service'+q)).d;
  if(!board.orders?.some(x=>x.id===orders[0].id&&x.state==='confirmed'))throw Error('PROD_QA_CUSTOMER_SERVICE_PARITY_FAILED');
  const print=(await request('/api/printing'+q+'&tab=waiting')).d;
  if(!print.orders?.some(x=>x.id===orders[0].id)||print.orders.some(x=>x.state!=='confirmed'&&x.state!=='preparing'))throw Error('PROD_QA_PRINTING_PARITY_FAILED');
  const mobile=(await request('/api/mobile/state-sync'+q)).d;
  if(mobile.mode!=='reset'||orders.some(o=>!mobile.state?.orders?.some(x=>x.id===o.id)))throw Error('PROD_QA_MOBILE_PARITY_FAILED');
  const audit=(await request('/api/commerce/order-sync/audit-gaps',{method:'POST',body:{clientId:cid,storeId:sid,connectionId:`CON-QA-EASYORDERS-${run}`,fromShortId:1,toShortId:3}})).d;
  if(audit.ok!==true||audit.alreadyInKun!==3||audit.missingInKun!==0)throw Error('PROD_QA_PROVIDER_DELEGATION_FAILED');
  const health=(await request('/api/integrations/easyorders/dashboard-health'+q)).d;
  if(health.source!=='tenant'||health.scope!=='store'||health.connections!==1||health.canonical?.errorConnections!==0)throw Error('PROD_QA_SCOPED_HEALTH_FAILED');
  const denied=await fetch(base+'/api/state?clientId=PREVIEW-STORE-001',{headers:{Cookie:cookie}});
  if(denied.status===200){const d=await denied.json();const other=d.orders||d.state?.orders;if(!Array.isArray(other)||other.length!==orders.length||other.some(x=>!orders.some(o=>o.id===x.id)))throw Error('PROD_QA_FOREIGN_SCOPE_ACCEPTED');}
  else if(![401,403].includes(denied.status))throw Error('PROD_QA_FOREIGN_SCOPE_ACCEPTED');
  await request('/api/dashboard'+q);await request('/api/accounting/monthly'+q);
  const shell=await fetch(base+'/v2/');const html=await shell.text();if(!shell.ok||!html.includes('/v2/app-v3.js')||!html.includes('modules-v31-customer-service.js'))throw Error('PROD_QA_V2_SHELL_FAILED');
  const range=q+'&from='+day+'&to='+day;
  await request('/api/growth/inventory-catalog'+range);
  await request('/api/growth/operating-evidence'+range);
  const growth=(await request('/api/growth/scenario/preview'+range,{method:'POST',body:{clientId:cid,storeId:sid,plan:{horizonDays:7,proposedDailyBudget:100,costPerEnteredOrder:10,expectedDeliveryRate:0.7,contributionPerDeliveredOrderBeforeAds:50,returnLossPerFailedOrder:20,merchantCashAvailable:1000,daysToNextCollection:3,extraDailyCashOutflow:0,extraDailyOperatingCost:0,dailyConfirmationCapacity:10,dailyPackingCapacity:10,dailyShippingCapacity:10,currency:'EGP',cashOutflowComplete:false,coversAllPromotedSkus:false,stockItems:[]},rule:{increasePct:10,maxDailyBudget:120}}})).d;
  if(growth.scenario?.approvalToIncreaseBudget!==false||growth.scenario?.rulePreview?.providerWrite!==false||growth.scenario?.rulePreview?.execution!==false)throw Error('PROD_QA_GROWTH_WRITE_SAFETY_FAILED');
  await request('/api/accounting/faos/catalog');await request('/api/accounting/faos/simulation');
  const faos=(await request('/api/accounting/faos/overview'+range)).d;
  if(faos.capabilities?.financialPostingEnabled!==false||faos.capabilities?.operationalAutoPostingEnabled!==false)throw Error('PROD_QA_FAOS_READONLY_FAILED');
  const topup=`QA-TOPUP-${run}`,other=`QA-OTHER-WALLET-${run}`;
  await query(canonical,"INSERT INTO wallet_accounts (client_id,balance,currency,base_order_fee,min_order_fee,max_order_fee,credit_limit,billing_version,billing_start_rowid,status,updated_at) VALUES (?,777,'EGP',0,0,0,0,'v27',0,'active',?)",[other,at]);
  await query(canonical,"INSERT INTO wallet_topup_requests (id,client_id,amount,currency,sender_phone,status,requested_by,requested_at,metadata_json) VALUES (?,?,42,'EGP','01000000000','pending',?,?,?)",[topup,cid,adminUid,at,'{"syntheticOnly":true}']);
  const approvalPath='/api/admin/wallet/topups/'+topup+'/approve';
  await request(approvalPath,{method:'POST',body:{},status:403});
  const adminLogin=await request('/api/login',{method:'POST',body:{email:adminEmail,password:adminPassword}});cookie=(adminLogin.r.headers.get('set-cookie')||'').split(';')[0];
  const adminMe=(await request('/api/me')).d;if(adminMe.role!=='admin'||adminMe.uid!==adminUid)throw Error('PROD_QA_ADMIN_IDENTITY_FAILED');
  const deferred=await fetch(process.env.KUN_PREVIEW_QA_BASE_URL+'/api/inventory/unit-tracking/summary'+q,{headers:{Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(deferred.status!==404)throw Error('PROD_QA_DEFERRED_INVENTORY_ACTIVATED');
  const blocked=(await request('/api/accounting/faos/journals',{method:'POST',body:{clientId:cid,storeId:sid},status:403})).d;
  if(blocked.code!=='FAOS_WRITE_DISABLED')throw Error('PROD_QA_FAOS_POSTING_GATE_FAILED');
  await Promise.all([request(approvalPath,{method:'POST',body:{note:'Synthetic race A'}}),request(approvalPath,{method:'POST',body:{note:'Synthetic race B'}})]);
  const credits=(await query(canonical,"SELECT COUNT(*) AS n FROM wallet_log WHERE client_id=? AND reference_type='topup_request' AND reference_id=?",[cid,topup]))[0];
  const balance=Number((await query(canonical,'SELECT balance FROM wallet_accounts WHERE client_id=?',[cid]))[0].balance),otherBalance=Number((await query(canonical,'SELECT balance FROM wallet_accounts WHERE client_id=?',[other]))[0].balance);
  if(Number(credits.n)!==1||balance!==1042||otherBalance!==777)throw Error('PROD_QA_WALLET_CREDIT_RACE_FAILED');
  const forensic=(await request('/api/admin/subscriptions/'+cid+'/ledger?limit=50')).d;
  if(forensic.diagnostics?.ledgerContinuity?.anomalyCount!==0||Number(forensic.wallet?.balance)!==1042)throw Error('PROD_QA_WALLET_FORENSIC_FAILED');
  const legacyOrders=(await query(legacy.uuid,'SELECT COUNT(*) AS n FROM orders'))[0]?.n;if(Number(legacyOrders)!==0)throw Error('PROD_QA_LEGACY_DATA_ROUTING_FAILED');
  console.log(JSON.stringify({kind:'ISOLATED_PRODUCTION_RUNTIME_PROVEN',candidateSha,backendSha,syntheticOnly:true,distinctDatabases:true,distinctSessionSecrets:true,canonicalOrdersMatched:3,customerServiceConfirmedVisible:true,printingSameOrder:true,mobileSameOrders:true,legacyPasswordRejected:true,foreignClientDenied:true,providerKeyStayedInBackend:true,scopedHealthMatched:true,publicMetadataOnly:true,growthDryRunNoProviderWrite:true,productionFaosReadOnly:true,syntheticWalletConcurrentCreditExactlyOnce:true,foreignWalletUnchanged:true,walletLedgerContinuity:true,canonicalSerializedInventoryActivated:false,existingInventoryConflictResolved:false,customerRowsModified:false}));
 }finally{
  try{await query(canonical,'DELETE FROM users WHERE id=? AND email=?',[`QA-GENERAL-ADMIN-${run}`,`qa-admin-${run}@example.test`]);await query(canonical,'DELETE FROM store_connections WHERE id=? AND client_id=?',[`QA-FOREIGN-ERROR-${run}`,'PREVIEW-STORE-001']);await query(canonical,'DELETE FROM users WHERE id=? AND email=?',[uid,email]);if(legacy?.uuid&&allowedIds.has(legacy.uuid))await query(legacy.uuid,'DELETE FROM users WHERE id=? AND email=?',[legacyUid,email]);}
  finally{try{await api('DELETE',`workers/scripts/${name}`);}finally{await rm(dir,{recursive:true,force:true});}}
 }
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'PROD_QA_RUNTIME_FAILED',customerRowsModified:false}));process.exitCode=1;});
