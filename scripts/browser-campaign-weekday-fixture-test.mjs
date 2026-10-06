import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';

const load=async name=>process.env.CAMPAIGN_LIVE_BASE?fetch(process.env.CAMPAIGN_LIVE_BASE+'/v2/'+name).then(r=>{if(!r.ok)throw new Error('Asset HTTP '+r.status);return r.text()}):readFile(new URL('../public/v2/'+name.split('?')[0],import.meta.url),'utf8');
const uiSrc=await load('modules-v67-campaign-comparison-ux.js?v=67.3');
const hubSrc=await load('modules-v66-campaign-hub.js');
const visualSrc=await load('modules-v72-campaign-visual-density.js');
const loadedScripts=[];
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){
      res.setHeader('Content-Type','text/html');
      res.end('<div id="root"></div><script src="/v2/modules-v57-section-reload.js?v=57.3"></script>');return;
    }
    const name=req.url.slice('/v2/'.length);
    if(!/^modules-v\d+-[a-z-]+\.js(?:\?v=[\d.]+)?$/.test(name)){res.writeHead(404);res.end();return;}
    loadedScripts.push(name);res.setHeader('Content-Type','text/javascript');res.end(await load(name));
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null;

async function findChrome(){for(const path of [process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found for Campaign v72 fixture QA');}
async function waitDebugger(port){let last;for(let i=0;i<200;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(150);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function launch(executable){userDir=await mkdtemp(join(tmpdir(),'kun-campaign-v72-'));const port=9800+(randomBytes(2).readUInt16BE(0)%2500);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});let stderr='';chrome.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-8000);});try{return await waitDebugger(port);}catch(error){throw new Error(`${error.message}; Chrome exit=${chrome.exitCode??'running'}; ${stderr.trim()||'no diagnostic output'}`);}}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},12000);this.pending.set(id,{resolve,reject,t});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=7000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const v=await evalJs(expression);if(v)return v;}catch(e){last=e;}await sleep(100);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}

try{
  cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  await waitFor(`!!window.KunCampaignUXV67&&!!window.KunCampaignVisualDensityV72&&!!window.KunCampaignParentScopeV73`,'complete ordered campaign loader chain');
  for(const version of [66,67,68,70,71,72,73])if(loadedScripts.filter(name=>name.startsWith('modules-v'+version+'-')).length!==1)throw new Error('Campaign module loaded more than once: '+version);
  await evalJs(hubSrc);
  await evalJs(`window.firstHub=window.KunCampaignHubV66`);
  await evalJs(hubSrc);
  if(!await evalJs(`window.firstHub===window.KunCampaignHubV66`))throw new Error('Duplicate v66 replaced the hub state');
  await evalJs(`window.fixture={dates:['2026-09-04','2026-09-05','2026-09-11'],rows:[{name:'Fixture',status:'active',daily:[{spend:100,purchases:2,purchaseValue:300,impressions:1000,reach:500,clicks:20},{spend:50,purchases:1,purchaseValue:100,impressions:500,reach:250,clicks:10},{spend:300,purchases:3,purchaseValue:700,impressions:3000,reach:1000,clicks:30}],total:{spend:450,purchases:6}}]};for(const level of ['campaign','adset','ad'])Object.assign(KunCampaignHubV66.state.sections[level],{mode:'comparison',comparison:fixture});`);
  // Reproduce the already-enhanced old UI: no base table remains for v67 to find.
  await evalJs(`document.getElementById('root').innerHTML='<div class="campaign66"><div class="card" data-ux67="1"><div class="campaign67-comparison"><div class="ux67-head">Old</div><table class="ux67-matrix"><thead><tr><th>1 سبتمبر</th></tr></thead></table></div></div></div>';const old=document.createElement('style');old.id='kunCampaignUXV67Style';old.textContent='.old{}';document.head.appendChild(old);`);
  await evalJs(uiSrc);
  await waitFor(`!!document.querySelector('[data-ux67-view="weekday"]')`,'upgrade old comparison to weekday controls');
  await evalJs(`window.firstUX=window.KunCampaignUXV67`);await evalJs(uiSrc);
  if(!await evalJs(`window.firstUX===window.KunCampaignUXV67`))throw new Error('Duplicate v67 installed again');

  for(const level of ['campaign','adset','ad']){
    await evalJs(`KunCampaignHubV66.state.level=${JSON.stringify(level)};KunCampaignHubV66.render()`);
    await waitFor(`!!document.querySelector('[data-ux67-view="weekday"]')&&!!document.querySelector('[data-ux72-expand]')`,'date controls and compact view');
    if(!await evalJs(`document.querySelector('.ux67-matrix thead th:nth-child(2) b').textContent==='الجمعة'`))throw new Error('Date mode must show weekday as primary title');
    await evalJs(`document.querySelector('[data-ux67-view="weekday"]').click()`);
    await waitFor(`document.querySelector('[data-ux67-view-mode]').dataset.ux67ViewMode==='weekday'&&!!document.querySelector('[data-ux72-expand]')`,'weekday mode');
    const grouped=await evalJs(`KunCampaignUXV67.groupWeekdays(fixture.rows[0],fixture.dates)`);
    if(grouped.length!==2||grouped[0].label!=='السبت'||grouped[1].metric.cpp!==80||grouped[1].metric.roas!==2.5||grouped[1].metric.ctr!==1.25||grouped[1].metric.cpm!==100||grouped[1].metric.frequency!==2.67)throw new Error('Weekday aggregate ratios must derive from totals');
    if(!await evalJs(`document.querySelectorAll('.ux67-matrix thead th').length===4`))throw new Error('Repeated Friday was not combined');
    await evalJs(`document.querySelector('[data-ux72-expand]').click()`);
    if(!await evalJs(`document.querySelector('.campaign67-comparison').classList.contains('ux72-focus')`))throw new Error('Expanded view broken');
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('[data-ux67-view="date"]').click()`);
    await waitFor(`document.querySelectorAll('.ux67-matrix thead th').length===5`,'date mode restored');
  }
  console.log('Campaign browser regression passed: stale DOM upgrade, duplicate initialization, all three levels, weekday totals/ratios, date toggle and v72 expanded view.');
}finally{server.close();try{cdp?.close();}catch{}try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}/* Isolated temporary browser profile is intentionally left for OS cleanup. */}
