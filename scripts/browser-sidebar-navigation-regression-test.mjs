import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

const base=new URL('../public/v2/',import.meta.url);
const [index,app,groups,permissions,persistence,css]=await Promise.all([
 'index.html','app-v3.js','modules-v90-sidebar-groups.js',
 'modules-v51-permission-navigation.js','modules-v97-view-persistence-v976.js','kun-v17.css'
].map(path=>readFile(new URL(path,base),'utf8')));
const htmlNav=index.match(/<nav class="nav">([\s\S]*?)<\/nav>/)?.[1];
assert.ok(htmlNav&&htmlNav.includes('data-view="inventory"'),'Real V2 nav markup is required');
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head>'+
'<body><div class="app"><aside class="side"><nav class="nav">'+htmlNav+'</nav></aside><main class="main">'+
'<button id="quickBtn">إضافة</button><input id="globalSearch"><section id="root"></section></main>'+
'<aside id="drawer"></aside><div id="drawerBack"></div><div id="toast"></div></div>'+
'<script>window.fetch=(url,opts)=>{const p=String(url);const d=p.includes("/api/navigation-access")?{role:"admin",permissions:["*"]}:p.includes("/api/state")?{orders:[],clients:[],products:[]}:[];return Promise.resolve({ok:true,status:200,json:async()=>d});};window.__navErrors=[];window.addEventListener("error",e=>window.__navErrors.push(e.message));</script>'+
'<script src="/v2/app-v3.js"></script><script src="/v2/modules-v97-view-persistence-v976.js"></script>'+
'<script src="/v2/modules-v51-permission-navigation.js"></script><script src="/v2/modules-v90-sidebar-groups.js"></script></body></html>';

