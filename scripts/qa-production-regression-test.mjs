import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {handleProductionCustomerService} from '../src/production-customer-service.js';
import {handleProductionMobileOrderGuard} from '../src/production-mobile-order-guard.js';
import {reconcileFinancePresentation} from '../src/production-finance-presentation.js';

const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
let catalogCalls=0;
const delegate={fetch:async request=>{
  const url=new URL(request.url);
  if(url.pathname==='/api/me')return json({role:'client',clientId:'test-client'});
  assert.equal(url.pathname,'/api/catalog/products');
  assert.equal(url.searchParams.get('storeId'),'test-store');
  catalogCalls++;
  return json({products:[{id:'p',variants:[{id:'v',stock:1}]}]});
}};
let result=await handleProductionCustomerService({request:new Request('https://test/api/catalog/products?clientId=test-client&storeId=test-store'),env:{},delegate});
assert.equal((await result.json()).products[0].variants[0].stock,1);
result=await handleProductionCustomerService({request:new Request('https://test/api/catalog/products?clientId=other&storeId=test-store'),env:{},delegate});
assert.equal(result.status,403);assert.equal(catalogCalls,1);

for(const phone of ['00000000000','123','01912345678','',null]){
  result=await handleProductionMobileOrderGuard({request:new Request('https://test/api/orders',{method:'POST',body:JSON.stringify({phone})}),env:{}});
  assert.equal(result.status,400);assert.equal((await result.json()).code,'PHONE_INVALID');
}
for(const phone of ['01012345678','+20 1112345678','٠١٢١٢٣٤٥٦٧٨','0512345678']){
  assert.equal(await handleProductionMobileOrderGuard({request:new Request('https://test/api/orders',{method:'POST',body:JSON.stringify({phone})}),env:{}}),null);
}

const dashboard={finance:{expenses:900,netProfit:100,businessShippingExpense:100,expenseBreakdown:{ads:600,admin:200,shipping:400}}};
result=await reconcileFinancePresentation(new Request('https://test/api/dashboard'),json(dashboard),{});
const fixed=await result.json();assert.equal(fixed.finance.expenses,900);assert.equal(fixed.finance.netProfit,100);assert.equal(Object.values(fixed.finance.expenseBreakdown).reduce((a,b)=>a+b,0),900);
const denied=new Response('{}',{status:403});assert.equal(await reconcileFinancePresentation(new Request('https://test/api/accounting/monthly'),denied,{}),denied);
const binds=[];
const env={DB:{prepare:sql=>({bind:(...values)=>{binds.push({sql,values});return {all:async()=>({results:[]})};}})}};
result=await reconcileFinancePresentation(new Request('https://test/api/accounting/monthly?clientId=attacker'),json({ok:true,clientId:'authorized',storeId:'safe',period:{from:'2026-10-01',to:'2026-10-31'},costs:{shipping:55,operatingExpenses:900}}),env);
assert.equal((await result.json()).costs.shipping,0);assert.deepEqual(binds[0].values,['authorized','safe','2026-10-01','2026-10-31']);

// Exercise the operational filter with the actual v27 order buttons and a
// missing legacy button, rather than only checking source selectors.
let active='';const counter={textContent:''},bar={isConnected:true,querySelector:()=>counter};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const row=id=>({dataset:{},querySelector:selector=>selector.includes('data-order-v27')?{dataset:{orderV27:id}}:null,classList:{toggle(name,value){this[name]=value;}}});
const rows=[row('today'),row('old')];
const page={querySelector:()=>bar,querySelectorAll:selector=>selector==='tbody tr'?rows:[]};
const doc={getElementById:id=>id==='root'?page:{},querySelector:()=>({dataset:{view:active}}),head:{appendChild(){}},body:{},documentElement:{dataset:{}},addEventListener(){}};
const win={fetch:async()=>json({orders:[{id:'today',date:today},{id:'old',date:'2020-01-01'}]}),addEventListener(){},kunClientId:async()=>''};
const context={window:win,fetch:win.fetch,document:doc,localStorage:{getItem:()=>null},MutationObserver:class{observe(){}},Request,Response,URL,Intl,Date,Map,Set,Promise,console,setTimeout:()=>0,clearTimeout(){},location:{href:'https://test/'}};
vm.runInNewContext(await readFile(new URL('../public/v2/modules-v109-operational-date-contact.js',import.meta.url),'utf8'),context);
active='orders';await win.KunOperationalDateContactV109.apply('orders');
assert.equal(rows[0].classList['kun-op-date-hidden'],false);assert.equal(rows[1].classList['kun-op-date-hidden'],true);assert.match(counter.textContent,/^1 أوردر/);
const appSource=await readFile(new URL('../public/v2/app-v3.js',import.meta.url),'utf8');
const appContext=vm.createContext({window:{},document:{getElementById:()=>({value:''})},Intl,console});
vm.runInContext(appSource.slice(0,appSource.lastIndexOf('\ndocument.querySelectorAll')),appContext);
vm.runInContext("state.orders=[{id:'a',source:'web',paymentMethod:'cash',shippingCompany:'J&T'},{id:'b',source:'chat',paymentMethod:'card'},{id:'c',source:'web'}];",appContext);
assert.equal(vm.runInContext("orderFilters.source='web';filteredOrders().map(o=>o.id).join(',')",appContext),'a,c');
assert.equal(vm.runInContext("orderFilters.payment='__unknown__';filteredOrders().map(o=>o.id).join(',')",appContext),'c');
assert.equal(vm.runInContext("orderFilters.payment='cash';orderFilters.carrier='J&T';filteredOrders().map(o=>o.id).join(',')",appContext),'a');
assert.match(vm.runInContext("orderFilter('source','قنوات البيع')",appContext),/value="chat"/);
let readinessLoads=0;appContext.window.KunReadinessV19={render:()=>{readinessLoads++;}};
vm.runInContext("view='readiness';render();render();",appContext);
assert.equal(readinessLoads,2,'Restoring or refreshing readiness must invoke its renderer without a sidebar click');
let inventoryStore='A';const inventoryTasks=[],inventoryValues=Array.from({length:4},()=>({textContent:''}));
const inventorySplit={dataset:{},innerHTML:'',querySelectorAll:()=>[]};
const inventoryRoot={querySelector:selector=>selector==='.grid.split'?inventorySplit:null,querySelectorAll:()=>inventoryValues};
const inventoryWindow={KunActionsV23:{scope:async()=>({cid:'client',sid:inventoryStore}),api:async url=>({products:[{id:'p',name:new URL(url,'https://test').searchParams.get('storeId'),stock:1,cost:2}]})}};
const inventoryContext=vm.createContext({window:inventoryWindow,view:'inventory',inventory:()=>'',queueMicrotask:fn=>inventoryTasks.push(fn),document:{getElementById:id=>id==='root'?inventoryRoot:null,addEventListener(){},documentElement:{dataset:{}}},Intl,Map,Number,JSON,Promise});
vm.runInContext(await readFile(new URL('../public/v2/modules-v46-variant-inventory-sync.js',import.meta.url),'utf8'),inventoryContext);
inventoryContext.inventory();await inventoryTasks.shift()();assert.match(inventorySplit.innerHTML,/>A</);
inventoryStore='B';inventoryContext.inventory();await inventoryTasks.shift()();assert.match(inventorySplit.innerHTML,/>B</);assert.doesNotMatch(inventorySplit.innerHTML,/>A</);
console.log('QA Production regression tests passed: catalog scope, phone validation, expense reconciliation, v27 date filtering.');
