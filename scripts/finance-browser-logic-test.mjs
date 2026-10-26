import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync('public/v2/modules-v96-finance-command-center.js','utf8');
const root={innerHTML:''},styles=[];
let collectedCash=350,purchases=false;
const endpoints={
 '/api/dashboard':()=>({ok:true,from:'2026-10-01',to:'2026-10-11',currency:'EGP',overview:{expectedRevenue:500,profitMargin:60,productCostSource:'current_inventory'},ads:{spend:60},finance:{revenue:500,productCost:100,grossProfit:400,expenses:100,netProfit:300,expenseBreakdown:{ads:60,general:40,shipping:0,orderOther:0,admin:0}}}),
 '/api/accounting/overview':()=>({ok:true,collectedRevenue:collectedCash,verifiedCollectedRevenue:collectedCash,estimatedCollectedRevenue:0,verifiedNetCash:collectedCash+20-40,netCash:collectedCash+20-40,manualIncome:20,manualExpenses:40,managementFees:0,entries:1,shippedOrders:0,unverifiedCollectedOrders:0}),
 '/api/accounting/entries':()=>({ok:true,entries:purchases?[{type:'expense',category:'مشتريات',amount:50,date:'2026-10-11'}]:[]}),
 '/api/accounting/collected-profit':()=>({ok:true,collectedGross:350,verifiedCollectedGross:350,unverifiedCollectionFallbackGross:0,missingProductCostOrders:0,managementFees:0}),
 '/api/cod-reconciliation/candidates':()=>[],
 '/api/cod-reconciliation':()=>[],
 '/api/cod-reconciliation/summary':()=>({ok:true,totalOrders:800,totalExpected:250000})
};
const select=selector=>selector.includes('button.active[data-view]')?{dataset:{view:'finance'}}:selector.includes('[data-view="finance"]')?{textContent:'المالية'}:null;
const document={
 readyState:'complete',head:{appendChild:x=>styles.push(x)},
 createElement:()=>({id:'',textContent:''}),
 getElementById:id=>id==='root'?root:styles.find(x=>x.id===id)||null,
 querySelector:select,querySelectorAll:()=>[],addEventListener:()=>{}
};
const window={kunClientId:async()=>'client',kunStoreId:async()=>'store',KunSidebarGroupsV90:{sync:()=>{}},setTimeout};
const fetch=async input=>{
 const u=new URL(String(input),'https://test.local'),fn=endpoints[u.pathname];
 return fn?new Response(JSON.stringify(fn()),{status:200,headers:{'Content-Type':'application/json'}}):new Response('unavailable',{status:404});
};
const context={window,document,fetch,location:{origin:'https://test.local'},URL,Response,Intl,Date,Promise,Math,Number,Object,JSON,String,Array,Set,Map,console,setTimeout,clearTimeout};
vm.runInNewContext(js,context,{filename:'modules-v96-finance-command-center.js'});
assert.equal(window.KunFinanceCommandCenterV96.version,'96.2');
await window.KunFinanceCommandCenterV96.render();
for(const token of ['صافي الربح التشغيلي','صافي الربح المحاسبي','التحصيل: المالية × الحسابات','متطابق','ليس رصيد البنك'])
 assert.ok(root.innerHTML.includes(token),`missing visible finance indicator: ${token}`);
assert.ok(!root.innerHTML.includes('فرق ٢٠'),'false positive in balanced fixture');
assert.ok(root.innerHTML.includes('مبالغ تحصيل مثبتة فقط'),'Finance must display verified COD separately');
assert.ok(root.innerHTML.includes('صافي مسجل بدون قيم طلبات تقديرية'),'Finance must display verified flow separately');
assert.ok(root.innerHTML.includes(new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(250000)),'Finance screen must show all pending COD, not only the first 500 candidate records');
assert.ok(root.innerHTML.includes(new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(800)),'Finance must show all pending COD orders including those beyond the 500-record list');
collectedCash=370;
await window.KunFinanceCommandCenterV96.reload();
assert.ok(root.innerHTML.includes('فرق'),'collection mismatch must surface instead of displaying false green');
assert.ok(root.innerHTML.includes('يحتاج مراجعة'),'mismatch should be actionable');
purchases=true;await window.KunFinanceCommandCenterV96.reload();
assert.ok(root.innerHTML.includes('مشتريات المخزون'),'inventory purchases that may double count COGS must be flagged');
assert.ok(root.innerHTML.includes('2026-10-11'),'entries returned inside API envelope must appear in the Finance ledger');
assert.equal(styles.length,1,'do not mount duplicate finance styles');
console.log('Finance page simulated-browser ledger reconciliation PASS');