const srcs={
 '/v2/app-v3.js':app,
 '/v2/modules-v97-view-persistence-v976.js':persistence,
 '/v2/modules-v51-permission-navigation.js':permissions,
 '/v2/modules-v90-sidebar-groups.js':groups
};
const server=createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture);return;}
 res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});
 res.end(srcs[req.url]||'/* no-op support module in isolated fixture */');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const findChrome=async()=>{
 for(const path of [process.env.KUN_CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
  if(!path)continue;try{await access(path);return path;}catch{}
 }
 throw Error('Chrome/Chromium is required for sidebar nav regression');
};
class CDP{
 constructor(ws){this.ws=ws;this.i=0;this.pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.i,timer=setTimeout(()=>reject(Error('Timeout '+method)),12000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 close(){this.ws.close();}
}
let chrome,cdp,profile;
async function evalJs(expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function waitFor(expression,label){for(let i=0;i<75;i++){try{if(await evalJs(expression))return;}catch{}await sleep(75);}throw Error('Could not reach '+label+': '+expression);}
const active=()=>evalJs('document.querySelector(".nav button[data-view].active")?.dataset.view');
const groupOpen=id=>evalJs('document.querySelector(".nav-group[data-nav-group='+JSON.stringify(id)+']")?.classList.contains("is-open")');
const openGroup=async id=>{
 await evalJs('document.querySelector(".nav-group[data-nav-group='+JSON.stringify(id)+'] > .nav-group-toggle").click()');
 await sleep(180);assert.equal(await groupOpen(id),true,'Group '+id+' must stay expanded, including while another group holds the active route');
};
const routeClick=async route=>{
 await evalJs('document.querySelector(".nav button[data-view='+JSON.stringify(route)+']").click()');
 await waitFor('document.querySelector(".nav button[data-view].active")?.dataset.view==='+JSON.stringify(route),'active route '+route);
};
try{
 profile=await mkdtemp(join(tmpdir(),'kun-nav-regression-'));
 const port=9000+(randomBytes(2).readUInt16BE(0)%8000);
 chrome=spawn(await findChrome(),['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let url='';
 for(let i=0;i<80;i++){try{url=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page')?.webSocketDebuggerUrl||'';if(url)break;}catch{}await sleep(75);}
 if(!url)throw Error('Chrome debugger unavailable');
 const ws=new WebSocket(url);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 cdp=new CDP(ws);
 await cdp.send('Runtime.enable');
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await waitFor('document.querySelector(".nav.kun-nav-grouped") && window.KunPermissionNavigationV51?.snapshot?.role === "admin" && !!window.KunSidebarGroupsV90','grouped sidebar + access ready');
 assert.equal(await active(),'dashboard');
 assert.equal(await evalJs('document.querySelectorAll(".nav-group").length'),8);

 // Reproduce the reported fault: inventory active; open another group without dashboard detour.
 await openGroup('stock');await routeClick('inventory');await sleep(110);
 assert.equal(await groupOpen('stock'),true);
 await openGroup('sales');
 assert.equal(await groupOpen('stock'),false,'The former active group must not hijack the open group');
 assert.equal(await active(),'inventory','Opening another group must not change the current page');
 await routeClick('orders');await sleep(110);
 assert.equal(await groupOpen('sales'),true);
 assert.equal(await active(),'orders');

 // Every parent group + every visible child route must work from other groups directly.
 const groupsAndChildren=await evalJs('[...document.querySelectorAll(".nav-group")].map(g=>({id:g.dataset.navGroup,routes:[...g.querySelectorAll(".nav-group-items>button[data-view]")].filter(x=>!x.hidden&&x.style.display!=="none").map(x=>x.dataset.view)}))');
 let examined=0;
 for(const item of groupsAndChildren){
  const initiallyOpen=await groupOpen(item.id);
  if(!initiallyOpen)await openGroup(item.id);
  for(const route of item.routes){
   await routeClick(route);await sleep(22);
   assert.equal(await groupOpen(item.id),true,'Active child group must remain expanded for '+route);
   assert.equal(await evalJs('document.querySelector(".nav button[data-view='+JSON.stringify(route)+']").getAttribute("aria-hidden")'),'false','Route visible '+route);
   examined++;
  }
  // Moving to another parent must not reopen this group's active item on a class observer tick.
  const other=item.id==='stock'?'logistics':'stock';
  if(await groupOpen(other))continue;
  await openGroup(other);
  assert.equal(await groupOpen(item.id),false,'Previous group must stay collapsed after changing parent');
 }
 assert.ok(examined>=30,'Expected comprehensive coverage of all visible subsection routes');

 // Direct dashboard and back, and manual collapse of current group, stay functional.
 await routeClick('dashboard');await openGroup('stock');await routeClick('inventory');
 assert.equal(await groupOpen('stock'),true);
 await evalJs('document.querySelector(".nav-group[data-nav-group=stock]>.nav-group-toggle").click()');
 await sleep(180);
 assert.equal(await groupOpen('stock'),false,'Manually collapsing the active group should remain collapsed');
 assert.equal(await active(),'inventory');
 await openGroup('finance');await routeClick('finance');assert.equal(await active(),'finance');
 await routeClick('dashboard');assert.equal(await active(),'dashboard');

 // Mobile-sized layout uses the same parent/child routing semantics.
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await openGroup('stock');await routeClick('inventory');
 await openGroup('growth');await routeClick('campaigns');await sleep(110);
 assert.equal(await active(),'campaigns');
 assert.equal(await groupOpen('growth'),true);
 assert.equal(await groupOpen('stock'),false);
 assert.deepEqual(await evalJs('window.__navErrors'),[]);
 console.log('Sidebar navigation browser fixture PASSED: inventory→sales and every grouped subsection ('+examined+' routes), independent accordion toggles, permissions, dashboard, mobile.');
}finally{
 try{cdp?.close();}catch{}
 if(chrome&&!chrome.killed)chrome.kill('SIGTERM');
 await sleep(120);if(profile)await rm(profile,{recursive:true,force:true});
 await new Promise(resolve=>server.close(resolve));
}
