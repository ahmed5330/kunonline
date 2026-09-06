import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const uiSrc=await readFile(new URL('../public/v2/modules-v72-campaign-visual-density.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null;

async function findChrome(){for(const path of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found for Campaign v72 fixture QA');}
async function waitDebugger(port){let last;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(150);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function launch(executable){userDir=await mkdtemp(join(tmpdir(),'kun-campaign-v72-'));const port=9800+(randomBytes(2).readUInt16BE(0)%2500);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});return waitDebugger(port);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},12000);this.pending.set(id,{resolve,reject,t});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=7000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const v=await evalJs(expression);if(v)return v;}catch(e){last=e;}await sleep(100);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}

try{
  cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');
  await evalJs(`(()=>{
    document.documentElement.style.setProperty('--card','#ffffff');document.documentElement.style.setProperty('--line','#e5e7eb');document.documentElement.style.setProperty('--bg','#f8fafc');
    const metricRows=['الإنفاق','المشتريات','تكلفة الشراء','العائد على الإنفاق','نسبة النقر','تكلفة ألف ظهور','التكرار'];
    const hints=['Spend','Purchases','CPP','ROAS','CTR','CPM','Frequency'];
    const values=['120 ج','4','30 ج','4x','2.4%','12 ج','1.3'];
    const rows=metricRows.map((label,i)=>'<tr><th class="ux67-metric-col"><b>'+label+'</b><small>'+hints[i]+'</small></th><td><span class="ux67-value">'+values[i]+'</span></td><td><span class="ux67-value '+(i===3?'good':'')+'">'+values[i]+'</span></td><td><span class="ux67-value">'+values[i]+'</span></td></tr>').join('');
    document.body.innerHTML='<div id="root"><div class="campaign66"><div class="kpis"><div class="card kpi"><small>Spend</small><strong>120 EGP</strong></div><div class="card kpi"><small>Purchases</small><strong>4</strong></div><div class="card kpi"><small>CPP</small><strong>30 EGP</strong></div><div class="card kpi"><small>ROAS</small><strong>4x</strong></div><div class="card kpi"><small>CTR</small><strong>2.4%</strong></div></div><div class="card"><div class="campaign67-comparison"><div class="ux67-head"><div><h3>مقارنة الحملات — قراءة بصرية</h3></div><div class="spacer"></div><div class="ux67-legend"></div></div><section class="ux67-entity"><div class="ux67-entity-head"><h4>Campaign A</h4><div class="ux67-summary"><span><small>Spend</small><b>120 ج</b></span><span><small>Purchases</small><b>4</b></span><span><small>CPP</small><b>30 ج</b></span><span><small>ROAS</small><b>4x</b></span></div></div><div class="ux67-scroll"><table class="ux67-matrix"><thead><tr><th class="ux67-metric-col">المعيار الأساسي</th><th>1 سبتمبر</th><th>2 سبتمبر</th><th>إجمالي الفترة</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="ux67-analysis"><div class="ux67-analysis-grid"></div></div></section></div></div></div>';
    return true;
  })()`);
  await evalJs(`eval(${JSON.stringify(uiSrc)})`);
  await waitFor(`document.documentElement.dataset.campaignVisualDensity==='v72-ready'&&window.KunCampaignVisualDensityV72?.version==='72.0'`,'v72 ready');
  await waitFor(`document.querySelectorAll('.ux67-matrix tbody tr[data-ux72-metric]').length===7&&!!document.querySelector('[data-ux72-expand]')`,'comparison decoration');
  const result=await evalJs(`(()=>{const first=document.querySelector('.ux67-value[data-ux72-metric="spend"]'),metric=document.querySelector('.ux67-metric-col'),total=document.querySelector('.ux67-matrix tbody td:last-child'),kpis=[...document.querySelectorAll('.kpi')].map(x=>x.dataset.ux72Kpi),summary=[...document.querySelectorAll('.ux67-summary span')].map(x=>x.dataset.ux72Summary),bg=getComputedStyle(first).backgroundColor,width=first.getBoundingClientRect().width,metricWidth=metric.getBoundingClientRect().width,totalPos=getComputedStyle(total).position;return {bg,width,metricWidth,totalPos,kpis,summary};})()`);
  if(!result.bg||result.bg==='rgba(0, 0, 0, 0)')throw new Error(`Metric background missing: ${JSON.stringify(result)}`);
  if(result.width>72||result.metricWidth>145)throw new Error(`Comparison density is not compact enough: ${JSON.stringify(result)}`);
  if(result.totalPos!=='sticky')throw new Error(`Period total is not sticky: ${JSON.stringify(result)}`);
  if(!result.kpis.includes('spend')||!result.kpis.includes('roas')||!result.summary.includes('cpp'))throw new Error(`Semantic KPI/summary colors missing: ${JSON.stringify(result)}`);

  const opened=await evalJs(`(()=>{const b=document.querySelector('[data-ux72-expand]');b.click();const c=document.querySelector('.campaign67-comparison');return c.classList.contains('ux72-focus')&&document.body.classList.contains('ux72-no-scroll')&&b.getAttribute('aria-pressed')==='true';})()`);if(!opened)throw new Error('Expanded comparison focus did not open correctly');
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await waitFor(`!document.querySelector('.campaign67-comparison').classList.contains('ux72-focus')&&!document.body.classList.contains('ux72-no-scroll')&&document.querySelector('[data-ux72-expand]').getAttribute('aria-pressed')==='false'`,'Escape closes focus');

  console.log('Browser Campaign v72 fixture QA passed: compact matrix, colored metric backgrounds, sticky period total, semantic KPI surfaces and full-screen focus/Escape behavior.');
}finally{try{cdp?.close();}catch{}try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}}