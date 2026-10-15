/* Browser fixture for actual growth planning UI. Local HTTP and mocked tenant APIs only. */
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const js=await readFile(new URL('../public/v2/modules-v150-growth-planner.js',import.meta.url),'utf8');
const html='<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body>'+
  '<div id="root"><select id="metaCampaignDays"><option value="30">30</option></select>'+
  '<div id="metaScalingReadiness"></div></div><script src="/mock.js"></script>'+
  '<script src="/growth.js"></script></body></html>';
const mocks=[
  'window.__calls=[];window.__errors=[];',
  'window.addEventListener("error",e=>window.__errors.push(e.message));',
  'window.kunClientId=async()=> "C1";window.kunStoreId=async()=> "S1";',
  'window.fetch=async(url,opts={})=>{const path=String(url);__calls.push({path,method:opts.method||"GET",body:opts.body||null});',
  'let data={};',
  'if(path.includes("/api/growth/inventory-catalog"))data={items:[{id:"P1",name:"Cotton",sku:"SKU-1",availableUnits:70},{id:"P2",name:"Pack",sku:"SKU-2",availableUnits:100}],bundles:[{externalId:"BUNDLE",coverage:"visible",components:[{productId:"P1",quantity:2},{productId:"P2",quantity:1}]}],mappingStatus:"loaded",pagination:{truncated:false}};',
  'else if(path.includes("/api/growth/operating-evidence"))data={currentBacklog:{pendingConfirmation:2,awaitingPacking:3,awaitingDelivery:4,deliveredNotMarkedCollected:1},codRecorded:{grossRecorded:650,missingAmountCount:1,meanDaysFromOrderToRecordedCollection:4}};',
  'else if(path.includes("/api/growth/scenario/preview"))data={currency:"EGP",from:"2026-10-01",to:"2026-10-15",scenario:{recommendation:"fix_blockers_first",baseline:{spend:1500,orders:30,historicalCPP:50},forecast:{dailyOrders:10,totalOrders:70,deliveredOrders:50,adSpend:7000,estimatedContributionAfterAds:1200,breakEvenCostPerEnteredOrder:115,cashNeededBeforeCollection:6000,cashDeficit:800,dailyOperationsCapacity:8,unprocessedOrdersPerDay:2},blockers:["Shipping bottleneck"],warnings:[],stockItems:[{sku:"SKU-1",availableUnits:70,dailyConsumption:20,requiredUnits:100,shortageUnits:30}],disclaimer:"Simulation only"}};',
  'else if(path.includes("/api/growth/experiment/compare"))data={comparison:{status:"insufficient_evidence",before:{adSpend:1000,enteredOrders:30},after:{adSpend:1300,enteredOrders:36},change:{dailyAdSpendPct:30,dailyOrdersPct:20,enteredCppPct:7,realRoasPct:1,eligibleProfitPerDayPct:5},issues:["Small sample"],caveat:"No causality."}};',
  'else return {ok:false,status:404,json:async()=>({error:"Unknown fixture route"})};',
  'return {ok:true,status:200,json:async()=>data};};'
].join('\n');
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/mock.js'||req.url==='/growth.js'?
    'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(req.url==='/mock.js'?mocks:req.url==='/growth.js'?js:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,cdp,profile;
const findChrome=async()=>{
  for(const path of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser']){
    if(!path)continue;try{await access(path);return path;}catch{}
  }throw Error('Headless Chrome is required for growth planner QA');
};
class CDP{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>{
   const msg=JSON.parse(String(e.data)),p=this.pending.get(msg.id);if(!p)return;
   this.pending.delete(msg.id);clearTimeout(p.timer);
   msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{
   const id=++this.id,timer=setTimeout(()=>reject(Error('CDP timeout: '+method)),12000);
   this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
async function evaluate(expression){
 const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result.value;
}
async function waitFor(expression){
 for(let i=0;i<80;i++){try{if(await evaluate(expression))return;}catch{}await sleep(100);}
 throw Error('Browser readiness timeout: '+expression);
}
try{
 profile=await mkdtemp(join(tmpdir(),'growth-planner-'));
 const port=9400+Math.floor(Math.random()*5000);
 browser=spawn(await findChrome(),['--headless=new','--no-sandbox','--disable-gpu',
   '--disable-dev-shm-usage','--disable-background-networking','--no-first-run',
   '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,
   '--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let wsUrl='';
 for(let i=0;i<100;i++){try{const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
   wsUrl=pages.find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(wsUrl)break;}catch{}await sleep(70);}
 if(!wsUrl)throw Error('Chromium debugging unavailable');
 const ws=new WebSocket(wsUrl);await new Promise((resolve,reject)=>{
   ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);await cdp.send('Runtime.enable');
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await waitFor('!!document.getElementById("growthPlanner150")');
 await waitFor('document.querySelectorAll("#gp150-bundle-select option").length===2');
 await waitFor('document.querySelectorAll("#gp150-operating-facts .gp150-metric").length>=6');
 assert.equal(await evaluate('document.querySelectorAll("#growthPlanner150").length'),1);
 await evaluate('document.getElementById("gp150-bundle-select").value="BUNDLE";document.getElementById("gp150-load-bundle").click();');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".gp150-units")].map(x=>Number(x.value))'),[2,1]);
 assert.equal(await evaluate('document.querySelector("[name=coversAllPromotedSkus]").checked'),false);
 await evaluate('(()=>{const f=document.getElementById("gp150-form");const v={horizonDays:7,proposedDailyBudget:1000,costPerEnteredOrder:100,expectedDeliveryRatePct:70,contributionPerDeliveredOrderBeforeAds:250,returnLossPerFailedOrder:20,extraDailyOperatingCost:100,merchantCashAvailable:5000,daysToNextCollection:5,extraDailyCashOutflow:300,dailyConfirmationCapacity:12,dailyPackingCapacity:10,dailyShippingCapacity:8};for(const [k,x] of Object.entries(v))f.elements.namedItem(k).value=String(x);[...f.querySelectorAll(".gp150-lead,.gp150-safety")].forEach(x=>x.value="2");f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));})()');
 await waitFor('document.getElementById("gp150-output").textContent.includes("Shipping bottleneck")');
 const req=await evaluate('__calls.find(x=>x.path.includes("/api/growth/scenario/preview"))');
 assert.equal(req.method,'POST');assert.ok(req.path.includes('storeId=S1')&&req.path.includes('clientId=C1'));
 const payload=JSON.parse(req.body);
 assert.equal(payload.plan.stockItems.length,2);
 assert.equal(payload.plan.stockItems[0].unitsPerOrder,2);
 assert.equal(payload.plan.stockItems[0].availableUnits,undefined,'never trust user-submitted stock as real');
 await evaluate('(()=>{const f=document.getElementById("gp150-experiment");for(const [k,v] of Object.entries({beforeFrom:"2026-09-01",beforeTo:"2026-09-07",afterFrom:"2026-09-08",afterTo:"2026-09-14"}))f.elements.namedItem(k).value=v;f.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));})()');
 await waitFor('document.getElementById("gp150-experiment-result").textContent.includes("Small sample")');
 assert.equal(await evaluate('__errors.length'),0);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('!!document.getElementById("growthPlanner150")'),true);
 assert.equal(await evaluate('__calls.some(x=>x.path.includes("/api/wallet")||x.path.includes("budget-update"))'),false);
 console.log('Growth Planner browser fixture PASS: bundle, COD evidence, planning POST, comparison, mobile and no wallet writes');
}finally{
 server.close();try{cdp?.close();}catch{}
 try{if(browser&&!browser.killed)browser.kill('SIGTERM');}catch{}
 if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
