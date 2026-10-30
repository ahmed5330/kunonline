import {readFile,writeFile,mkdir,access,mkdtemp,rm} from 'node:fs/promises';
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

const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html dir="rtl"><body><div id="root"></div></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await waitFor('document.getElementById("root")','fixture');
  await evalJs(`window.__calls=[];window.kunClientId=async()=> 'TENANT';window.__xss=0;window.__order={id:'ORDER',ref:'WEB-44',clientId:'TENANT',storeId:'STORE',storeName:'متجر الاختبار',name:'<img src=x onerror="parent.__xss++">',phone:'01000000000',product:'منتج & وصف',qty:2,total:123.45,note:'PRIVATE-NOTE',cost:88,history:[]};window.fetch=async(p,o={})=>{__calls.push({p,method:o.method||'GET'});return {ok:true,json:async()=>({orders:[__order],stores:[{id:'STORE',name:'متجر الاختبار'}],counts:{waiting:1,printed:0},total:1})}};`);
  await evalJs('eval('+JSON.stringify(uiSrc)+');eval('+JSON.stringify(previewSrc)+');KunPrintingV79.render()');
  await waitFor('document.querySelector("[data-print79-document]")','document action');
  await evalJs('document.querySelector("[data-print79-document]").focus();document.querySelector("[data-print79-document]").click()');
  await waitFor('document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("WEB-44")','preview');
  assert.equal(await evalJs('__xss'),0);
  assert.equal(await evalJs('document.querySelector("iframe").contentDocument.querySelectorAll("script,img").length'),0);
  const text=await evalJs('document.querySelector("iframe").contentDocument.body.innerText');
  assert.ok(text.includes('منتج & وصف'));assert.ok(!text.includes('PRIVATE-NOTE'));assert.ok(!text.includes('88'));
  for(const [size,css] of [['A4','A4'],['A5','A5'],['receipt','80mm auto']]){
    await evalJs('document.querySelector("[data-document-size]").value='+JSON.stringify(size)+';document.querySelector("[data-document-size]").dispatchEvent(new Event("change"))');
    await waitFor('!document.querySelector("[data-document-print]").disabled','preview loaded');
    assert.ok((await evalJs('document.querySelector("iframe").srcdoc')).includes('@page{size:'+css));
  }
  await evalJs('document.querySelector("[data-document-layout]").value="compact";document.querySelector("[data-document-layout]").dispatchEvent(new Event("change"))');
  await waitFor('!document.querySelector("[data-document-print]").disabled','compact loaded');
  assert.ok((await evalJs('document.querySelector("iframe").srcdoc')).includes('font-size:12px'));
  await evalJs('window.__printCount=0;document.querySelector("iframe").contentWindow.print=()=>window.__printCount++;document.querySelector("[data-document-print]").click()');
  assert.equal(await evalJs('__printCount'),1);
  assert.deepEqual(await evalJs('__calls.map(c=>c.method)'),['GET'],'preview must never write or send a carrier request');
  assert.equal(await evalJs('__order.history.length'),0);
  await evalJs('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await evalJs('document.querySelector("[role=dialog]")'),null);
  assert.equal(await evalJs('document.activeElement.hasAttribute("data-print79-document")'),true);
  assert.ok((await evalJs('KunOrderDocumentPreview.documentHtml({total:null})')).includes('غير متاح'));
  assert.ok((await evalJs('KunOrderDocumentPreview.documentHtml({total:0})')).includes('٠٫٠٠'));
  assert.equal(await evalJs('(()=>{try{KunOrderDocumentPreview.documentHtml({},"bad")}catch{return true}return false})()'),true);
  assert.equal(await evalJs('(()=>{try{KunOrderDocumentPreview.documentHtml({},"A4","bad")}catch{return true}return false})()'),true);
  for(const size of ['A4','A5','receipt']){
    const encoded=await evalJs(`(async()=>{const blob=await KunOrderDocumentPreview.pdfBlob({...__order,name:'عميل الاختبار',address:'القاهرة - شارع الاختبار',product:'منتج عربي مسجل '.repeat(180)},${JSON.stringify(size)});return await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.readAsDataURL(blob);});})()`);
    const bytes=Buffer.from(encoded,'base64'),raw=bytes.toString('latin1');assert.ok(raw.startsWith('%PDF-1.4'));assert.ok(raw.endsWith('%%EOF\n'));
    const xref=Number(/startxref\n(\d+)/.exec(raw)[1]);assert.equal(raw.slice(xref,xref+4),'xref');
    const entries=raw.slice(xref).split('\n'),count=Number(entries[1].split(' ')[1]);for(let i=1;i<count;i++){const offset=Number(entries[2+i].slice(0,10));assert.ok(raw.slice(offset).startsWith(i+' 0 obj\n'));}
    assert.ok(Number(/\/Count (\d+)/.exec(raw)[1])>1,'long Arabic content must paginate');
    if(process.env.KUN_PDF_FIXTURE_DIR){await mkdir(process.env.KUN_PDF_FIXTURE_DIR,{recursive:true});await writeFile(join(process.env.KUN_PDF_FIXTURE_DIR,size+'.pdf'),bytes);}
  }
  assert.equal(await evalJs('(async()=>{try{await KunOrderDocumentPreview.pdfBlob({product:"a".repeat(40001)});return false}catch{return true}})()'),true);
  assert.deepEqual(await evalJs('__calls.map(c=>c.method)'),['GET'],'PDF generation must make no network requests');
  console.log('Customer document browser fixture passed: three PDF page sizes and valid xref offsets, long Arabic pagination, oversize rejection, escaped preview, no private notes/cost, focus restoration; one scoped GET and zero writes.');
}finally{await cleanupBrowser();await new Promise(r=>server.close(r));}

