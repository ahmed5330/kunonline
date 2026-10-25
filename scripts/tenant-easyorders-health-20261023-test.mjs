import assert from 'node:assert/strict';
import {handleTenantEasyOrdersHealth} from '../src/tenant-easyorders-health.js';

const rows=[
  {id:'conn-a',client_id:'tenant-a',provider:'easyorders',status:'connected',config_json:JSON.stringify({storeId:'a-1',easyOrdersRecoveryLastStatus:'error',easyOrdersRecoveryLastError:'HTTP 401 invalid api key'})},
  {id:'conn-b',client_id:'tenant-b',provider:'easyorders',status:'connected',config_json:JSON.stringify({storeId:'b-1',easyOrdersRecoveryHighestShortId:10,easyOrdersRecoveryCursor:11})},
  {id:'conn-a2',client_id:'tenant-a',provider:'easyorders',status:'connected',config_json:JSON.stringify({storeId:'a-2',easyOrdersRecoveryHighestShortId:10,easyOrdersRecoveryCursor:11,easyOrdersRecoveryLastRunAt:new Date().toISOString()})}
];
let reads=0,queries=[];
const env={DB:{prepare(sql){
  const statement={params:[],
    bind(...params){this.params=params;return this;},
    async first(){
      reads++;queries.push({sql,params:this.params});
      if(!sql.includes('FROM stores'))throw Error('Unexpected SELECT');
      const [storeId,clientId]=this.params;
      return (storeId.startsWith('a-')&&clientId==='tenant-a')?{id:storeId}:null;
    },
    async all(){
      reads++;queries.push({sql,params:this.params});
      if(!sql.includes('FROM store_connections'))throw Error('Unexpected connection query');
      return {results:rows.filter(row=>row.client_id===this.params[0])};
    }
  };return statement;
}}};
const req=(params='',method='GET')=>new Request('https://fixture.invalid/api/integrations/easyorders/dashboard-health'+params,{method});
const authorize=async()=>({role:'client',clientId:'tenant-a'});
async function call(request,auth=authorize){return handleTenantEasyOrdersHealth(request,env,{authorize:auth});}
assert.equal(await call(new Request('https://fixture.invalid/api/other')),null);
assert.equal((await call(req(),async()=>null)).status,401);
assert.equal((await call(req(),async()=>({role:'admin'}))).status,403);
assert.equal((await call(req(),async()=>({role:'viewer',clientId:'tenant-a'}))).status,403);
assert.equal((await call(req('', 'POST'))).status,405);
assert.equal(reads,0,'no DB access for unauthorized callers');
let first=await call(req('?clientId=tenant-b'));assert.equal(first.status,200);
let data=await first.json();
assert.equal(data.scope,'client');assert.equal(data.source,'tenant');
assert.equal(data.connections,2,'query-supplied cross-tenant ID must never change the authorized account');
assert.equal(data.runtimeDiagnostics.failureCode,'EASYORDERS_API_KEY_INVALID');
assert.equal(JSON.stringify(data).includes('tenant-b'),false,'never return tenant IDs');
assert.equal(JSON.stringify(data).includes('HTTP 401'),false,'never return connection error details');
const sql=queries.find(x=>x.sql.includes('FROM store_connections'));
assert.deepEqual(sql.params,['tenant-a'],'connection query must use server session tenant');
const scoped=await (await call(req('?storeId=a-2'))).json();
assert.equal(scoped.connections,1);
assert.equal(scoped.status,'healthy','other stores in same tenant do not contaminate the selected store');
// Only the selected owner's connection may decide whether recovery is stale.
// A second tenant's outage cannot poison the active customer's dashboard.
const chosen=rows.find(row=>row.id==='conn-a2');
const recentConfig=JSON.parse(chosen.config_json);
assert.equal(scoped.runtimeDiagnostics.failureCode,null);
const staleConfig={...recentConfig,easyOrdersRecoveryLastRunAt:'2026-10-23T00:00:00.000Z'};
chosen.config_json=JSON.stringify(staleConfig);
const stale=await (await call(req('?storeId=a-2'))).json();
assert.equal(stale.status,'scheduler_stale');
assert.equal(stale.runtimeDiagnostics.failureCode,'EASYORDERS_RECOVERY_STALE');
assert.equal(stale.runtimeDiagnostics.staleRecoveryConnections,1);
assert.equal(stale.runtimeDiagnostics.staleAfterMinutes,20);
assert.equal(stale.connections,1);
assert.doesNotMatch(JSON.stringify(stale),/tenant-a|tenant-b|conn-a2|config_json|lastError/);
chosen.config_json=JSON.stringify({...recentConfig,easyOrdersRecoveryLastRunAt:null});
const never=await (await call(req('?storeId=a-2'))).json();
assert.equal(never.status,'scheduler_stale');
assert.equal(never.runtimeDiagnostics.neverRanRecoveryConnections,1);
chosen.config_json=JSON.stringify(recentConfig);
const clear=await (await call(req('?storeId=a-2'))).json();
assert.equal(clear.status,'healthy');
assert.equal(clear.runtimeDiagnostics.staleRecoveryConnections,0);
// In account-wide summaries explicit API-key errors remain the highest
// priority; a missed heartbeat must not mask a broken integration key.
const whole=await (await call(req())).json();
assert.equal(whole.runtimeDiagnostics.failureCode,'EASYORDERS_API_KEY_INVALID');

const rejected=await call(req('?storeId=b-1'));
assert.equal(rejected.status,403,'cannot scope to another tenant store');
assert.equal((await call(req('?storeId=a'.repeat(150)))).status,403,'oversized store identifiers are rejected');
const empty=await (await call(req('?storeId=a-3'))).json();
assert.equal(empty.status,'no_connections','the selected store with no connection has its own clear state');
console.log('SYNC-01 synthetic tenant health PASS: anonymous/staff denied, client scope fixed, store isolation, no global false warning.');
