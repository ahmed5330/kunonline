import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const uiSrc=await readFile(new URL('../public/v2/modules-v79-printing.js',import.meta.url),'utf8');
const previewSrc=await readFile(new URL('../public/v2/order-document-preview.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null;
async function findChrome(){for(const path of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found for product import fixture QA');}
async function waitDebugger(port,{attempts=60,delay=100}={}){let last;for(let i=0;i<attempts;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(delay);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function cleanupBrowser(){try{cdp?.close();}catch{}cdp=null;try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}chrome=null;await sleep(120);try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}userDir=null;}
async function launchOnce(executable){userDir=await mkdtemp(join(tmpdir(),'kun-product-import-'));const port=9000+(randomBytes(2).readUInt16BE(0)%6000);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});return waitDebugger(port);}
async function launch(executable){const failures=[];for(let attempt=1;attempt<=3;attempt++){try{return await launchOnce(executable);}catch(error){failures.push(`attempt ${attempt}: ${error?.message||String(error)}`);await cleanupBrowser();if(attempt<3)await sleep(200*attempt);}}throw new Error(`Chrome DevTools unavailable after 3 isolated startup attempts — ${failures.join(' | ')}`);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},12000);this.pending.set(id,{resolve,reject,t});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=7000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await evalJs(expression);if(value)return value;}catch(e){last=e;}await sleep(80);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}

