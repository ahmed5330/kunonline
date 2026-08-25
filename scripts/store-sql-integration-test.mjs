import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import worker from '../src/index-commerce-v26.js';

const must=(value,message)=>{if(!value)throw new Error(message);};
const normalize=value=>value===undefined?null:value;

class D1Statement{
  constructor(database,sql){this.database=database;this.sql=sql;this.args=[];}
  bind(...args){this.args=args.map(normalize);return this;}
  statement(){return this.database.prepare(this.sql);}
  async first(column){const row=this.statement().get(...this.args)||null;return column&&row?row[column]:row;}
  async all(){return {results:this.statement().all(...this.args)};}
  async run(){const result=this.statement().run(...this.args);return {success:true,meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)}};}
}
class D1Database{
  constructor(database){this.database=database;}
  prepare(sql){return new D1Statement(this.database,sql);}
  async batch(statements){const results=[];this.database.exec('BEGIN');try{for(const statement of statements)results.push(await statement.run());this.database.exec('COMMIT');return results;}catch(error){this.database.exec('ROLLBACK');throw error;}}
}

const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const names=(await readdir(new URL('../migrations/',import.meta.url))).filter(name=>/^00(0[1-9]|1[0-3])_.*\.sql$/.test(name)).sort();
for(const name of names)database.exec(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));

