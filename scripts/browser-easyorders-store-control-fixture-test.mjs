/* Browser acceptance: Easy Orders UI is reachable and only publishes after two explicit steps. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const javascript=await readFile(new URL('../public/v2/modules-v132-easyorders-store-control.js',import.meta.url),'utf8');
const sleep=t=>new Promise(r=>setTimeout(r,t));
const html='<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+
'<nav class="nav"><button data-view="integrations" class="active">التكاملات</button></nav><section id="root"><div class="page-head"><div class="title">مركز التكاملات</div><div class="spacer"></div></div></section>'+
'<aside id="drawer"></aside><div id="drawerBack"></div><div id="toast"></div>'+
'<script>window.__posts=[];window.__toasts=[];window.__store="kun-A";'+
'window.showToast=x=>__toasts.push(x);'+
'window.KunActionsV23={esc:x=>String(x??"").replace(/[&<>"\\u0027]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\\u0027:"&#39;",\\u0022:"&quot;"}[c]||c)),'+
'scope:async()=>({cid:"tenant-A",sid:__store}),notify:x=>__toasts.push(x),drawer:(title,content)=>{document.getElementById("drawer").innerHTML=content;document.getElementById("drawer").className="open";},close:()=>{document.getElementById("drawer").innerHTML="";},'+
'api:async path=>path.includes("resource=capabilities")?{ok:true,connected:true,connection:{id:"conn-A",name:"متجر الأمل",externalStoreId:"easy-A"}}:'+
'path.includes("resource=products")?{ok:true,data:[{id:"P1",name:"منتج تجريبي",sku:"TEST1",price:100}]}:'+
'path.includes("resource=categories")?{ok:true,data:[{id:"C1",name:"تصنيف تجريبي"}]}:'+
'{ok:true,data:{id:"P1",name:"منتج تجريبي",store_id:"easy-A"}}};'+
'window.fetch=async(url,options)=>{__posts.push({url,options});return {ok:true,status:200,json:async()=>({ok:true,published:true,audited:true,message:"قبله Easy Orders"})};};'+
'</script><script src="/ui.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/ui.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/ui.js'?javascript:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chromeBin=async()=>{for(const p of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/google-chrome-stable','/usr/bin/chromium-browser']){if(!p)continue;try{await access(p);return p;}catch{}}throw Error('Chromium required');};
class CDP{
 constructor(ws){this.ws=ws;this.idx=0;this.waiting=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),pending=this.waiting.get(m.id);if(!pending)return;this.waiting.delete(m.id);clearTimeout(pending.timer);m.error?pending.reject(Error(m.error.message)):pending.resolve(m.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.idx,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),14000);this.waiting.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
let chrome,profile,cdp;
async function run(code){
 const r=await cdp.send('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true,userGesture:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
}
async function ready(code){for(let i=0;i<90;i++){try{if(await run(code))return;}catch{}await sleep(70);}throw Error('Browser readiness timeout: '+code);}
try{
 profile=await mkdtemp(join(tmpdir(),'kun-easyorders-ui-'));
 const port=10000+Math.floor(Math.random()*5000);
 chrome=spawn(await chromeBin(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let wsUrl='';
 for(let n=0;n<75;n++){try{wsUrl=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(wsUrl)break;}catch{}await sleep(80);}
 if(!wsUrl)throw Error('No Chrome DevTools endpoint');
 const ws=new WebSocket(wsUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await ready('!!document.getElementById("easyordersStoreControlOpen")');
 await run('document.getElementById("easyordersStoreControlOpen").click()');
 await ready('!!document.querySelector("#eoBody .eoc-card")');
 assert.equal(await run('document.querySelectorAll(".eoc-tabs [data-eoc-tab]").length'),7);
 assert.equal(await run('document.querySelector("#eoBody").textContent.includes("المنتجات")'),true);
 await run('document.querySelector(".eoc-tabs [data-eoc-tab=products]").click()');
 await run('document.querySelector("[data-eoc-read=products]").click()');
 await ready('document.getElementById("eoList")?.textContent.includes("منتج تجريبي")');
 assert.equal(await run('__posts.length'),0,'A read must never write to Easy Orders');
 await run('document.querySelector("[data-eoc-form=\\"product.create\\"] [data-eoc-field=name]").value="منتج جديد";document.querySelector("[data-eoc-form=\\"product.create\\"] [data-eoc-field=price]").value="300";document.querySelector("[data-eoc-preview=\\"product.create\\"]").click()');
 assert.equal(await run('!!document.getElementById("eoPending")'),true);
 assert.equal(await run('__posts.length'),0,'Preview alone must never POST');
 await run('document.querySelector("[data-eoc-publish]").click()');
 assert.equal(await run('__posts.length'),0,'Publishing without checkbox must be rejected');
 await run('document.getElementById("eoConfirm").checked=true;document.querySelector("[data-eoc-publish]").click()');
 await ready('__posts.length===1');
 const post=await run('({url:__posts[0].url,header:__posts[0].options.headers["X-Kun-Store-Action"],payload:JSON.parse(__posts[0].options.body)})');
 assert.equal(post.header,'confirmed');assert.equal(post.payload.operation,'product.create');assert.equal(post.payload.storeId,'kun-A');assert.equal(post.payload.confirm,'CONFIRM_PUBLISH_EASYORDERS');
 await run('document.querySelector(".eoc-tabs [data-eoc-tab=other]").click()');
 assert.ok(await run('document.querySelector("#eoBody").textContent.includes("API")'));
 assert.equal(await run('document.querySelectorAll("#eoBody [data-eoc-publish]").length'),0,'No unsupported theme publishing');
 await run('window.__store="";window.KunEasyOrdersControlV132.open()');
 await ready('document.getElementById("eoControl")?.textContent.includes("اختار متجرًا")');
 assert.equal(await run('__posts.length'),1);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await run('window.__store="kun-A";window.KunEasyOrdersControlV132.open()');
 await ready('!!document.querySelector(".eoc-tabs")');
 assert.equal(await run('getComputedStyle(document.querySelector(".eoc-tabs")).overflowX'),'auto');
 console.log('Easy Orders UI Chrome fixture PASSED: accessible integration entry, 7 tabs, remote read, preview then explicit approval, tenant/store binding, unsupported actions disabled, mobile layout.');
}finally{
 try{cdp?.close();}catch{}if(chrome&&!chrome.killed)chrome.kill('SIGTERM');
 await sleep(150);if(profile)await rm(profile,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));
}
