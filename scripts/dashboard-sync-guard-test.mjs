import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
let production;

export async function renderGuard(source,payload,{store='store-1',httpOk=true,networkError=false}={}){
  let html='',calls=0;
  const hero={insertAdjacentHTML(position,value){assert.equal(position,'afterend');html=value;}};
  const root={querySelector:()=>hero};
  const document={readyState:'loading',addEventListener(){},
    querySelector(selector){return selector==='.nav button.active'?{dataset:{view:'dashboard'}}:true;},
    getElementById(id){if(id==='root')return root;if(id==='storeBtn')return {value:store};if(id==='kunDashSyncGuard'&&html)return {remove(){html='';},querySelector(){return null;}};return null;}
  };
  const window={};
  vm.runInNewContext(source,{window,document,Date,fetch:async url=>{
    assert.match(url,/^\/health\/easyorders-sync\?/);calls++;
    if(networkError)throw new Error('offline');
    return {ok:httpOk,json:async()=>payload};
  }});
  await window.KunDashboardSyncGuardV121.refresh();
  return {html,calls};
}

function environment(configs){
  return {
    get DB(){throw new Error('Must not read legacy Production DB');},
    get TOKEN_ENC_KEY(){throw new Error('Must not access Production secrets');},
    PREVIEW_APP:{fetch(){throw new Error('Health must not invoke provider or write APIs');}},
    PREVIEW_DB:{prepare(sql){
      assert.match(sql,/^SELECT \* FROM store_connections WHERE provider='easyorders' AND status='connected'/);
      return {bind(){return this;},async all(){return {results:configs.map((config,i)=>({id:`private-${i}`,client_id:'private-client',config_json:JSON.stringify(config)}))};}};
    }}
  };
}
const healthy={easyOrdersRecoveryHighestShortId:100,easyOrdersRecoveryCursor:101,easyOrdersRecoveryLastStatus:'healthy',easyOrdersRecoveryLastError:null};
async function getHealth(env){
  const response=await production.fetch(new Request('https://app.kun-online.com/health/easyorders-sync'),env,{});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Kun-Data-Source'),'preview');
  const payload=await response.json();
  assert.doesNotMatch(JSON.stringify(payload),/private-client|private-0|config_json|provider-secret/);
  return {payload,response};
}

async function main(){
  const hooks=registerHooks({resolve(specifier,context,next){
    if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};
    return next(specifier,context);
  }});
  production=(await import('../src/index-production-mobile-update.js')).default;
  hooks.deregister();
  const source=await readFile('public/v2/modules-v121-dashboard-sync-guard.js','utf8');
  const {payload}=await getHealth(environment([healthy]));
  assert.equal(payload.source,'preview');assert.equal(payload.status,'healthy');assert.equal(payload.canonical.connections,1);
  assert.equal((await renderGuard(source,payload)).html,'');
  assert.doesNotMatch((await renderGuard(source,payload,{store:''})).html,/متوقفة|يرفض|تعذر/);
  // Stale Production counters cannot override a successful canonical read.
  assert.equal((await renderGuard(source,{...payload,runtimeDiagnostics:{failureCode:null,invalidApiKeyClients:1,unreadableKeyClients:1}})).html,'');
  const stale={ok:true,runtimeDiagnostics:{failureCode:'EASYORDERS_API_KEY_INVALID',invalidApiKeyClients:1}};
  assert.match((await renderGuard(source,stale)).html,/تعذر التحقق/);
  assert.doesNotMatch((await renderGuard(source,stale)).html,/يرفض|متوقفة/);
  for(const [error,expected] of [['Api-key not valid provider-secret','يرفض'],['cannot be decrypted provider-secret','تعذر قراءة'],['provider unavailable provider-secret','توجد مشكلة']]){
    const {payload:p}=await getHealth(environment([healthy,{...healthy,easyOrdersRecoveryLastStatus:'error',easyOrdersRecoveryLastError:error}]));
    assert.equal(p.canonical.errorConnections,1);
    assert.match((await renderGuard(source,p)).html,new RegExp(expected));
  }
  const {payload:limited}=await getHealth(environment([{...healthy,easyOrdersRecoveryLastStatus:'rate_limited'}]));
  assert.match((await renderGuard(source,limited)).html,/تأخير مؤقت/);
  const {payload:waiting}=await getHealth(environment([{}]));
  assert.equal(waiting.status,'waiting_for_short_id');assert.equal((await renderGuard(source,waiting)).html,'');
  const {payload:disconnected}=await getHealth(environment([]));
  assert.match((await renderGuard(source,disconnected)).html,/لا يوجد اتصال/);
  const failedDatabase=environment([]);failedDatabase.PREVIEW_DB={prepare(){throw new Error('database unavailable');}};
  for(const env of [{PREVIEW_APP:{fetch(){}}},{PREVIEW_DB:{}},failedDatabase]){
    const {payload:p,response}=await getHealth(env);assert.equal(response.status,503);
    assert.match((await renderGuard(source,p,{httpOk:false})).html,/تعذر التحقق/);
  }
  assert.match((await renderGuard(source,null,{networkError:true})).html,/تعذر التحقق/);
  const htmlResponse=await production.fetch(new Request('https://app.kun-online.com/'),{ASSETS:{fetch:async()=>new Response('<body><script src="/v2/modules-v121-dashboard-sync-guard.js?v=121.0"></script></body>',{headers:{'Content-Type':'text/html'}})}},{});
  assert.match(await htmlResponse.text(),/modules-v121-dashboard-sync-guard.js\?v=121.1/);
  console.log('Dashboard sync guard regression passed: Preview health, real failures, unavailable source, no Production reads/writes, and cache version.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
