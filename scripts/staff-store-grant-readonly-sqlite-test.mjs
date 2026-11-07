/* Contract test of the exact GitHub live ACL audit SQL against synthetic SQLite.
   No Cloudflare credentials, no real customer data, no remote requests or writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleMobileStoreOptions} from '../src/mobile-store-options.js';
import {handleProductionClientContext} from '../src/production-client-context.js';

const yaml=readFileSync(new URL('../.github/workflows/staff-store-grant-readonly-audit.yml',import.meta.url),'utf8');
function auditQuery(name){
  const expression=new RegExp('const '+name+'=await select\\(\\`([\\s\\S]*?)\\`\\);');
  const match=yaml.match(expression);
  assert(match,'Unable to locate live read-only '+name+' SQL');
  assert.match(match[1],/^\\s*SELECT\\b/i,'Live ACL audit must only SELECT');
  assert.doesNotMatch(match[1],/;\\s*\\S|\\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|ATTACH|PRAGMA)\\b/i);
  return match[1];
}
const db=new DatabaseSync(':memory:');
try{
  db.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,status TEXT);
CREATE TABLE stores(id TEXT PRIMARY KEY,client_id TEXT,name TEXT,status TEXT,is_default INTEGER,code TEXT);
CREATE TABLE user_store_access(user_id TEXT,client_id TEXT,store_id TEXT,role TEXT);
CREATE TABLE state(id INTEGER PRIMARY KEY,json TEXT);
`);
  const execute=(sql,args=[])=>db.prepare(sql).run(...args);
  execute('INSERT INTO users VALUES(?,?,?,?)',['U-TESTER','تيستر','support','active']);
  execute('INSERT INTO users VALUES(?,?,?,?)',['U-OTHER','Other synthetic','ops','active']);
  for(const s of [
    ['A','C1','Store A','active',1,'A'],
    ['B','C2','Store B','active',1,'B'],
    ['C','C3','Inactive Store','inactive',1,'C'],
    ['E','C2','Other user store','active',0,'E']
  ])execute('INSERT INTO stores VALUES(?,?,?,?,?,?)',s);
  for(const access of [
    ['U-TESTER','C1','A','member'],['U-TESTER','C2','B','manager'],
    ['U-TESTER','C3','C','member'],['U-TESTER','C4','MISSING','member'],
    ['U-OTHER','C2','E','member']
  ])execute('INSERT INTO user_store_access VALUES(?,?,?,?)',access);
  execute('INSERT INTO state VALUES(1,?)',[JSON.stringify({clients:[{id:'C1',name:'Client One'},{id:'C2',name:'Client Two'}]})]);
  const staff=db.prepare(auditQuery('staff')).get();
  assert.equal(staff.staff_accounts,2);
  assert.equal(staff.no_active_grants,0);
  assert.equal(staff.multiple_active_stores,1);
  assert.equal(staff.cross_client_staff,1);
  assert.equal(staff.with_stale_grants,1);
  const tester=db.prepare(auditQuery('tester')).get();
  assert.equal(tester.matching_accounts,1);
  assert.equal(tester.saved_grants,4);
  assert.equal(tester.active_grants,2);
  assert.equal(tester.active_client_scopes,2);

  const sqlLog=[];
  const env={DB:{prepare(sql){
    assert(/^\\s*SELECT\\b/i.test(sql),'No staff discovery test should write any row');
    sqlLog.push(sql);
    return {
      bind(...args){return {
        async first(){return db.prepare(sql).get(...args)||null;},
        async all(){return {results:db.prepare(sql).all(...args)};}
      };},
      async first(){return db.prepare(sql).get()||null;},
      async all(){return {results:db.prepare(sql).all()};}
    };
  }}};
  const request=new Request('https://app.kun-online.com/api/mobile/store-options?diagnostics=1',{
    headers:{Cookie:'ko_session=SYNTHETIC'}
  });
  let identity={role:'support',uid:'U-TESTER',clientId:'C1'};
  const authDelegate={async fetch(req){
    assert.equal(new URL(req.url).pathname,'/api/me');
    return Response.json(identity||{role:null},{status:identity?200:401});
  }};
  const delegate={async fetch(req){
    const route=new URL(req.url).pathname;
    if(route==='/api/me')return authDelegate.fetch(req);
    if(route==='/api/my-client-context')return handleProductionClientContext({request:req,env,delegate:authDelegate});
    throw Error('Unexpected self-only route '+route);
  }};
  let response=await handleMobileStoreOptions({request,env,delegate});
  assert.equal(response.status,200);
  let data=await response.json();
  assert.deepEqual(data.stores.map(s=>s.storeId),['A','B'],
    'Staff sees all assigned ACTIVE stores across clients, not stale/inactive/other-user grants');
  assert.deepEqual(data.stores.map(s=>s.clientId),['C1','C2']);
  assert.equal(data.diagnostics.totalGrants,4);
  assert.equal(data.diagnostics.activeGrants,2);
  assert.equal(data.diagnostics.inactiveGrants,1);
  assert.equal(data.diagnostics.missingStores,1);
  assert.equal(data.diagnostics.visibleStores,2);
  assert(!JSON.stringify(data).includes('U-TESTER'),'Never return staff user ID in picker response');
  assert(sqlLog.some(sql=>sql.includes('a.user_id=?')&&sql.includes("s.status='active'")),
    'Store discovery is scoped to authenticated staff and active grants');

  identity={role:'client',uid:'OWNER-1',clientId:'C1'};
  response=await handleMobileStoreOptions({request,env,delegate});
  data=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(data.stores.map(s=>s.storeId),['A'],'Store owner cannot access another client');

  identity={role:'support',uid:'U-OTHER',clientId:'C1'};
  response=await handleMobileStoreOptions({request,env,delegate});
  data=await response.json();
  assert.deepEqual(data.stores.map(s=>s.storeId),['E'],
    'Another member receives only own explicit active grants');

  identity={role:'support',clientId:'C1'}; // no authenticated user id
  response=await handleMobileStoreOptions({request,env,delegate});
  assert.equal(response.status,403,'No uid must fail closed, never read all stores');

  identity=null;
  response=await handleMobileStoreOptions({request,env,delegate});
  assert.equal(response.status,401);
  console.log('PASS synthetic staff ACL SQL: cross-client tester grants, live picker scope, inactive/orphan denied, owner bound, no UID denied');
}finally{
  db.close();
}
