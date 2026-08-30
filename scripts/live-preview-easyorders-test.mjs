import {readFile} from 'node:fs/promises';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/live-preview-easyorders-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Easy Orders QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex'),adminEmail=`qa-easyorders-${nonce}@example.test`,adminId=`QA-EO-${nonce}`,adminPassword=`Admin!${randomBytes(10).toString('hex')}Aa1`;
let adminCookie='';

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});const p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 query failed (${r.status}): ${JSON.stringify(p?.errors||x?.error||p).slice(0,800)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function api(path,{method='GET',cookie=adminCookie,body,ok=[200]}={}){const r=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data={};try{data=JSON.parse(text)}catch{data={raw:text}}if(!ok.includes(r.status))throw new Error(`${method} ${path} expected ${ok.join('/')}, got ${r.status}: ${text.slice(0,600)}`);return {status:r.status,data,headers:r.headers};}
async function cleanup(){for(const [sql,params] of [['DELETE FROM login_attempts WHERE email=?',[adminEmail]],['DELETE FROM users WHERE email=?',[adminEmail]]])try{await d1(sql,params)}catch{}}
function parsedConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function providerAccountUnavailable(message){const value=String(message||'').trim().toLowerCase();return value.includes('store not active or has over due')||value.includes('store not active or has overdue')||value.includes('store is not active')||value.includes('subscription expired');}

let primaryError=null;
try{
  const legacy=await api('/webhooks/easyorders',{cookie:'',ok:[410]});if(legacy.data.code!=='EASYORDERS_WEBHOOK_LEGACY_ROUTE_DISABLED')throw new Error(`Legacy webhook route was not explicitly disabled: ${JSON.stringify(legacy.data)}`);
  await cleanup();const hash=await hashPassword(adminPassword),ts=new Date().toISOString();
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[adminId,adminEmail,'CI Easy Orders Admin',hash,'admin','active',ts]);
  const login=await api('/api/login',{method:'POST',cookie:'',body:{email:adminEmail,password:adminPassword}});adminCookie=(login.headers.get('set-cookie')||'').split(';')[0];if(!adminCookie)throw new Error('Temporary admin cookie missing');
  const version=(await api('/api/preview/version')).data;if(version.build!=='preview-v34-2026-08-30-meta-ads-expert'||version.entrypoint!=='index-commerce-v34.js')throw new Error(`Expected current v34 Preview, got ${JSON.stringify(version)}`);
  const rows=await d1("SELECT id,client_id,external_store_id,config_json,updated_at FROM store_connections WHERE provider='easyorders' AND status='connected' ORDER BY updated_at DESC LIMIT 1");
  if(!rows.length){console.log('Live Easy Orders webhook QA: legacy route disabled; no connected Easy Orders Preview row exists, so scoped live probe and gap recovery were skipped.');}
  else{
    const row=rows[0],cfg=parsedConfig(row),q=new URLSearchParams({clientId:row.client_id});if(cfg.kunStoreId)q.set('storeId',cfg.kunStoreId);
    const diagnostic=(await api(`/api/commerce/order-sync/diagnostics?${q}`)).data;
    if(diagnostic.connectionId!==row.id)throw new Error(`Diagnostics selected ${diagnostic.connectionId} instead of current Easy Orders connection ${row.id}`);
    if(diagnostic.routeMode!=='connection-scoped'||diagnostic.legacyRouteDisabled!==true)throw new Error(`Scoped-route diagnostics metadata missing: ${JSON.stringify({routeMode:diagnostic.routeMode,legacyRouteDisabled:diagnostic.legacyRouteDisabled})}`);
    const target=new URL(diagnostic.webhookUrl);if(target.origin!==base)throw new Error(`Webhook origin mismatch: ${target.origin}`);
    const routePattern=new RegExp(`^/webhooks/easyorders/${row.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}/[a-f0-9]{64}/?$`);if(!routePattern.test(target.pathname))throw new Error(`Generated Easy Orders webhook path is not connection-scoped for ${row.id}`);
    const probe=await fetch(target,{method:'HEAD',cache:'no-store'});if(probe.status!==200||probe.headers.get('X-Kun-Webhook-Ready')!=='1')throw new Error(`Scoped Easy Orders HEAD probe failed: HTTP ${probe.status}`);
    const after=(await api(`/api/commerce/order-sync/diagnostics?${q}`)).data;if(!after.webhook?.lastProbeAt)throw new Error('Diagnostics did not record scoped webhook probe');
    const repair=(await api('/api/commerce/order-sync/reconcile',{method:'POST',body:{clientId:row.client_id,storeId:cfg.kunStoreId||undefined,connectionId:row.id,maxRequests:30,lookback:80}})).data;
    if(repair.ok!==true||Number(repair.connections||0)<1)throw new Error(`Easy Orders gap recovery endpoint did not run: ${JSON.stringify(repair).slice(0,1000)}`);
    const failed=(repair.results||[]).find(x=>x.error),providerUnavailable=failed&&providerAccountUnavailable(failed.error);
    if(failed&&!providerUnavailable)throw new Error(`Easy Orders gap recovery failed: ${failed.error}`);
    const tokenPart=target.pathname.split('/').filter(Boolean).at(-1)||'',maskedToken=tokenPart.length>12?`${tokenPart.slice(0,6)}…${tokenPart.slice(-4)}`:'masked';
    if(providerUnavailable){
      console.warn(`Live Easy Orders QA passed with provider account unavailable: connection=${row.id}; scopedProbe=200; routeToken=${maskedToken}; providerMessage=${String(failed.error).slice(0,200)}. Webhook routing and diagnostics are healthy; historical recovery could not be exercised because Easy Orders blocked this inactive/overdue store.`);
    }else{
      console.log(`Live Easy Orders QA passed: connection=${row.id}; externalStoreId=${row.external_store_id||'none'}; secret=${after.secretConfigured?'configured':'missing'}; scopedProbe=200; routeToken=${maskedToken}; lastPOST=${after.webhook?.lastReceivedAt||'none'}; recoveryRequests=${repair.requests||0}; recovered=${repair.recovered||0}; updated=${repair.updated||0}; seeded=${repair.seeded||0}; rateLimited=${repair.rateLimited?'yes':'no'}.`);
    }
  }
}catch(error){primaryError=error;
}finally{try{await cleanup()}catch(cleanupError){primaryError=primaryError?new Error(`${primaryError.message}; ${cleanupError.message}`):cleanupError;}}
if(primaryError)throw primaryError;
