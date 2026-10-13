/* Browser test for Kun Online contextual help. No production access. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const base=new URL('../public/v2/',import.meta.url);
const [help,css,index]=await Promise.all(['kun-context-help-v146.js','kun-context-help-v146.css','index.html'].map(n=>readFile(new URL(n,base),'utf8')));
assert.ok(index.includes('kun-context-help-v146.js?v=146.0'));
assert.ok(index.includes('kun-context-help-v146.css?v=146.0'));
assert.ok(help.includes('Microsoft Clarity')&&help.includes('Meta Purchases')&&help.includes('المحفظة'));
new Function(help);
const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body data-theme="light">'
+'<nav class="nav"><button data-view="campaigns" class="active">الحملات</button><button data-view="wallet">المحفظة</button></nav><section id="root">'
+'<div class="cl136"><div class="page-head"><div class="title">تحليل سلوك العملاء</div></div><section class="box"><h3>ماذا تقول بيانات Clarity؟</h3><div class="brief-card"><span>الجلسات</span><strong>120</strong></div></section></div>'
+'<section class="campaign66"><h3>تحليل الحملات الإعلانية</h3><table><thead><tr><th>Spend</th><th>CPP</th><th>ROAS</th></tr></thead></table><div class="card kpi"><small>Frequency</small><strong>1.5</strong></div></section>'
+'<div class="toolbar"><label>الفترة<input type="date"></label></div></section>'
+'<script>window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(e.message);});</script>'
+'<script src="/help.js"></script></body></html>';
const server=createServer((req,res)=>{
 if(req.url==='/help.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});res.end(help);}
 else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function chromeBinary(){
 for(const p of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
  if(!p)continue;try{await access(p);return p;}catch{}
 }
 throw Error('Chrome required for contextual help browser regression');
}
class CDP{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data));const p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
let chrome,profile,cdp;
async function evaluate(expression){
 const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result.value;
}
async function until(expression,message){
 for(let i=0;i<80;i++){try{if(await evaluate(expression))return;}catch{}await sleep(75);}
 throw Error('Timeout: '+message);
}
try{
 profile=await mkdtemp(join(tmpdir(),'kun-help146-'));
 const port=9000+randomBytes(2).readUInt16BE(0)%8000;
 chrome=spawn(await chromeBinary(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let websocket='';
 for(let i=0;i<80;i++){try{websocket=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(websocket)break;}catch{}await sleep(75);}
 if(!websocket)throw Error('Chromium debugging not ready');
 const ws=new WebSocket(websocket);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);
 await cdp.send('Runtime.enable');
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await until('window.KunContextHelpV146 && document.querySelectorAll("#root .kun146-help").length>=7','help icons');
 assert.deepEqual(await evaluate('window.__errors'),[]);
 const details=await evaluate('(function(){var h=window.KunContextHelpV146;return {clarity:h.explain("الجلسات","clarity","metric").caution,meta:h.explain("Meta Purchases","ads","metric").source,roas:h.explain("ROAS","ads","metric").source,real:h.explain("Real CPP","ads","metric").source};})()');
 assert.match(details.clarity,/مش عدد الطلبات/);
 assert.match(details.meta,/Meta/);
 assert.match(details.roas,/÷/);
 assert.match(details.real,/إجمالي مصروفات الإعلانات/);
 await evaluate('document.querySelector(".cl136 .brief-card .kun146-help").click()');
 await until('!!document.querySelector(".kun146-help-card")','help open');
 assert.match(await evaluate('document.querySelector(".kun146-help-card").innerText'),/جلسات/);
 assert.equal(await evaluate('document.querySelector(".kun146-help-card").getAttribute("role")'),'dialog');
 await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 await until('!document.querySelector(".kun146-help-card")','Escape closes');
 await evaluate('document.getElementById("root").insertAdjacentHTML("beforeend","<section class=card><h3>المحفظة</h3><div class=kpi><small>الرصيد</small><strong>500</strong></div></section>")');
 await until('!![...document.querySelectorAll("#root h3 .kun146-help")].find(x=>x.dataset.kunHelpLabel==="المحفظة")','async help injection');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:720,deviceScaleFactor:1,mobile:true});
 await evaluate('document.querySelector(".campaign66 th .kun146-help").click()');
 await until('!!document.querySelector(".kun146-help-card")','mobile open');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".kun146-help-backdrop")).display'),'block');
 assert.equal(await evaluate('document.querySelector(".kun146-help-card").getAttribute("aria-modal")'),'true');
 await evaluate('document.querySelector(".kun146-help-close").click();document.body.dataset.theme="dark";document.querySelector(".campaign66 th .kun146-help").click()');
 await until('!!document.querySelector(".kun146-help-card")','dark open');
 assert.deepEqual(await evaluate('window.__errors'),[]);
 console.log('Kun contextual help browser test: PASS — Clarity, Meta, keyboard, async render, mobile, dark theme');
}finally{
 try{cdp?.close();}catch{}
 if(chrome){
  const exited=new Promise(resolve=>{
   if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();
   chrome.once('exit',resolve);
  });
  chrome.kill('SIGTERM');
  await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1800))]);
 }
 await new Promise(r=>server.close(r));
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