const env={APP_ENV:'preview',SESSION_SECRET:'store-isolation-integration-secret',DB:new D1Database(database)};
let cookie='';
async function call(path,{method='GET',body,expected=200}={}){
  const headers=new Headers();
  if(cookie)headers.set('Cookie',cookie);
  if(body!==undefined)headers.set('Content-Type','application/json');
  const response=await worker.fetch(new Request(`https://preview.example${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,{});
  const data=await response.json().catch(()=>({}));
  if(response.status!==expected)throw new Error(`${method} ${path}: expected ${expected}, got ${response.status} — ${data.error||JSON.stringify(data)}`);
  const setCookie=response.headers.get('Set-Cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return data;
}

await call('/api/setup',{method:'POST',body:{email:'qa-admin@example.test',password:'QA_Test_Only_2026!'}});
const ensured=await call('/api/preview/ensure-client',{method:'POST',body:{}});
const clientId=ensured.clientId;
const storeA=await call('/api/stores',{method:'POST',expected:201,body:{clientId,name:'SQL Store A',code:'sql-a',isDefault:true}});
const storeB=await call('/api/stores',{method:'POST',expected:201,body:{clientId,name:'SQL Store B',code:'sql-b'}});

const context=await call(`/api/my-store-context?clientId=${encodeURIComponent(clientId)}`);
must(context.allStores&&context.stores.length===2,'Admin store context must expose both stores');

async function createStoreFixtures(storeId,suffix,phone){
  const product=await call('/api/products',{method:'POST',body:{clientId,storeId,id:`SQL-P-${suffix}`,name:`SQL Product ${suffix}`,sku:`SQL-${suffix}`,price:250,cost:100,stock:20,lowStockThreshold:2}});
  const customer=await call('/api/customers',{method:'POST',expected:201,body:{clientId,storeId,name:`SQL Customer ${suffix}`,phone,address:'QA address'}});
  const supplier=await call('/api/suppliers',{method:'POST',body:{clientId,storeId,name:`SQL Supplier ${suffix}`,phone}});
  const orderResponse=await call('/api/orders',{method:'POST',body:{clientId,storeId,id:`SQL-O-${suffix}`,date:new Date().toISOString().slice(0,10),name:`SQL Customer ${suffix}`,phone,product:`SQL Product ${suffix}`,productId:product.id,total:250,qty:1,state:'pending'}}),order=orderResponse.order;
  const campaign=await call('/api/campaigns',{method:'POST',expected:201,body:{clientId,storeId,name:`SQL Campaign ${suffix}`,platform:'meta',spend:100,revenue:350}});
  const session=await call('/api/pos/sessions',{method:'POST',expected:201,body:{clientId,storeId,registerName:`Register ${suffix}`,openingCash:100}});
  const sale=await call('/api/pos/sales',{method:'POST',expected:201,body:{clientId,storeId,sessionId:session.id,items:[{productId:product.id,qty:1}],paymentMethod:'cash'}});
  const invoice=await call('/api/procurement/invoices',{method:'POST',expected:201,body:{clientId,storeId,supplierId:supplier.id,subtotal:500,total:500}});
  await call('/api/procurement/payments',{method:'POST',expected:201,body:{clientId,storeId,supplierId:supplier.id,invoiceId:invoice.id,amount:200,method:'cash'}});
  const workflow=await call('/api/workflows',{method:'POST',expected:201,body:{clientId,storeId,name:`SQL Workflow ${suffix}`,triggerType:'order.created',actions:[{type:'notify_team'}],active:true}});
  await call(`/api/workflows/${encodeURIComponent(workflow.id)}/dry-run`,{method:'POST',expected:201,body:{clientId,storeId,context:{}}});
  await call('/api/ai/insights/generate',{method:'POST',body:{clientId,storeId}});
  return {product,customer,supplier,order,campaign,session,sale,workflow};
}

const a=await createStoreFixtures(storeA.id,'A','01000000101');
const b=await createStoreFixtures(storeB.id,'B','01000000102');

for(const [storeId,own,foreign] of [[storeA.id,a,b],[storeB.id,b,a]]){
  const query=`clientId=${encodeURIComponent(clientId)}&storeId=${encodeURIComponent(storeId)}`;
  const products=await call(`/api/products?${query}`);
  must(products.some(row=>row.id===own.product.id)&&!products.some(row=>row.id===foreign.product.id),'Product list leaked across stores');
  const orders=await call(`/api/state?${query}`);
  must(orders.orders.some(row=>row.id===own.order.id)&&!orders.orders.some(row=>row.id===foreign.order.id),`Order state leaked across stores: expected ${own.order.id}, excluded ${foreign.order.id}, got ${(orders.orders||[]).map(row=>row.id).join(',')}`);
  const suppliers=await call(`/api/suppliers?${query}`);
  must(suppliers.some(row=>row.id===own.supplier.id)&&!suppliers.some(row=>row.id===foreign.supplier.id),'Supplier list leaked across stores');
  const campaigns=await call(`/api/campaigns?${query}`);
  must(campaigns.some(row=>row.id===own.campaign.id)&&!campaigns.some(row=>row.id===foreign.campaign.id),'Campaign list leaked across stores');
  const sessions=await call(`/api/pos/sessions?${query}`);
  must(sessions.some(row=>row.id===own.session.id)&&!sessions.some(row=>row.id===foreign.session.id),'POS sessions leaked across stores');
  const balances=await call(`/api/procurement/supplier-balances?${query}`);
  must(balances.some(row=>row.supplier_id===own.supplier.id)&&!balances.some(row=>row.supplier_id===foreign.supplier.id),'Supplier finance leaked across stores');
  const workflows=await call(`/api/workflows?${query}`);
  must(workflows.some(row=>row.id===own.workflow.id)&&!workflows.some(row=>row.id===foreign.workflow.id),'Workflows leaked across stores');
}

const crossSale=await call('/api/pos/sales',{method:'POST',expected:400,body:{clientId,storeId:storeB.id,sessionId:b.session.id,items:[{productId:a.product.id,qty:1}],paymentMethod:'cash'}});
must(/غير موجود/.test(crossSale.error),'Cross-store POS product must be rejected');
const auditRows=database.prepare("SELECT store_id,action FROM audit_log WHERE client_id=? AND action IN ('customer.create','campaign.create','pos.sale.create')").all(clientId);
must(auditRows.some(row=>row.store_id===storeA.id)&&auditRows.some(row=>row.store_id===storeB.id),'Store-scoped audit evidence missing');

console.log('Store-scoped SQLite integration flows passed for orders, inventory, suppliers, finance, campaigns, POS, workflows, AI and audit.');
