/* Browser regression for the actual v130 inventory interface; never touches live customer data. */
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const js=await readFile(new URL('../public/v2/modules-v130-inventory-workspace.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/v2/kun-inventory-v130.css',import.meta.url),'utf8');
let chrome,profile,cdp,server;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const executable=async()=>{
 for(const path of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
  if(!path)continue;try{await access(path);return path;}catch{}
 }
 throw new Error('Headless Chrome required for inventory UX browser regression');
};
const sourceHtml='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+
 '<nav class="nav"><button class="active" data-view="inventory">المخزون</button><button data-view="products">المنتجات</button></nav>'+
 '<div id="root"><div class="page-head"><div class="title">المخزون القديم</div><button id="stockAdjust">تسوية</button><button id="v39NewBatch">دفعة</button></div>'+
 '<div class="grid kpis four">ملخص قديم</div><div class="grid split"><div class="card">جدول قديم</div></div>'+
 '<section id="unit128Panel"><button data-warehouse-ops>تشغيل</button><button data-unit-open-product="A">قطع</button><button data-unit-print-product="A">ملصقات</button></section>'+
 '<section id="v39BatchList">دفعات النظام الأصلية</section><section id="v37InventoryHistory"><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>الكمية</th><th>الرصيد</th></tr></thead><tbody><tr><td>2026-10-08</td><td>منتج متوفر</td><td>+5</td><td>15</td></tr><tr><td>2026-10-07</td><td>منتج منخفض</td><td>-2</td><td>3</td></tr></tbody></table></div></section></div>'+
 '<script>window.__events=[];window.state={products:[{id:"A",name:"منتج متوفر",sku:"SKU-A",barcode:"BA",stock:15,lowStockThreshold:5,cost:10,category:"نظارات"},{id:"B",name:"منتج منخفض",sku:"SKU-B",stock:3,lowStockThreshold:5,cost:20,category:"ملابس"},{id:"C",name:"منتج نافد",sku:"SKU-C",stock:0,lowStockThreshold:5,cost:30,category:"ملابس"}]};'+
 'window.KunActionsV23={notify:x=>__events.push("notify:"+x)};window.KunUnitTrackingV128={scan:()=>__events.push("camera")};window.openProduct=id=>__events.push("product:"+id);'+
 'for(const id of ["stockAdjust","v39NewBatch"])document.getElementById(id).onclick=()=>__events.push(id);'+
 'for(const attr of ["data-warehouse-ops","data-unit-open-product","data-unit-print-product"])document.querySelector("["+attr+"]").onclick=()=>__events.push(attr);</script>'+
 '<script src="/workspace.js"></script></body></html>';
