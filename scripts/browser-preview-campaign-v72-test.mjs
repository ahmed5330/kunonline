import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/browser-preview-campaign-v72-test.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview Campaign v72 browser QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const entrySource=await readFile(new URL('../src/index-commerce-v36.js',import.meta.url),'utf8');
const expectedBuild=entrySource.match(/const BUILD=['"]([^'"]+)['"]/i)?.[1]||'';
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!expectedBuild||!databaseId)throw new Error('Preview Campaign v72 browser QA setup is incomplete');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex'),email=`qa-campaign-v72-${nonce}@example.test`,userId=`QA-CAMP-V72-${nonce}`,password=`CampaignV72!${randomBytes(10).toString('hex')}Aa1`,createdAt=new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null,chromeErr='';

async function d1(sql,params=[]){const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),payload=await response.json().catch(()=>({})),result=payload?.result?.[0];if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 query failed (${response.status}): ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);return result?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function cleanup(){await d1('DELETE FROM login_attempts WHERE email=?',[email]);await d1('DELETE FROM users WHERE email=?',[email]);}
async function findChrome(){for(const path of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found');}
async function waitDebugger(port){let last;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(200);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'} ${chromeErr.slice(-500)}`);}
async function launch(executable){userDir=await mkdtemp(join(tmpdir(),'kun-campaign-v72-live-'));const port=9700+(randomBytes(2).readUInt16BE(0)%3000);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});chrome.stderr.on('data',d=>{chromeErr=(chromeErr+String(d)).slice(-10000);});return waitDebugger(port);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.listeners=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}for(const fn of this.listeners.get(m.method)||[])fn(m.params||{});}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);this.pending.set(id,{resolve,reject,t});this.ws.send(JSON.stringify({id,method,params}));});}on(method,fn){if(!this.listeners.has(method))this.listeners.set(method,new Set());this.listeners.get(method).add(fn);}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=15000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await evalJs(expression);if(value)return value;}catch(e){last=e;}await sleep(150);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}
async function navigate(url){await cdp.send('Page.navigate',{url});await waitFor(`document.readyState==='complete'`,'document ready');}

