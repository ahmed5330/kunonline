import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AI_PROVIDERS,verifyAiProviderKey} from '../src/ai-integration-provider.js';
import {handleAiIntegrations} from '../src/ai-integrations.js';

const good={ai_openai:{data:[{id:'gpt-test'}]},ai_gemini:{models:[{name:'models/gemini-test'}]},ai_anthropic:{data:[{id:'claude-test'}]},ai_groq:{data:[{id:'llama-test'}]}};
const captured=[];
const mockedFetch=async(url,options)=>{
 const row=AI_PROVIDERS.find(x=>x.endpoint===url);
 assert.ok(row,'only allowlisted provider hosts may be called');
 assert.equal(options.method,'GET','validation must not generate paid content');
 assert.equal(options.redirect,'error','network redirects disabled');
 const sentKey=options.headers.Authorization||options.headers['x-api-key']||options.headers['x-goog-api-key'];
 assert.ok(sentKey,'provider credentials are server-side');
 captured.push({provider:row.id,url,method:options.method,key:sentKey});
 return new Response(JSON.stringify(good[row.id]),{status:200,headers:{'Content-Type':'application/json'}});
};
for(const provider of AI_PROVIDERS){
 const verified=await verifyAiProviderKey({providerId:provider.id,apiKey:'fake-'+provider.id,fetcher:mockedFetch});
 assert.equal(verified.ok,true);assert.equal(verified.status,'connected');assert.equal(verified.externalConnectivityChecked,true);
 assert.ok(verified.modelCountSample>=1);
 assert.ok(!JSON.stringify(verified).includes('fake-'+provider.id),'API key must never appear in results');
}
assert.equal(captured.length,4,'all four models-list endpoints passed the fake test');
for(const httpStatus of [401,403,429,500,503]){
 const failure=await verifyAiProviderKey({providerId:'ai_openai',apiKey:'mock-key',fetcher:()=>new Response('{}',{status:httpStatus})});
 assert.equal(failure.ok,false);
 assert.equal(failure.code,([401,403].includes(httpStatus)?'AI_KEY_REJECTED':httpStatus===429?'AI_RATE_LIMITED':'AI_PROVIDER_UNAVAILABLE'));
 assert.equal(failure.externalConnectivityChecked,true);
}
const offline=await verifyAiProviderKey({providerId:'ai_gemini',apiKey:'fake',fetcher:()=>{throw new Error('network: fake secret');}});
assert.equal(offline.code,'AI_NETWORK_ERROR');
assert.ok(!JSON.stringify(offline).includes('fake secret'),'network errors should be sanitized');
const noKey=await verifyAiProviderKey({providerId:'ai_groq',apiKey:'',fetcher:()=>{throw Error('must not request');}});
assert.equal(noKey.code,'AI_KEY_MISSING');
const zero=await verifyAiProviderKey({providerId:'ai_openai',apiKey:'fake',fetcher:()=>new Response(JSON.stringify({data:[]}))});
assert.equal(zero.code,'AI_NO_AVAILABLE_MODELS');

