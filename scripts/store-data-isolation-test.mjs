import {readFile} from 'node:fs/promises';
import {resolveStoreScope,scopeRequest,listMyStores,isStoreScopedPath} from '../src/store-scope.js';

const must=(value,message)=>{if(!value)throw new Error(message);};
const expectCode=async(fn,code)=>{
  try{await fn();}catch(error){must(error.code===code,`Expected ${code}, got ${error.code||error.message}`);return;}
  throw new Error(`Expected ${code}`);
};

const stores=[
  {id:'STORE-A',client_id:'CLIENT-1',name:'Store A',code:'A',status:'active',is_default:1},
  {id:'STORE-B',client_id:'CLIENT-1',name:'Store B',code:'B',status:'active',is_default:0}
];
const access=[
  {user_id:'OPS-1',client_id:'CLIENT-1',store_id:'STORE-A',role:'manager'},
  {user_id:'VIEW-1',client_id:'CLIENT-1',store_id:'STORE-B',role:'viewer'},
  {user_id:'MULTI-1',client_id:'CLIENT-1',store_id:'STORE-A',role:'member'},
  {user_id:'MULTI-1',client_id:'CLIENT-1',store_id:'STORE-B',role:'member'}
];

class Statement{
  constructor(sql){this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){
    if(this.sql.includes('FROM stores WHERE id=?')){
      return stores.find(row=>row.id===this.args[0]&&row.client_id===this.args[1])||null;
    }
    return null;
  }
  async all(){
    if(this.sql.includes('FROM user_store_access a')){
      const [userId,clientId]=this.args;
      const results=access.filter(row=>row.user_id===userId&&row.client_id===clientId).map(row=>{
        const store=stores.find(item=>item.id===row.store_id);
        return this.sql.includes('SELECT s.id')?{...store,role:row.role}:{...row,name:store.name,status:store.status};
      });
      return {results};
    }
    if(this.sql.includes('FROM stores WHERE client_id=?')){
      return {results:stores.filter(row=>row.client_id===this.args[0]).map(row=>({...row,role:'owner'}))};
    }
    return {results:[]};
  }
}
const env={DB:{prepare:sql=>new Statement(sql)}};

const admin={uid:'ADMIN',role:'admin'};
const ops={uid:'OPS-1',role:'ops',clientId:'CLIENT-1'};
const viewer={uid:'VIEW-1',role:'viewer',clientId:'CLIENT-1'};
const multi={uid:'MULTI-1',role:'support',clientId:'CLIENT-1'};

let scope=await resolveStoreScope(env,admin,'CLIENT-1',null);
must(scope.unrestricted&&scope.storeId===null,'Admin must be able to inspect all stores');
scope=await resolveStoreScope(env,admin,'CLIENT-1','STORE-B');
must(scope.storeId==='STORE-B'&&!scope.unrestricted,'Admin selection must be enforced');
scope=await resolveStoreScope(env,ops,'CLIENT-1',null);
must(scope.storeId==='STORE-A'&&scope.storeRole==='manager','Single-store user must be pinned automatically');
scope=await resolveStoreScope(env,viewer,'CLIENT-1','STORE-B');
must(scope.storeId==='STORE-B','Viewer must read its assigned store');
await expectCode(()=>resolveStoreScope(env,viewer,'CLIENT-1','STORE-B',{write:true}),'STORE_READ_ONLY');
await expectCode(()=>resolveStoreScope(env,viewer,'CLIENT-1','STORE-A'),'STORE_ISOLATION');
await expectCode(()=>resolveStoreScope(env,multi,'CLIENT-1',null),'STORE_SELECTION_REQUIRED');
await expectCode(()=>resolveStoreScope(env,{...ops,clientId:'CLIENT-2'},'CLIENT-1','STORE-A'),'TENANT_ISOLATION');

const scoped=await scopeRequest(new Request('https://preview.example/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:'CLIENT-1',name:'QA Product'})}),env,ops,'CLIENT-1');
const scopedBody=await scoped.request.json();
must(scopedBody.storeId==='STORE-A','Store scope must be injected into write bodies');
must(scoped.request.headers.get('X-Kun-Store-Id')==='STORE-A','Store scope header must be injected');
must(new URL(scoped.request.url).searchParams.get('storeId')==='STORE-A','Store scope query must be injected');

const own=await listMyStores(env,viewer,'CLIENT-1');
must(!own.allStores&&own.stores.length===1&&own.stores[0].id==='STORE-B','Store picker must expose only assigned stores');
for(const path of ['/api/orders','/api/products/stock-log','/api/pos/sales','/api/campaigns','/api/procurement/supplier-balances','/api/profit-intelligence','/api/ai/insights']){
  must(isStoreScopedPath(path),`${path} must be store-scoped`);
}

const [migration,v26,base,pos,campaigns,procurement,workflowUi]=await Promise.all([
  readFile(new URL('../migrations/0013_store_data_scope.sql',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v26.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v9.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v8.js',import.meta.url),'utf8'),
  readFile(new URL('../src/index-commerce-v14.js',import.meta.url),'utf8'),
  readFile(new URL('../public/v2/client-context-v23.js',import.meta.url),'utf8')
]);
for(const table of ['orders','customers','products','product_variants','stock_log','suppliers','purchase_orders','pos_sessions','pos_sales','marketing_campaigns','workflow_runs','approval_requests','ai_action_requests']){
  must(migration.includes(`ALTER TABLE ${table} ADD COLUMN store_id TEXT`),`${table} migration scope missing`);
}
must(migration.includes('UPDATE orders SET store_id='),'Existing orders need deterministic backfill');
must(migration.includes('idx_customers_store_phone'),'Customer duplicate prevention must be per store');
must(v26.includes("u.pathname==='/api/my-store-context'"),'Store picker endpoint missing');
must(v26.includes('enforceStoreScope(request,env,me,clientId)'),'Top-level API store enforcement missing');
must(base.includes('FROM orders WHERE client_id = ? AND store_id = ?'),'Order reads must filter by store');
must(base.includes('FROM products WHERE client_id = ? AND store_id = ?'),'Product reads must filter by store');
must(pos.includes('AND (? IS NULL OR store_id=?)'),'POS must validate store membership');
must(campaigns.includes('store_id'),'Campaign queries must carry store scope');
must(procurement.includes('s.store_id=?'),'Supplier balance report must filter its root supplier rows');
must(workflowUi.includes('/api/my-store-context'),'UI must resolve server-authorized stores');
must(workflowUi.includes('kunActiveStore:'),'UI store selection must be tenant-specific');

console.log('Store data isolation unit and contract checks passed.');
