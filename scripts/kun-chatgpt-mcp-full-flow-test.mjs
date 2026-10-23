import assert from 'node:assert/strict';
import {sha256,handleKunMcpOAuth} from '../src/kun-chatgpt-mcp-oauth.js';
import {handleKunMcpServer} from '../src/kun-chatgpt-mcp-server.js';
const base='https://app.kun-online.com',resource=base+'/mcp';
const codes=new Map(),tokens=new Map(),refreshes=new Map(),stores=[{id:'s1',name:'Store 1',status:'active'}];
function query(sql,a){
 if(sql.startsWith('CREATE'))return {meta:{changes:0}};
 if(sql.includes('FROM stores WHERE client_id'))return {results:stores};
 if(sql.includes('FROM stores WHERE id='))return {id:'s1',name:'Store 1',status:'active'};
 if(sql.includes('FROM users WHERE id='))return {id:'u1',role:'client',status:'active'};
 if(sql.includes('INSERT INTO kun_mcp_codes')){codes.set(a[0],{code_hash:a[0],client_id:a[1],store_id:a[2],user_id:a[3],oauth_client_id:a[4],redirect_uri:a[5],resource:a[6],challenge:a[7],scope:a[8],expires_at:a[9],used_at:null});return {meta:{changes:1}};}
 if(sql.includes('SELECT * FROM kun_mcp_codes'))return codes.get(a[0])||null;
 if(sql.includes('UPDATE kun_mcp_codes')){const r=codes.get(a[1]);if(!r||r.used_at)return {meta:{changes:0}};r.used_at=a[0];return {meta:{changes:1}};}
 if(sql.includes('INSERT INTO kun_mcp_access')||sql.includes('INSERT INTO kun_mcp_refresh')){const table=sql.includes('access')?tokens:refreshes;table.set(a[0],{token_hash:a[0],client_id:a[1],store_id:a[2],user_id:a[3],oauth_client_id:a[4],resource:a[5],scope:a[6],expires_at:a[7],revoked_at:null});return {meta:{changes:1}};}
 if(sql.includes('SELECT * FROM kun_mcp_access'))return tokens.get(a[0])||null;
 if(sql.includes('SELECT * FROM kun_mcp_refresh'))return refreshes.get(a[0])||null;
 if(sql.includes('UPDATE kun_mcp_refresh SET revoked_at=? WHERE token_hash')){const r=refreshes.get(a[1]);if(!r||r.revoked_at)return {meta:{changes:0}};r.revoked_at=a[0];return {meta:{changes:1}};}
 if(sql.includes('SELECT store_id,COUNT(*)'))return {results:[{store_id:'s1',active_links:1}]};
 if(sql.includes('UPDATE kun_mcp_access SET revoked_at=? WHERE client_id=')){for(const r of tokens.values())r.revoked_at=a[0];return {meta:{changes:1}};}
 if(sql.includes('UPDATE kun_mcp_refresh SET revoked_at=? WHERE client_id=')){for(const r of refreshes.values())r.revoked_at=a[0];return {meta:{changes:1}};}
 if(sql.includes('FROM orders o')&&sql.includes('GROUP BY o.state')){assert.deepEqual(a.slice(0,2),['tenant1','s1']);return {results:[{state:'confirmed',orders:3,amount:700}]};}
 if(sql.includes('FROM meta_ad_daily_metrics'))return {spend:100,reportedDays:2,metricRows:4};
 throw Error('Unexpected mock SQL '+sql.slice(0,120));
}
const env={DB:{prepare(sql){return {run:async()=>query(sql,[]),bind(...a){return {run:async()=>query(sql,a),first:async()=>query(sql,a),all:async()=>query(sql,a)}}}},batch:async st=>{for(const s of st)await s.run();}}};
const delegate={fetch:async()=>new Response(JSON.stringify({role:'client',uid:'u1',clientId:'tenant1'}))};
const client='https://chatgpt.com/oauth/client.json',redirect='https://chatgpt.com/connector_platform_oauth_redirect',verifier='V'.repeat(43);
const params=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect,resource,code_challenge:await sha256(verifier),code_challenge_method:'S256',scope:'kun:read',state:'check'});
const req=(p,opts={})=>new Request(base+p,opts);
const authorize=r=>handleKunMcpOAuth({request:r,env,delegate});
const consent=await authorize(req('/oauth/authorize?'+params));
assert.equal(consent.status,200);
const csrf=consent.headers.get('set-cookie').match(/__Host-kun_mcp_csrf=([^;]+)/)[1];
const form=new URLSearchParams(params);form.set('csrf',csrf);form.set('store_id','s1');
const accepted=await authorize(req('/oauth/authorize',{method:'POST',headers:{cookie:'__Host-kun_mcp_csrf='+csrf,origin:base,'content-type':'application/x-www-form-urlencoded'},body:form}));
assert.equal(accepted.status,302);
const callback=new URL(accepted.headers.get('location'));
assert.equal(callback.searchParams.get('state'),'check');
const exchange=async o=>{const r=await authorize(req('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(o)}));return {status:r.status,data:await r.json()};};
const code=callback.searchParams.get('code');
const grant={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,resource,code,code_verifier:verifier};
const issued=await exchange(grant);assert.equal(issued.status,200);
const replay=await exchange(grant);assert.equal(replay.data.error,'invalid_grant');
const rpc=async bearer=>handleKunMcpServer({env,request:req('/mcp',{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'get_store_overview',arguments:{days:7}}})})});
const read=await rpc(issued.data.access_token);assert.equal(read.status,200);
assert.equal((await read.json()).result.structuredContent.orders.total,3);
const rotated=await exchange({grant_type:'refresh_token',client_id:client,resource,refresh_token:issued.data.refresh_token});
assert.equal(rotated.status,200);
assert.equal((await exchange({grant_type:'refresh_token',client_id:client,resource,refresh_token:issued.data.refresh_token})).data.error,'invalid_grant');
const unlink=await authorize(req('/api/integrations/chatgpt',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({storeId:'s1'})}));
assert.equal((await unlink.json()).revoked,true);
assert.equal((await rpc(rotated.data.access_token)).status,401);
console.log('PASS: OAuth consent -> callback -> PKCE exchange -> MCP data -> refresh rotation -> immediate token revocation');
