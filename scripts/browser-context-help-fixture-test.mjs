/* Browser regression for current, explicitly opt-in v147 help.
 * No production APIs, no live tenant state, no external dependencies except local Chrome. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const base=new URL('../public/v2/',import.meta.url);
const [help,css,index]=await Promise.all(
  ['kun-help-safe-v147.js','kun-help-safe-v147.css','index.html']
    .map(name=>readFile(new URL(name,base),'utf8'))
);
assert.match(index,/kun-help-safe-v147\.js\?v=147\.0/,'Current V2 must load safe opt-in help');
assert.match(index,/kun-help-safe-v147\.css\?v=147\.1/,'Current V2 must load safe help CSS');
assert.doesNotMatch(index,/kun-context-help-v146\.(?:js|css)/,'Old auto-injecting v146 help must not return');
assert.match(help,/ONLY explicitly-authored hint buttons/,'Help must remain opt-in, not scan all page elements');
new Function(help);
const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head>'+
'<body data-theme="light"><aside class="side"><nav class="nav"><button class="active" data-view="campaigns">الحملات</button>'+
'<button data-view="wallet">المحفظة</button></nav></aside><main><section id="root">'+
'<section class="campaign66"><h2>الحملات الإعلانية</h2><div class="kpi" id="roas-kpi"><span>ROAS</span><strong>1.5</strong></div>'+
'<table><thead><tr><th>Spend</th></tr></thead><tbody><tr><td>500</td></tr></tbody></table></section>'+
'</section></main><script>window.__helpErrors=[];window.addEventListener("error",e=>window.__helpErrors.push(e.message));</script>'+
'<script src="/help.js"></script></body></html>';
let requests=0;
const server=createServer((req,res)=>{
  if(req.url==='/help.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});res.end(help);return;}
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  requests++;res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function chromeBinary(){
  for(const path of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
    if(!path)continue;try{await access(path);return path;}catch{}
  }
  throw Error('Chrome required to test the current v147 help browser behavior');
}
class CDP{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data)),p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);});}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){this.ws.close();}
}
let chrome,profile,cdp;
async function evaluate(expression){
  const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression,label){
  for(let i=0;i<90;i++){try{if(await evaluate(expression))return;}catch{}await sleep(75);}
  throw Error('Timeout: '+label);
}
try{
  profile=await mkdtemp(join(tmpdir(),'kun-help147-'));
  const port=9000+randomBytes(2).readUInt16BE(0)%8000;
  chrome=spawn(await chromeBinary(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let websocket='';
  for(let i=0;i<90;i++){try{websocket=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(websocket)break;}catch{}await sleep(75);}
  if(!websocket)throw Error('Chromium debugging not ready');
  const ws=new WebSocket(websocket);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  cdp=new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await until('window.KunHelpSafeV147?.version==="147.0" && !!document.getElementById("kh147-guide-button")','v147 safe help + sidebar guide');
  assert.equal(await evaluate('document.querySelectorAll(".kh147-inline").length'),0,'Opt-in module cannot auto-mutate existing cards or table headers');
  assert.equal(await evaluate('document.getElementById("roas-kpi").querySelector("strong").textContent'),'1.5','Live metrics stay untouched');
  const explanation=await evaluate('({roas:KunHelpSafeV147.explain("ROAS","campaigns").caution,meta:KunHelpSafeV147.explain("Meta Purchases","campaigns").source,clarity:KunHelpSafeV147.explain("الجلسات","clarity").caution,cpp:KunHelpSafeV147.explain("Real CPP","campaigns").source})');
  assert.match(explanation.roas,/مش صافي ربح/);
  assert.match(explanation.meta,/Meta/);
  assert.match(explanation.clarity,/مش عدد الطلبات/);
  assert.match(explanation.cpp,/إجمالي مصروفات الإعلانات/);
  // Insert precisely-authored help buttons, as the real KPIs do.
  await evaluate('document.getElementById("roas-kpi").insertAdjacentHTML("beforeend",KunHelpSafeV147.icon("ROAS"))');
  await evaluate('document.querySelector("#roas-kpi .kh147-inline").focus();document.querySelector("#roas-kpi .kh147-inline").click()');
  await until('!!document.querySelector(".kh147-panel")','ROAS explanation dialog');
  assert.match(await evaluate('document.querySelector(".kh147-panel").innerText'),/مش صافي ربح/);
  assert.equal(await evaluate('document.querySelector(".kh147-panel").getAttribute("role")'),'dialog');
  assert.equal(await evaluate('document.querySelector(".kh147-panel").getAttribute("aria-modal")'),'true');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await until('!document.querySelector(".kh147-overlay")','Escape closes help');
  assert.equal(await evaluate('document.activeElement.classList.contains("kh147-inline")'),true,'Closing must restore focus to the requesting button');
  await evaluate('document.getElementById("root").insertAdjacentHTML("beforeend",\'<section id="wallet-metric"><span>الرصيد</span>\'+KunHelpSafeV147.icon("المحفظة")+\'</section>\')');
  await evaluate('document.querySelector("#wallet-metric .kh147-inline").click()');
  await until('document.querySelector(".kh147-panel")?.innerText.includes("المحفظة")','dynamic wallet explanation');
  await evaluate('document.querySelector(".kh147-close").click()');
  // Section guide uses the CURRENT section's safe, expandable list.
  await evaluate('document.getElementById("kh147-guide-button").click()');
  await until('document.querySelectorAll(".kh147-item").length>=6','section guide topics');
  assert.match(await evaluate('document.querySelector(".kh147-panel").innerText'),/Spend|ROAS/);
  await evaluate('document.querySelector(".kh147-close").click()');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:360,height:720,deviceScaleFactor:1,mobile:true});
  await evaluate('document.body.dataset.theme="dark";document.querySelector("#roas-kpi .kh147-inline").click()');
  await until('!!document.querySelector(".kh147-overlay")','help on mobile dark theme');
  assert.equal(await evaluate('document.querySelector(".kh147-panel").getAttribute("aria-modal")'),'true');
  assert.ok((await evaluate('document.querySelector(".kh147-panel").getBoundingClientRect().width'))<=360,'Help panel cannot overflow mobile viewport');
  assert.deepEqual(await evaluate('window.__helpErrors'),[]);
  assert.equal(await evaluate('document.querySelectorAll(".kh147-inline").length'),2,'Only authored buttons were inserted');
  assert.equal(await evaluate('document.getElementById("roas-kpi").querySelector("strong").textContent'),'1.5','KPI never rewritten');
  assert.ok(requests<=1,'No provider APIs or external tenant data were requested');
  console.log('TST-02 contextual help v147 browser PASS: opt-in, ROI/Meta/Clarity, keyboard focus, dynamic authored icons, section guide, mobile and dark mode');
}finally{
  try{cdp?.close();}catch{}
  if(chrome){const exited=new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();chrome.once('exit',resolve);});chrome.kill('SIGTERM');await Promise.race([exited,sleep(1800)]);}
  await new Promise(resolve=>server.close(resolve));
  if(profile)await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