let primaryError=null;
try{
  await cleanup();await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'CI Campaign v72 Browser',await hashPassword(password),'admin','active',createdAt]);
  cdp=await connect(await launch(await findChrome()));const exceptions=[],consoleErrors=[],serverErrors=[];
  cdp.on('Runtime.exceptionThrown',p=>exceptions.push(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'uncaught exception'));
  cdp.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')consoleErrors.push((p.args||[]).map(x=>x.value??x.description??'').join(' '));});
  cdp.on('Network.responseReceived',p=>{const status=Number(p.response?.status)||0,url=p.response?.url||'';if(status>=500&&url.startsWith(base))serverErrors.push(`${status} ${url}`);});
  for(const method of ['Page.enable','Runtime.enable','Network.enable'])await cdp.send(method);
  await navigate(`${base}/healthz`);
  const login=await evalJs(`(async()=>{const r=await fetch('/api/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email,password})})});return {status:r.status,text:(await r.text()).slice(0,300)}})()`);if(login?.status!==200)throw new Error(`Campaign v72 browser login failed ${login?.status}: ${login?.text||''}`);
  const version=await evalJs(`(async()=>{const r=await fetch('/api/preview/version',{credentials:'include',cache:'no-store'});return r.json()})()`);if(version?.build!==expectedBuild)throw new Error(`Campaign v72 browser is not on exact build ${expectedBuild}; got ${version?.build||'unknown'}`);
  await navigate(`${base}/v2/`);
  await waitFor(`!!window.KunCampaignHubV66&&!!window.KunCampaignComparisonUXV67&&!!window.KunCampaignVisualDensityV72&&document.documentElement.dataset.campaignVisualDensity==='v72-ready'`,'Campaign v66/v67/v72 layers');
  exceptions.length=0;consoleErrors.length=0;serverErrors.length=0;

  await evalJs(`(()=>{
    window.__kunV72OriginalFetch=window.fetch.bind(window);window.__kunV72Requests=[];
    window.kunClientId=async()=> 'QA-V72-CLIENT';window.kunStoreId=async()=> '';
    const hub={ok:true,campaigns:{rows:[{id:'QA-CAMPAIGN',name:'QA Campaign — Compact View',status:'active',spend:220,platformPurchases:9,platformPurchaseValue:1400,impressions:21000,clicks:420,realOrders:8,deliveredRevenue:1250}]},adsets:{rows:[]},ads:{rows:[]},recommendations:[],breakdownCatalog:[{id:'image_asset',group:'الكرياتيف',label:'الصورة'}]};
    const comparison={ok:true,level:'campaign',dates:['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06','2026-09-07'],rows:[{id:'QA-CAMPAIGN',name:'QA Campaign — Compact View',status:'active',daily:[
      {spend:100,purchases:4,cpp:25,roas:3.2,ctr:2.4,cpm:10,frequency:1.2},{spend:120,purchases:5,cpp:24,roas:4.1,ctr:2.7,cpm:11,frequency:1.25},{spend:150,purchases:3,cpp:50,roas:2.1,ctr:1.8,cpm:13,frequency:1.4},{spend:90,purchases:4,cpp:22.5,roas:4.8,ctr:3.1,cpm:9,frequency:1.35},{spend:130,purchases:5,cpp:26,roas:4.4,ctr:2.9,cpm:10.5,frequency:1.45},{spend:160,purchases:0,cpp:0,roas:0,ctr:1.6,cpm:14,frequency:1.7},{spend:140,purchases:6,cpp:23.33,roas:5.2,ctr:3.3,cpm:10,frequency:1.55}],total:{spend:890,purchases:27,cpp:32.96,roas:3.7,ctr:2.5,cpm:11.1,frequency:1.43}}]};
    window.fetch=(input,init={})=>{const raw=typeof input==='string'?input:input?.url||String(input),u=new URL(raw,location.href);if(u.pathname==='/api/integrations/meta-ads/campaign-hub'){window.__kunV72Requests.push('hub');return Promise.resolve(new Response(JSON.stringify(hub),{status:200,headers:{'Content-Type':'application/json'}}));}if(u.pathname==='/api/integrations/meta-ads/daily-comparison'){window.__kunV72Requests.push('comparison');return Promise.resolve(new Response(JSON.stringify(comparison),{status:200,headers:{'Content-Type':'application/json'}}));}return window.__kunV72OriginalFetch(input,init);};return true;
  })()`);

  const clicked=await evalJs(`(()=>{const b=document.querySelector('[data-view="campaigns"]');if(!b)return false;b.click();return true})()`);if(!clicked)throw new Error('Campaign navigation click failed');
  await waitFor(`!!document.querySelector('.campaign66')&&window.KunCampaignHubV66.state.level==='campaign'`,'Campaign workspace');
  const comparisonClick=await evalJs(`(()=>{const b=document.querySelector('.campaign66 [data-section-mode="comparison"]');if(!b)return false;b.click();return true})()`);if(!comparisonClick)throw new Error('Campaign comparison button missing');
  await waitFor(`!!document.querySelector('.campaign67-comparison')&&document.querySelectorAll('.ux67-value[data-ux72-metric]').length>=20&&!!document.querySelector('[data-ux72-expand]')`,'v72 comparison render');

  const visual=await evalJs(`(()=>{const matrix=document.querySelector('.ux67-matrix'),first=matrix.querySelector('.ux67-value[data-ux72-metric="spend"]'),metric=matrix.querySelector('.ux67-metric-col'),total=matrix.querySelector('tbody td:last-child'),scroll=matrix.closest('.ux67-scroll'),kpis=[...document.querySelectorAll('.campaign66 .kpi[data-ux72-kpi]')].map(x=>x.dataset.ux72Kpi),bg=getComputedStyle(first).backgroundColor;return {bg,valueWidth:first.getBoundingClientRect().width,metricWidth:metric.getBoundingClientRect().width,totalPosition:getComputedStyle(total).position,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,kpis,metricCount:new Set([...matrix.querySelectorAll('.ux67-value[data-ux72-metric]')].map(x=>x.dataset.ux72Metric)).size};})()`);
  if(!visual.bg||visual.bg==='rgba(0, 0, 0, 0)')throw new Error(`v72 numeric background is transparent: ${JSON.stringify(visual)}`);
  if(visual.valueWidth>76||visual.metricWidth>165)throw new Error(`v72 comparison cells are not compact: ${JSON.stringify(visual)}`);
  if(visual.totalPosition!=='sticky')throw new Error(`v72 period total is not sticky: ${JSON.stringify(visual)}`);
  if(visual.metricCount!==7)throw new Error(`v72 metric color coverage incomplete: ${JSON.stringify(visual)}`);
  if(!(visual.scrollWidth>visual.clientWidth))throw new Error(`v72 comparison does not expose useful horizontal density/scroll: ${JSON.stringify(visual)}`);

  const opened=await evalJs(`(()=>{const b=document.querySelector('[data-ux72-expand]');b.click();const c=document.querySelector('.campaign67-comparison');return c.classList.contains('ux72-focus')&&document.body.classList.contains('ux72-no-scroll')&&b.getAttribute('aria-pressed')==='true';})()`);if(!opened)throw new Error('v72 expanded comparison did not open');
  const focused=await evalJs(`(()=>{const c=document.querySelector('.campaign67-comparison');const r=c.getBoundingClientRect();return {width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()`);if(focused.width<focused.viewportWidth*.8||focused.height<focused.viewportHeight*.8)throw new Error(`v72 expanded comparison is not visually large enough: ${JSON.stringify(focused)}`);
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await waitFor(`!document.querySelector('.campaign67-comparison').classList.contains('ux72-focus')&&!document.body.classList.contains('ux72-no-scroll')`,'v72 expanded view closes with Escape');

  const requests=await evalJs(`window.__kunV72Requests`);if(!requests?.includes('hub')||!requests?.includes('comparison'))throw new Error(`v72 Campaign request flow incomplete: ${JSON.stringify(requests)}`);
  await sleep(300);if(exceptions.length||consoleErrors.length||serverErrors.length)throw new Error(`Campaign v72 browser runtime errors: exceptions=${exceptions.slice(0,3).join(' | ')} console=${consoleErrors.slice(0,3).join(' | ')} 5xx=${serverErrors.slice(0,3).join(' | ')}`);
  console.log(`Browser Campaign v72 Preview QA passed on exact build ${expectedBuild}: colored numeric backgrounds, compact cells, seven metric surfaces, sticky period total and full-screen comparison focus are live.`);
}catch(error){primaryError=error;
}finally{try{cdp?.close();}catch{}try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}try{await cleanup();}catch(e){primaryError=primaryError?new Error(`${primaryError.message}; cleanup failed: ${e.message}`):e;}}
if(primaryError)throw primaryError;