import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sha256,handleKunMcpOAuth,KUN_MCP_RESOURCE,KUN_MCP_ORIGIN} from '../src/kun-chatgpt-mcp-oauth.js';
import {runKunMcpTool,KUN_MCP_TOOLS,handleKunMcpServer} from '../src/kun-chatgpt-mcp-server.js';

const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const call=(path,opts={})=>new Request(KUN_MCP_ORIGIN+path,opts);
const delegate={fetch:async()=>new Response(JSON.stringify({role:'client',uid:'user-a',clientId:'tenant-a'}))};
const noAuth={fetch:async()=>new Response(JSON.stringify({role:null}),{status:401})};
const fakeDB={
 prepare(sql){return {bind(...args){return {
  async all(){
   if(sql.includes('FROM stores WHERE client_id=?'))return {results:[{id:'store-a',name:'Store A',status:'active'}]};
   if(sql.includes('FROM orders o')&&sql.includes('GROUP BY o.state'))return {results:[{state:'pending',orders:12,amount:1200},{state:'cancelled',orders:3,amount:300}]};
   if(sql.includes('FROM orders o')&&sql.includes('GROUP BY product'))return {results:[{product:'سجادة صلاة',units:8,orders:6}]};
   if(sql.includes('FROM kun_mcp_refresh WHERE'))return {results:[]};
   throw Error('Unexpected all SQL '+sql);
  },
  async first(){
   if(sql.includes('FROM meta_ad_daily_metrics')){assert.equal(args[0],'tenant-a');assert.equal(args[1],'store-a');assert.match(sql,/level='adset'/);return {spend:225,reportedDays:10,metricRows:14};}
   if(sql.includes('FROM stores WHERE id=? AND client_id=?'))return {id:'store-a',name:'Store A',status:'active'};
   if(sql.includes('FROM users WHERE id=? AND client_id=?'))return {id:'user-a',status:'active',role:'client'};
   return null;
  },
  async run(){return {meta:{changes:1}}}
 };}};},
 batch:async statements=>Promise.all(statements.map(s=>s.run()))
};
const env={DB:fakeDB};
const meta=await handleKunMcpOAuth({request:call('/.well-known/oauth-protected-resource'),env,delegate});
const metaJson=await meta.json();assert.equal(metaJson.resource,KUN_MCP_RESOURCE);
assert.equal(metaJson.authorization_servers[0],KUN_MCP_ORIGIN);
const oauth=await handleKunMcpOAuth({request:call('/.well-known/oauth-authorization-server'),env,delegate});
const oauthJson=await oauth.json();assert.equal(oauthJson.client_id_metadata_document_supported,true);
assert.deepEqual(oauthJson.code_challenge_methods_supported,['S256']);
assert.deepEqual(oauthJson.token_endpoint_auth_methods_supported,['none']);
assert.equal(oauthJson.authorization_response_iss_parameter_supported,true);
assert.ok(!('registration_endpoint' in oauthJson),'No open dynamic registration vulnerability');
const challenge='A'.repeat(43);
const goodQuery=new URLSearchParams({client_id:'https://chatgpt.com/oauth/client.json',
 redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:KUN_MCP_RESOURCE,
 response_type:'code',code_challenge:challenge,code_challenge_method:'S256',scope:'kun:read',state:'safe'});