server=createServer((req,res)=>{
 res.setHeader('Content-Type',req.url==='/workspace.js'?'application/javascript':'text/html; charset=utf-8');
 res.end(req.url==='/workspace.js'?js:sourceHtml);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
class CDP{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data)),p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);clearTimeout(p.timeout);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id,timeout=setTimeout(()=>reject(Error('CDP timeout '+method)),12000);this.pending.set(id,{resolve,reject,timeout});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
async function evaluate(expression){
 const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result.value;
}
async function ready(expression){for(let i=0;i<80;i++){try{if(await evaluate(expression))return;}catch{}await sleep(75);}throw Error('Browser readiness timeout: '+expression);}
try{
 profile=await mkdtemp(join(tmpdir(),'kun-inventory-ux-'));
 const port=9000+Math.floor(Math.random()*8000);
 chrome=spawn(await executable(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let wsUrl='';
 for(let i=0;i<80;i++){try{const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();wsUrl=pages.find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(wsUrl)break;}catch{}await sleep(75);}
 if(!wsUrl)throw Error('Chrome DevTools failed to start');
 const ws=new WebSocket(wsUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);
 await cdp.send('Runtime.enable');
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await ready('!!document.getElementById("ki130Workspace")');
 assert.equal(await evaluate('document.querySelectorAll(".ki130-stat").length'),5);
 assert.equal(await evaluate('document.querySelectorAll("#ki130Workspace [data-ki130-tab]").length'),6);
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#root>.page-head")).display'),'none');
 assert.equal(await evaluate('document.getElementById("unit128Panel").getClientRects().length'),0);
 assert.equal(await evaluate('document.querySelectorAll("#ki130Alerts .ki130-alert-row").length'),2);
 assert.equal(await evaluate('document.querySelector("#ki130-panel-units").contains(document.getElementById("unit128Panel"))'),true);
 assert.equal(await evaluate('document.querySelector("#ki130-panel-batches").contains(document.getElementById("v39BatchList"))'),true);
 assert.equal(await evaluate('document.querySelector("#ki130-panel-history").contains(document.getElementById("v37InventoryHistory"))'),true);
 assert.equal(await evaluate('document.querySelectorAll("#root > #unit128Panel,#root > #v39BatchList,#root > #v37InventoryHistory").length'),0);
 await evaluate('document.querySelector("[data-ki130-filterjump=low]").click()');
 assert.equal(await evaluate('document.getElementById("root").dataset.ki130Tab'),'products');
 assert.equal(await evaluate('document.querySelectorAll("#ki130Rows tr").length'),1);
 assert.equal(await evaluate('document.getElementById("ki130Found").textContent.includes("١")'),true);
 await evaluate('document.querySelector("[data-ki130-status=all]").click();document.getElementById("ki130Search").value="SKU-A";document.getElementById("ki130Search").dispatchEvent(new Event("input",{bubbles:true}));');
 assert.equal(await evaluate('document.querySelectorAll("#ki130Rows tr").length'),1);
 await evaluate('document.querySelector("[data-ki130-units=A]").click();document.querySelector("[data-ki130-print=A]").click();');
 assert.deepEqual(await evaluate('__events.slice(-2)'),['data-unit-open-product','data-unit-print-product']);
 await evaluate('document.querySelector("[data-ki130-tab=units]").click()');
 assert.ok(await evaluate('document.getElementById("unit128Panel").getClientRects().length > 0'));
 await evaluate('document.querySelector("[data-ki130-tab=batches]").click()');
 assert.ok(await evaluate('document.getElementById("v39BatchList").getClientRects().length > 0'));
 await evaluate('document.querySelector("[data-ki130-action=batch]").click()');
 assert.equal(await evaluate('__events.includes("v39NewBatch")'),true);
 await evaluate('document.querySelector("[data-ki130-tab=history]").click()');
 assert.ok(await evaluate('document.getElementById("v37InventoryHistory").getClientRects().length > 0'));
 assert.equal(await evaluate('document.querySelectorAll("#ki131HistoryTools select").length'),1);
 await evaluate('const select=document.querySelector("#ki131HistoryTools select");select.value="minus";select.dispatchEvent(new Event("change",{bubbles:true}));');
 assert.equal(await evaluate('document.querySelectorAll("#v37InventoryHistory tbody tr:not([hidden])").length'),1);
 await evaluate('const field=document.querySelector("#ki131HistoryTools input");field.value="منتج منخفض";field.dispatchEvent(new Event("input",{bubbles:true}));');
 assert.equal(await evaluate('document.querySelectorAll("#v37InventoryHistory tbody tr:not([hidden])").length'),1);
 await evaluate('document.querySelector("#ki131HistoryTools input").value="غير موجود";document.querySelector("#ki131HistoryTools input").dispatchEvent(new Event("input",{bubbles:true}));');
 assert.equal(await evaluate('document.querySelectorAll("#v37InventoryHistory tbody tr:not([hidden])").length'),0);
 await evaluate('document.getElementById("v37InventoryHistory").innerHTML="<div class=\\\"table-wrap\\\"><table><tbody><tr><td>2026-10-08</td><td>مخزون مجدد</td><td>+2</td></tr></tbody></table></div>"');
 await ready('!!document.getElementById("ki131HistoryTools")');
 assert.equal(await evaluate('document.querySelectorAll("#v37InventoryHistory tbody tr:not([hidden])").length'),1);
 await evaluate('document.querySelector("[data-ki130-tab=operations]").click();document.querySelector("[data-ki130-action=warehouse]").click();');
 assert.equal(await evaluate('__events.includes("data-warehouse-ops")'),true);
 await evaluate('document.querySelector("[data-ki130-action=camera]").click()');
 assert.equal(await evaluate('__events.includes("camera")'),true);
 await evaluate('document.getElementById("unit128Panel").remove();const replacement=document.createElement("section");replacement.id="unit128Panel";replacement.textContent="لوحة القطع بعد تحديث المصدر";document.getElementById("root").appendChild(replacement);');
 await ready('document.querySelector("#ki130-panel-units").contains(document.getElementById("unit128Panel"))');
 assert.equal(await evaluate('document.querySelectorAll("#unit128Panel").length'),1);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate('document.querySelector("[data-ki130-tab=products]").click()');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".ki130-mobile-list")).display'),'block');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".ki130-table-wrap")).display'),'none');
 assert.equal(await evaluate('JSON.stringify(state.products)'),JSON.stringify([
  {id:'A',name:'منتج متوفر',sku:'SKU-A',barcode:'BA',stock:15,lowStockThreshold:5,cost:10,category:'نظارات'},
  {id:'B',name:'منتج منخفض',sku:'SKU-B',stock:3,lowStockThreshold:5,cost:20,category:'ملابس'},
  {id:'C',name:'منتج نافد',sku:'SKU-C',stock:0,lowStockThreshold:5,cost:30,category:'ملابس'}
 ]));
 console.log('Inventory v131 Chrome fixture PASSED: 6 tabs, single workspace, KPI drilldown, filters/search, barcode/warehouse shortcuts, original stock panels, mobile cards, no data mutation.');
}finally{
 try{cdp?.close();}catch{}
 if(chrome&&!chrome.killed)chrome.kill('SIGTERM');
 await sleep(150);
 if(profile)await rm(profile,{recursive:true,force:true});
 await new Promise(resolve=>server.close(resolve));
}
