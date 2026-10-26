import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const asset=await readFile(process.env.KUN_DASHBOARD_FIXTURE_ASSET||new URL('../public/v2/modules-v122-dashboard-experience.js',import.meta.url),'utf8');
const unified=await readFile(new URL('../public/v2/modules-v123-dashboard-unified.js',import.meta.url),'utf8');
const html='<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}#root{box-sizing:border-box;width:100%;padding:16px}.dash-period-toolbar{height:10px}</style></head><body><nav class="nav" hidden><button class="active" data-view="dashboard">dashboard</button></nav><div id="root"><div class="v33-dashboard"><div class="dash-period-toolbar"></div><section data-dash-section="trend"><div class="dash-section-head"><div><h2>trend</h2><p>data</p></div></div><div class="dash-trend-head"></div></section></div></div><script>window.__errors=[];addEventListener("error",e=>__errors.push(e.message));</script><script src="/dashboard.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/dashboard.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/dashboard.js'?asset:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let profile,browser,cdp;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
 profile=await mkdtemp(join(tmpdir(),'dashboard-navigation-'));
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

 for(const width of [360,390]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await waitFor('document.querySelectorAll(".dash-x-nav button").length===7');
  const result=await evaluate(`(()=>{const width=innerWidth;return {width,overflow:document.documentElement.scrollWidth-width,bad:[...document.querySelectorAll('.dash-x-nav button')].map(x=>x.getBoundingClientRect()).filter(r=>r.left<0||r.right>width||r.width>width).map(r=>({left:r.left,right:r.right,width:r.width})),errors:window.__errors};})()`);
  assert.equal(result.width,width);assert.ok(result.overflow<=1,'Dashboard must fit the mobile viewport');
  assert.deepEqual(result.bad,[],'Every dashboard section button must remain visible without off-screen content');
  assert.deepEqual(result.errors,[]);
 }
 // Observe the actual enhancer pair with a partial section set, a warning,
 // and a provinces list. An unchanged page must settle, preserve nodes/focus
 // and still accept later real content replacements.
 await evaluate(`document.querySelector('.v33-dashboard').insertAdjacentHTML('beforeend','<div id="sync-warning">Synthetic sync warning</div><section data-dash-section="ads"><div class="dash-section-head"><div><h2>Ads</h2><p>Ads data</p></div><div class="dash-section-actions"></div></div></section><section data-dash-section="provinces"><div class="dash-section-head"><div><h2>Provinces</h2><p>Province data</p></div></div><div class="dash-province-list">List</div><div class="dash-table-wrap">Table</div></section>');`);
 await evaluate(unified);
 await evaluate(`window.__mutationCount=0;window.__stabilityObserver=new MutationObserver(records=>{window.__mutationCount+=records.length});__stabilityObserver.observe(document.getElementById('root'),{childList:true,subtree:true});`);
 await sleep(1800);
 const before=await evaluate(`window.__mutationCount`);
 await sleep(500);
 assert.equal(await evaluate(`window.__mutationCount`),before,'Unchanged dashboard must stop mutating instead of continuously reordering/relabeling sections');
 await evaluate(`window.__warning=document.getElementById('sync-warning');window.__tab=document.querySelector('[data-du-province="table"]');__tab.focus();__tab.click();`);
 await sleep(300);
 assert.equal(await evaluate(`document.activeElement===window.__tab&&document.getElementById('sync-warning')===window.__warning&&!document.querySelector('[data-dash-section="provinces"] .dash-table-wrap').classList.contains('dash-u-province-hidden')`),true,'Controls, focus and warning must survive enhancement');
 await evaluate(`document.querySelector('[data-dash-section="ads"] h2').textContent='Replacement heading';`);
 await sleep(300);
 assert.equal(await evaluate(`document.querySelector('[data-dash-section="ads"] h2').textContent`),'الإعلانات النشطة الآن','A real DOM update must still receive dashboard formatting');
 console.log('PASS: actual dashboard navigation keeps all seven section buttons visible at 360px and 390px in RTL.');
}finally{
 cdp?.close();
 if(browser&&browser.exitCode===null){const stopped=new Promise(resolve=>browser.once('exit',resolve));browser.kill('SIGTERM');await Promise.race([stopped,sleep(3000)]);if(browser.exitCode===null){browser.kill('SIGKILL');await stopped;}}
 await new Promise(resolve=>server.close(resolve));
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
