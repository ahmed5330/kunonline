import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const uiSrc=await readFile(new URL('../public/v2/modules-v155-accounting-faos.js',import.meta.url),'utf8');
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

const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html dir="rtl"><body><nav class="nav"><button class="active" data-view="accounting">الحسابات</button></nav><div id="root"><div class="acc100"><input id="acc100Month" value="2026-10"><div id="acc100Body"></div></div></div></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await waitFor('document.getElementById("root")','fixture');
 await evalJs(`window.__calls=[];window.__enabled=false;window.__store='S1';window.kunClientId=async()=> 'C1';window.kunStoreId=async()=>__store;window.confirm=()=>true;window.fetch=async(p,o={})=>{const body=JSON.parse(o.body||'null');__calls.push({p,method:o.method||'GET',body});if(o.method==='POST')return {ok:false,status:503,json:async()=>({error:'Synthetic retry'})};const data=p.includes('/catalog')?{accounts:[{code:'1110',name:'الخزنة',type:'asset'},{code:'1120',name:'البنك',type:'asset'},{code:'3100',name:'رأس المال',type:'equity'}]}:p.includes('/simulation')?{}:{capabilities:{financialPostingEnabled:__enabled},ledger:{accounts:[]}};return {ok:true,json:async()=>data};};`);
 await evalJs('eval('+JSON.stringify(uiSrc)+')');await waitFor('document.querySelector("[data-faos-tab=entry]")','workspace');
 await evalJs('document.querySelector("[data-faos-tab=entry]").click()');
 assert.equal(await evalJs('!!document.getElementById("faosEntryForm")'),false,'write gate stays closed');
 await evalJs('__enabled=true;KunFAOSAccountingV1.refresh()');await waitFor('document.getElementById("faosEntryForm")','synthetic writable form');
 await evalJs('document.querySelector("[name=entryMode]").value="multi";document.querySelector("[name=entryMode]").dispatchEvent(new Event("change"));document.querySelector("[data-faos-add]").click()');
 assert.equal(await evalJs('document.querySelectorAll("[data-faos-lines] tr").length'),3);
 const fill=`const f=document.getElementById('faosEntryForm');f.elements.description.value='قيد اختبار اصطناعي';const rows=[...f.querySelectorAll('[data-faos-lines] tr')];const values=[['1110','10.10',''],['1120','20.20',''],['3100','','30.30']];rows.forEach((r,i)=>{['accountCode','debit','credit'].forEach((k,j)=>r.querySelector('[data-field='+k+']').value=values[i][j]);});f.dispatchEvent(new Event('input',{bubbles:true}));`;
 await evalJs('{'+fill+'}');
 // Imbalanced and invalid precision never submit.
 await evalJs('document.querySelectorAll("[data-field=credit]")[2].value="30.29";document.getElementById("faosEntryForm").requestSubmit()');
 await waitFor('document.getElementById("faosEntryFeedback").textContent.includes("غير متوازن")','imbalance feedback');
 assert.equal(await evalJs('__calls.filter(c=>c.method==="POST").length'),0);
 await evalJs('document.querySelectorAll("[data-field=credit]")[2].value="30.303";document.getElementById("faosEntryForm").requestSubmit()');
 assert.equal(await evalJs('__calls.filter(c=>c.method==="POST").length'),0);
 await evalJs('{'+fill+'document.getElementById("faosEntryForm").requestSubmit();}');
 await waitFor('document.getElementById("faosEntryFeedback").textContent.includes("Synthetic retry")','synthetic submit');
 let posts=await evalJs('__calls.filter(c=>c.method==="POST")');assert.equal(posts.length,1);assert.equal(posts[0].body.lines.length,3);assert.equal(posts[0].body.lines[2].credit,30.3);assert.equal(posts[0].body.storeId,'S1');
 await evalJs('document.getElementById("faosEntryForm").requestSubmit()');await waitFor('__calls.filter(c=>c.method==="POST").length===2','retry');
 posts=await evalJs('__calls.filter(c=>c.method==="POST")');assert.equal(posts[0].body.idempotencyKey,posts[1].body.idempotencyKey);
 await evalJs('document.querySelector("[name=description]").value="قيد معدل";document.getElementById("faosEntryForm").requestSubmit()');await waitFor('__calls.filter(c=>c.method==="POST").length===3','edited payload');
 posts=await evalJs('__calls.filter(c=>c.method==="POST")');assert.notEqual(posts[1].body.idempotencyKey,posts[2].body.idempotencyKey);
 await evalJs('__store="S2";document.getElementById("faosEntryForm").requestSubmit()');await waitFor('document.getElementById("faosEntryFeedback").textContent.includes("تغير المتجر")','stale store blocked');
 assert.equal(await evalJs('__calls.filter(c=>c.method==="POST").length'),3);
 assert.equal(await evalJs('(()=>{try{KunFAOSAccountingV1.validateEntryLines([{accountCode:"BAD",debit:"1"},{accountCode:"1120",credit:"1"}])}catch{return true}return false})()'),true);
 console.log('FAOS browser fixture passed: closed gate, three balanced lines, precision/imbalance rejection, retry key reuse, changed-payload key rotation, stale-store denial; all POSTs synthetic.');
}finally{await cleanupBrowser();await new Promise(r=>server.close(r));}

