/* Browser regression for safe opt-in help; uses only fixture data, never production. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const base=new URL('../public/v2/',import.meta.url);
const [code,css,index,clarity,campaign,setup]=await Promise.all([
 'kun-help-safe-v147.js','kun-help-safe-v147.css','index.html',
 'modules-v136-clarity-growth.js','modules-v66-campaign-hub.js','modules-v135-clarity.js'
].map(file=>readFile(new URL(file,base),'utf8')));
assert.ok(index.includes('kun-help-safe-v147.js?v=147.0'),'Safe script must be registered');
assert.ok(index.includes('kun-help-safe-v147.css?v=147.0'),'Safe style must be registered');
assert.ok(!index.includes('kun-context-help-v146'),'Invasive v146 must remain disabled');
assert.ok(index.indexOf('kun-help-safe-v147.js')<index.indexOf('modules-v135-clarity.js'));
assert.ok(!code.includes('new MutationObserver('),'Safe help must never crawl mutable page content');
assert.ok(!code.includes('querySelectorAll("th")')&&!code.includes('root.innerHTML'),'Help cannot rebuild existing views');
for(const source of [clarity,campaign,setup])assert.ok(source.includes('KunHelpSafeV147?.icon'),'Help must be explicitly authored by renderer');
new Function(code);
const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body data-theme="light">'
 +'<aside class="side"><div class="kun143-primary"></div><details class="kun143-secondary"></details><nav class="nav"><button class="active" data-view="campaigns">الحملات</button><button data-view="wallet">المحفظة</button></nav></aside>'
 +'<section id="root"><h3>تحليل الحملات</h3><button id="original">إجراء أصلي</button><table><thead><tr><th>Spend</th></tr></thead></table></section>'
 +'<script>window.__err=[];window.__hits=0;window.addEventListener("error",e=>__err.push(e.message));document.getElementById("original").onclick=()=>window.__hits++;</script>'
 +'<script src="/help.js"></script></body></html>';
const server=createServer((req,res)=>{
 res.setHeader('Content-Type',req.url==='/help.js'?'application/javascript; charset=utf-8':'text/html; charset=utf-8');
 res.end(req.url==='/help.js'?code:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function chromeBinary(){
 for(const file of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
  if(!file)continue;try{await access(file);return file;}catch{}
 }
 throw Error('Chrome required');
}
class CDP{
 constructor(ws){this.ws=ws;this.n=0;this.pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(String(event.data)),task=this.pending.get(m.id);if(!task)return;clearTimeout(task.timer);this.pending.delete(m.id);m.error?task.reject(Error(m.error.message)):task.resolve(m.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),14000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
let chrome,cdp,profile;
async function run(code){
 const result=await cdp.send('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true,userGesture:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result.value;
}
async function ready(expr,label){
 for(let i=0;i<80;i++){try{if(await run(expr))return;}catch{}await sleep(75);}
 throw Error('Wait timeout for '+label);
}
try{
 profile=await mkdtemp(join(tmpdir(),'kun-safe-help-'));
 const port=9000+randomBytes(2).readUInt16BE(0)%8000;
 chrome=spawn(await chromeBinary(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let wsUrl='';
 for(let i=0;i<90;i++){try{wsUrl=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page')?.webSocketDebuggerUrl||'';if(wsUrl)break;}catch{}await sleep(75);}
 if(!wsUrl)throw Error('Chrome debug port did not open');
 const ws=new WebSocket(wsUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);
 await cdp.send('Runtime.enable');
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await ready('!!window.KunHelpSafeV147 && !!document.getElementById("kh147-guide-button")','safe sidebar guide');
 assert.equal(await run('document.querySelectorAll("#root .kh147-inline").length'),0,'No unrequested icons can be injected');
 const snapshot=await run('document.getElementById("root").innerHTML');
 const encoded=await run('window.KunHelpSafeV147.icon("<img src=x onerror=alert(1)>")');
 assert.ok(encoded.includes('&lt;img')&&encoded.includes('&gt;'),'Help labels must be HTML-escaped');
 await run('document.getElementById("original").click()');
 assert.equal(await run('window.__hits'),1,'Original app handlers still work');
 await run('document.getElementById("kh147-guide-button").click()');
 await ready('!!document.querySelector(".kh147-panel")','desktop guide');
 assert.equal(await run('document.querySelector(".kh147-panel").getAttribute("role")'),'dialog');
 assert.equal(await run('document.getElementById("root").innerHTML'),snapshot,'Opening the guide must not modify the page');
 assert.ok((await run('document.querySelectorAll(".kh147-item").length'))>=10,'Campaign help must cover key metrics');
 await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 await ready('!document.querySelector(".kh147-panel")','Escape closes panel');
 await run('document.getElementById("root").insertAdjacentHTML("beforeend",window.KunHelpSafeV147.icon("ROAS"))');
 assert.equal(await run('document.querySelectorAll("#root .kh147-inline").length'),1);
 await run('document.querySelector("#root .kh147-inline").click()');
 await ready('!!document.querySelector(".kh147-panel")','metric popup');
 assert.match(await run('document.querySelector(".kh147-panel").innerText'),/قيمة المشتريات|العائد على الصرف/);
 await run('document.querySelector(".kh147-close").click();document.querySelector(".nav [data-view=campaigns]").classList.remove("active");document.querySelector(".nav [data-view=wallet]").classList.add("active")');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:720,deviceScaleFactor:1,mobile:true});
 await run('document.body.dataset.theme="dark";document.getElementById("kh147-guide-button").click()');
 await ready('!!document.querySelector(".kh147-panel")','mobile wallet help');
 assert.match(await run('document.querySelector(".kh147-panel").innerText'),/المحفظة/);
 assert.equal(await run('getComputedStyle(document.querySelector(".kh147-panel")).position'),'absolute');
 assert.equal(await run('window.__err.length'),0,'No errors in test browser');
 console.log('Kun v147 SAFE help: PASS — opt-in icons, context, original actions, focus/Escape, mobile/dark, no page mutation');
}finally{
 try{cdp?.close();}catch{}
 if(chrome){
  const exited=new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();chrome.once('exit',resolve);});
  chrome.kill('SIGTERM');await Promise.race([exited,sleep(1800)]);
 }
 await new Promise(resolve=>server.close(resolve));
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