const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(['/v2/document-settings-ui.js','/v2/document-print-model.js'].includes(path)){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../public'+path,import.meta.url),'utf8'));return;}
 res.setHeader('Content-Type','text/html');res.end('<html dir="rtl"><body><div id="root"></div></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await waitFor('document.getElementById("root")','fixture');
 await evalJs(`window.__calls=[];window.__enabled=false;window.__store='S1';window.__revision=0;window.__conflict=false;window.__xss=0;window.__config=null;window.__events=[];window.kunClientId=async()=> 'C1';window.kunStoreId=async()=>__store;window.showToast=m=>window.__toast=m;window.__order={id:'O1',ref:'DEMO-1',name:'عميل اختبار',clientId:'C1',storeId:'S1',product:'منتج',qty:2,total:120,state:'confirmed'};window.__realFetch=window.fetch;window.fetch=async(p,o={})=>{if(!String(p).startsWith('/api/'))return __realFetch(p,o);const body=JSON.parse(o.body||'null');__calls.push({p,method:o.method||'GET',body});const ok=!(o.method==='PUT'&&__conflict);if(o.method==='PUT'&&ok){__config=body.config;__revision++;}if(o.method==='POST')__events.push({...body,template_id:body.template,paper_size:body.size,actor:'Synthetic',created_at:'2026-10-29'});const data=String(p).includes('/api/printing')?{orders:[__order],stores:[],counts:{waiting:1,printed:0},total:1}:String(p).includes('/print-events')?{events:__events}:ok?{config:__config||KunDocumentSettings.defaultDocumentSettings(),revision:__revision,writeEnabled:__enabled,storageReady:true}:{error:'تعارض اصطناعي'};return {ok,json:async()=>data};};`);
 await evalJs('eval('+JSON.stringify(uiSrc)+');eval('+JSON.stringify(previewSrc)+');import("/v2/document-settings-ui.js?v=1.0")');await waitFor('window.KunDocumentSettings','settings module');
 await evalJs('KunPrintingV79.render()');await waitFor('document.querySelector("[data-document-settings]")','settings action');
 await evalJs('document.querySelector("[data-document-settings]").click()');await waitFor('document.querySelector("[data-save]")','settings dialog');
 assert.equal(await evalJs('document.querySelector("[data-save]").disabled'),true);
 await evalJs('document.querySelector("[data-close]").click();__enabled=true;KunDocumentSettings.openSettings()');await waitFor('document.querySelector("[data-save]")&&!document.querySelector("[data-save]").disabled','synthetic editable settings');
 await evalJs('document.querySelector("[data-brand=name]").value="<script>__xss=1</script> نشاط";document.querySelector("[data-brand=footer]").value="شكرًا لك";document.querySelector("[data-tab=profiles]").click();document.querySelector("[data-add-profile]").click()');
 assert.equal(await evalJs('document.querySelectorAll("[data-profile-row]").length'),2);
 await evalJs('window.__thermal=document.querySelectorAll("[data-profile-row]")[1];__thermal.querySelector("[data-profile=name]").value="حراري";__thermal.querySelector("[data-profile=size]").value="receipt";__thermal.querySelector("[data-profile=template]").value="receipt";window.__thermalId=__thermal.querySelector("[data-profile=id]").value;document.querySelector("[data-tab=rules]").click();document.querySelector("[data-add-rule]").click();document.querySelector("[data-rule=enabled]").checked=true;document.querySelector("[data-rule=profileId]").value=__thermalId;document.querySelector("[data-rule=minTotal]").value="100";document.querySelector("[data-save]").click()');
 await waitFor('document.querySelector("[data-feedback]").textContent.includes("تم حفظ")','save');
 assert.equal(await evalJs('__calls.filter(c=>c.method==="PUT").length'),1);
 assert.equal(await evalJs('__config.rules[0].profileId===__thermalId'),true);
 await evalJs('document.querySelector("[data-preview]").click()');await waitFor('document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("معاينة فقط")','unsaved preview');
 assert.equal(await evalJs('__xss'),0);
 await evalJs('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 assert.equal(await evalJs('!!document.querySelector("[data-save]")'),true,'Escape closes top preview only');
 await evalJs('__conflict=true;document.querySelector("[data-save]").click()');await waitFor('document.querySelector("[data-feedback]").textContent.includes("تعارض")','revision conflict');
 await evalJs('__store="S2";document.querySelector("[data-save]").click()');await waitFor('document.querySelector("[data-feedback]").textContent.includes("تغير المتجر")','scope switch');
 assert.equal(await evalJs('__calls.filter(c=>c.method==="PUT").length'),2,'scope switch makes no request');
 await evalJs('document.querySelector("[data-close]").click();__store="S1";__conflict=false;document.querySelector("[data-print79-document]").click()');await waitFor('document.querySelector("iframe")?.contentDocument?.querySelector("[data-template=receipt]")','rule-selected preview');
 assert.equal(await evalJs('document.querySelector("[data-document-size]").value'),'receipt');
 assert.equal(await evalJs('__xss'),0);
 const templates=await evalJs('KunDocumentSettings.templates.map(t=>t.id)');assert.equal(templates.length,11);
 for(const template of templates){await evalJs('document.querySelector("[data-document-template]").value='+JSON.stringify(template)+';document.querySelector("[data-document-template]").dispatchEvent(new Event("change"))');await waitFor('!document.querySelector("[data-document-print]").disabled','template load');assert.equal(await evalJs('document.querySelector("iframe").contentDocument.querySelector("main").dataset.template'),template);}
 await evalJs('window.__printed=0;document.querySelector("iframe").contentWindow.print=()=>__printed++;document.querySelector("[data-document-print]").click()');await waitFor('__events.length===1','print request recorded');assert.equal(await evalJs('__printed'),1);
 assert.equal(await evalJs('__calls.filter(c=>c.method==="POST").every(c=>c.p.includes("/print-events"))'),true,'no carrier/financial writes');
 await evalJs('[...document.querySelectorAll("button")].find(b=>b.textContent==="سجل طلبات الطباعة").click()');await waitFor('document.querySelectorAll("[role=dialog]").length===2','history');
 assert.ok((await evalJs('[...document.querySelectorAll("[role=dialog]")].at(-1).innerText')).includes('لا يثبت خروج ورقة'));
 assert.ok(await evalJs('__calls.some(c=>c.p.includes("/print-events?")&&c.p.includes("orderId=O1"))'));
 console.log('Document settings browser PASS: read-only policy, brand escaping, profiles, rules, save/conflict, store-change denial, 11 templates, automatic thermal selection, nested dialogs, synthetic print-request history; no carrier/financial mutations.');
}finally{await cleanupBrowser();await new Promise(r=>server.close(r));}