function fakeDatabase(){
 const connections=[],secrets=[],audits=[];
 const stores=[{id:'store-a',client_id:'tenant-a',name:'وقورة',status:'active',is_default:1,role:'owner'},
  {id:'store-b',client_id:'tenant-b',name:'وفاق',status:'active',is_default:1,role:'owner'}];
 function execute(sql,a,mode){
  const has=text=>sql.includes(text);
  if(has('FROM stores WHERE id=? AND client_id=?')){
   return stores.find(s=>s.id===a[0]&&s.client_id===a[1]&&s.status==='active')||null;
  }
  if(has('FROM stores WHERE client_id=? AND status='))return {results:stores.filter(s=>s.client_id===a[0])};
  if(has('SELECT id FROM store_connections WHERE client_id=? AND provider=? AND external_store_id=?'))
   return connections.find(c=>c.client_id===a[0]&&c.provider===a[1]&&c.external_store_id===a[2])||null;
  if(has("SELECT * FROM store_connections WHERE id=? AND client_id=?"))return connections.find(c=>c.id===a[0]&&c.client_id===a[1])||null;
  if(has('SELECT * FROM store_connections WHERE client_id=? AND provider IN'))return {results:connections.filter(c=>c.client_id===a[0])};
  if(has("SELECT connection_id FROM integration_secrets WHERE client_id=? AND secret_name='api_key'"))
   return {results:secrets.filter(s=>s.client_id===a[0]&&s.secret_name==='api_key').map(x=>({connection_id:x.connection_id}))};
  if(has('SELECT secret_name,ciphertext_b64,iv_b64 FROM integration_secrets'))
   return {results:secrets.filter(s=>s.client_id===a[0]&&s.connection_id===a[1])};
  if(sql.startsWith('INSERT INTO store_connections(')){
   const [id,client_id,provider,store_name,external_store_id,status,scopes_json,config_json,created_at,updated_at]=a;
   connections.push({id,client_id,provider,store_name,external_store_id,status,scopes_json,config_json,created_at,updated_at,last_sync_at:null,last_error:null});
   return {meta:{changes:1}};
  }
  if(sql.startsWith('UPDATE store_connections SET store_name=')){
   const [store_name,config_json,updated_at,id,clientId]=a;
   const row=connections.find(x=>x.id===id&&x.client_id===clientId);
   Object.assign(row,{store_name,config_json,updated_at,status:'configured',last_error:null,last_sync_at:null});
   return {meta:{changes:1}};
  }
  if(sql.startsWith('INSERT INTO integration_secrets')){
   const [id,client_id,connection_id,secret_name,ciphertext_b64,iv_b64,created_at,updated_at]=a;
   let row=secrets.find(x=>x.client_id===client_id&&x.connection_id===connection_id&&x.secret_name===secret_name);
   if(!row){row={id,client_id,connection_id,secret_name};secrets.push(row);}
   Object.assign(row,{ciphertext_b64,iv_b64,created_at,updated_at});return {meta:{changes:1}};
  }
  if(sql.startsWith('UPDATE store_connections SET status=')){
   const [status,last_sync_at,last_error,config_json,updated_at,id,clientId]=a;
   const row=connections.find(x=>x.id===id&&x.client_id===clientId);
   Object.assign(row,{status,last_sync_at,last_error,config_json,updated_at});return {meta:{changes:1}};
  }
  if(sql.startsWith('DELETE FROM integration_secrets')){
   for(let i=secrets.length-1;i>=0;i--)if(secrets[i].client_id===a[0]&&secrets[i].connection_id===a[1])secrets.splice(i,1);
   return {meta:{changes:1}};
  }
  if(sql.startsWith('DELETE FROM store_connections')){
   for(let i=connections.length-1;i>=0;i--)if(connections[i].client_id===a[0]&&connections[i].id===a[1])connections.splice(i,1);
   return {meta:{changes:1}};
  }
  if(sql.startsWith('INSERT INTO audit_log')){audits.push(a);return {meta:{changes:1}};}
  throw Error('Unexpected SQL: '+sql.slice(0,200));
 }
 const DB={prepare(sql){return {bind(...a){return {first:async()=>execute(sql,a,'first'),all:async()=>execute(sql,a,'all'),run:async()=>execute(sql,a,'run')}}};},batch:async(stmts)=>{for(const s of stmts)await s.run();}};
 return {DB,connections,secrets,audits};
}
const mock=fakeDatabase();
const env={DB:mock.DB,APP_ENV:'preview',SESSION_SECRET:'mock-session-used-only-to-encrypt-qa-keys'};
const delegateFor=me=>({fetch:async()=>new Response(JSON.stringify(me),{status:200})});
const delegateA=delegateFor({uid:'owner-a',role:'client',clientId:'tenant-a'}),delegateB=delegateFor({uid:'owner-b',role:'client',clientId:'tenant-b'});
const endpoint='https://app.kun-online.com/api/integrations/ai';
async function call(delegate,path,method='GET',body,fetcher=mockedFetch){
 const req=new Request(endpoint+path,{method,headers:{'Content-Type':'application/json','Origin':'https://app.kun-online.com'},body:body===undefined?undefined:JSON.stringify(body)});
 const r=await handleAiIntegrations({request:req,env,delegate,fetcher});return {status:r.status,data:await r.json()};
}
let created=await call(delegateA,'/connect','POST',{provider:'ai_openai',storeId:'store-a',clientId:'tenant-a',apiKey:'secret-a'});
assert.equal(created.status,200);assert.equal(created.data.ok,true);
const idA=created.data.connectionId;
assert.equal(mock.connections[0].external_store_id,'kunai:ai_openai:store-a');
assert.ok(!JSON.stringify(mock.connections).includes('secret-a'),'store_connections must never contain API keys');
assert.ok(!JSON.stringify(mock.secrets).includes('secret-a'),'integration_secrets must be encrypted');
assert.ok(mock.secrets[0].ciphertext_b64&&mock.secrets[0].iv_b64);
let validated=await call(delegateA,'/connections/'+encodeURIComponent(idA)+'/validate','POST',{clientId:'tenant-a'});
assert.equal(validated.data.status,'connected');assert.equal(validated.data.modelsPreview[0],'gpt-test');
assert.ok(!JSON.stringify(validated).includes('secret-a'));
let visible=await call(delegateA,'?clientId=tenant-a');
assert.equal(visible.data.connections.length,1);
assert.equal(visible.data.connections[0].hasKey,true);
assert.equal(visible.data.connections[0].storeId,'store-a');
assert.equal(Object.hasOwn(visible.data.connections[0],'apiKey'),false);
assert.equal(visible.data.stores.length,1);
let cross=await call(delegateA,'/connections/'+encodeURIComponent(idA)+'/validate','POST',{clientId:'tenant-b'});
assert.equal(cross.status,403,'client A must never be able to target client B');
let crossStore=await call(delegateA,'/connect','POST',{clientId:'tenant-a',provider:'ai_groq',storeId:'store-b',apiKey:'leak'});
assert.equal(crossStore.status,403,'client A must not write client B store');
const second=await call(delegateB,'/connect','POST',{provider:'ai_gemini',storeId:'store-b',clientId:'tenant-b',apiKey:'secret-b'});
assert.equal(second.data.ok,true);
const validatedB=await call(delegateB,'/connections/'+second.data.connectionId+'/validate','POST',{clientId:'tenant-b'});
assert.equal(validatedB.data.status,'connected');
visible=await call(delegateB,'?clientId=tenant-b');
assert.equal(visible.data.connections.length,1);
assert.equal(visible.data.connections[0].provider,'ai_gemini');
assert.ok(!JSON.stringify(visible.data).includes('store-a'));
const wrongId=await call(delegateB,'/connections/'+idA+'/validate','POST',{clientId:'tenant-b'});
assert.equal(wrongId.status,404,'B cannot read A connection ID');
const badKey=await call(delegateA,'/connections/'+idA+'/validate','POST',{clientId:'tenant-a'},async()=>new Response('{}',{status:401}));
assert.equal(badKey.data.code,'AI_KEY_REJECTED');
assert.equal(mock.connections.find(x=>x.id===idA).status,'disconnected');
const origin=new Request(endpoint+'/connect',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.com'},body:JSON.stringify({clientId:'tenant-a',provider:'ai_groq',storeId:'store-a',apiKey:'bad'})});
const evil=await handleAiIntegrations({request:origin,env,delegate:delegateA,fetcher:mockedFetch});
assert.equal(evil.status,403,'cross-origin credential writes denied');
const staff=delegateFor({uid:'support-a',role:'support',clientId:'tenant-a'});
const forbidden=await call(staff,'/connect','POST',{provider:'ai_groq',storeId:'store-a',clientId:'tenant-a',apiKey:'staff-key'});
assert.equal(forbidden.status,403,'support staff cannot create API credentials');
const removed=await call(delegateA,'/connections/'+idA,'DELETE',{clientId:'tenant-a'});
assert.equal(removed.data.removed,true);
assert.equal(mock.secrets.some(x=>x.connection_id===idA),false,'unlink destroys encrypted key');
assert.equal(mock.connections.some(x=>x.id===idA),false,'unlink removes connection');
assert.ok(mock.audits.length>=4);
assert.ok(!JSON.stringify(mock.audits).includes('secret-a'),'audit trail must not reveal token values');

const ui=await readFile(new URL('../public/v2/modules-v160-ai-integrations.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/v2/index.html',import.meta.url),'utf8');
const integrationUI=await readFile(new URL('../public/v2/modules-v16.js',import.meta.url),'utf8');
const production=await readFile(new URL('../src/index-production-mobile-update.js',import.meta.url),'utf8');
const preview=await readFile(new URL('../src/index-commerce-v19.js',import.meta.url),'utf8');
new Function(ui);
assert.match(ui,/type="password"/);
assert.match(ui,/api\/integrations\/ai\/connect/);
assert.match(ui,/\.value=''/,'clear entered secret after saving');
assert.match(ui,/\.disabled=true/,'buttons disabled during requests');
assert.doesNotMatch(ui,/localStorage|sessionStorage/);
assert.match(html,/modules-v160-ai-integrations\.js\?v=160\.0/);
assert.match(html,/kun-ai-integrations-v160\.css\?v=160\.0/);
assert.match(integrationUI,/KunAiIntegrationsV160\?\.mount/);
assert.match(production,/handleAiIntegrations/);
assert.match(preview,/handleAiIntegrations/);
console.log('PASS: 4 provider read-only checks, 5 HTTP errors, network failure, tenant/store isolation, encrypted save, no key leaks, rotate/revoke controls and integrated UI; zero paid generation calls.');