const html=await handleKunMcpOAuth({request:call('/oauth/authorize?'+goodQuery),env,delegate});
assert.equal(html.status,200);
const consent=await html.text();assert.match(consent,/موافقة وربط المتجر/);assert.match(consent,/store-a/);
assert.match(html.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
const blocked=await handleKunMcpOAuth({request:call('/oauth/authorize?'+goodQuery),env,delegate:noAuth});
assert.equal(blocked.status,401);
const badClient=new URLSearchParams(goodQuery);badClient.set('client_id','https://bad.example.com/oauth/client.json');
const forbidden=await handleKunMcpOAuth({request:call('/oauth/authorize?'+badClient),env,delegate});
assert.equal(forbidden.status,400);
const badRedirect=new URLSearchParams(goodQuery);badRedirect.set('redirect_uri','https://phishing.example.org/oauth/callback');
const redirectBlocked=await handleKunMcpOAuth({request:call('/oauth/authorize?'+badRedirect),env,delegate});
assert.equal(redirectBlocked.status,400);
const noPkce=new URLSearchParams(goodQuery);noPkce.set('code_challenge_method','plain');
assert.equal((await handleKunMcpOAuth({request:call('/oauth/authorize?'+noPkce),env,delegate})).status,400);
const csrfBody=new URLSearchParams(goodQuery);csrfBody.set('csrf','WRONG');csrfBody.set('store_id','store-a');
const csrfReject=await handleKunMcpOAuth({request:call('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':KUN_MCP_ORIGIN},body:csrfBody}),env,delegate});
assert.equal(csrfReject.status,403);
const unauthorizedMcp=await handleKunMcpServer({request:call('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env});
assert.equal(unauthorizedMcp.status,401);
assert.match(unauthorizedMcp.headers.get('www-authenticate'),/resource_metadata=/);
assert.equal(KUN_MCP_TOOLS.length,4);
assert.ok(KUN_MCP_TOOLS.every(x=>x.annotations.readOnlyHint&&x.securitySchemes[0].scopes[0]==='kun:read'));
const auth={clientId:'tenant-a',storeId:'store-a',storeName:'Store A',userId:'user-a'};
const overview=await runKunMcpTool(env,auth,'get_store_overview',{days:30});
assert.equal(overview.orders.total,15);assert.equal(overview.orders.grossOrderValue,1500);
assert.equal(overview.orders.cancellationRate,20);
assert.equal(overview.advertising.reportedSpend,225);
assert.equal(overview.advertising.available,true);
assert.equal(Object.hasOwn(overview.store,'id'),false,'never disclose internal store IDs to ChatGPT');
assert.equal(overview.orders.notFinancialRevenue,true);
const missingSpend=await runKunMcpTool({...env,DB:{prepare:sql=>({bind:(...args)=>({first:async()=>({spend:0,reportedDays:0,metricRows:0})})})}},auth,'get_ads_spend',{days:7});
assert.equal(missingSpend.advertising.available,false);
assert.equal(missingSpend.advertising.reportedSpend,null,'no imported rows must not be represented as actual zero spend');
const funnel=await runKunMcpTool(env,auth,'get_order_funnel',{days:7});
assert.equal(funnel.states[0].state,'pending');
const product=await runKunMcpTool(env,auth,'get_top_products',{days:14});
assert.equal(product.products[0].units,8);
for(const bad of [{days:91},{days:0},{days:'30'},{days:30,clientId:'tenant-b'},{days:7,storeId:'store-b'},{}]){
 if(Object.keys(bad).length===0)continue;
 await assert.rejects(runKunMcpTool(env,auth,'get_store_overview',bad));
}
assert.match(read('src/kun-chatgpt-mcp-server.js'),/o\.client_id=\? AND o\.store_id=\?/,'All orders must filter by both client and store');
assert.match(read('src/kun-chatgpt-mcp-oauth.js'),/WHERE token_hash=\? AND revoked_at IS NULL AND expires_at>\?/,'Tokens must expire and be revocable');
assert.match(read('src/kun-chatgpt-mcp-oauth.js'),/UPDATE kun_mcp_codes SET used_at=\?/,'Authorization codes must be one time');
assert.match(read('src/kun-chatgpt-mcp-oauth.js'),/UPDATE kun_mcp_refresh SET revoked_at=\?/,'Refresh tokens must rotate');
assert.match(read('src/kun-chatgpt-mcp-oauth.js'),/owner\.role!=='client'/,'Only owner identity on bearer tool calls');
assert.match(read('src/index-production-mobile-update.js'),/handleKunMcpOAuth/);
assert.match(read('src/index-production-mobile-update.js'),/handleKunMcpServer/);
assert.match(read('public/v2/modules-v16.js'),/KunChatgptMcpV161\?\.mount/);
assert.match(read('public/v2/index.html'),/modules-v161-chatgpt-mcp\.js\?v=161\.0/);
const manager=read('public/v2/modules-v161-chatgpt-mcp.js');
assert.match(manager,/إلغاء التفويض/);
assert.doesNotMatch(manager,/localStorage|sessionStorage/);
console.log('PASS: MCP OAuth metadata, PKCE, client/redirect allowlisting, csrf, anonymous 401, four read-only tools, scoped data, token rotation/revocation, UI wiring. Fake tests only, no client data changed.');
