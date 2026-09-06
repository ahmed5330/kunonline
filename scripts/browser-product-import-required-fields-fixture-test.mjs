import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const uiSrc=await readFile(new URL('../public/v2/modules-v29-product-import.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null;
async function findChrome(){for(const path of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found for product import fixture QA');}
async function waitDebugger(port,{attempts=60,delay=100}={}){let last;for(let i=0;i<attempts;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(delay);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function cleanupBrowser(){try{cdp?.close();}catch{}cdp=null;try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}chrome=null;await sleep(120);try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}userDir=null;}
async function launchOnce(executable){userDir=await mkdtemp(join(tmpdir(),'kun-product-import-'));const port=9000+(randomBytes(2).readUInt16BE(0)%6000);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});return waitDebugger(port);}
async function launch(executable){const failures=[];for(let attempt=1;attempt<=3;attempt++){try{return await launchOnce(executable);}catch(error){failures.push(`attempt ${attempt}: ${error?.message||String(error)}`);await cleanupBrowser();if(attempt<3)await sleep(200*attempt);}}throw new Error(`Chrome DevTools unavailable after 3 isolated startup attempts — ${failures.join(' | ')}`);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},12000);this.pending.set(id,{resolve,reject,t});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=7000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await evalJs(expression);if(value)return value;}catch(e){last=e;}await sleep(80);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}

try{
  cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');
  await evalJs(`(()=>{
    window.view='products';window.__importPayload=null;window.__notices=[];
    window.products=()=>'<div></div>';
    document.body.innerHTML='<div class="products-tools"></div><div id="drawer"></div>';
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
    const items=[
      {externalId:'P1',name:'منتج أول',sku:'SKU-1',category:'Test',price:599,compareAtPrice:800,stock:5,action:'created',variants:2,images:1},
      {externalId:'P2',name:'منتج ثاني',sku:'SKU-2',category:'Test',price:450,compareAtPrice:null,stock:3,action:'updated',variants:0,images:0}
    ];
    window.KunActionsV23={
      esc,scope:async()=>({cid:'CLI-TEST',sid:'STR-TEST'}),
      notify:m=>window.__notices.push(String(m)),refresh:()=>{},
      drawer:(title,html)=>{document.getElementById('drawer').innerHTML=html;},
      api:async(path,options={})=>{
        if(path.startsWith('/api/commerce/product-import/providers'))return [{provider:'easyorders',name:'Easy Orders',label:'مزامنة Easy Orders'}];
        if(path==='/api/commerce/product-import/preview')return {provider:'easyorders',name:'Easy Orders',total:2,created:1,updated:1,priceRule:'discounted_price',items};
        if(path==='/api/commerce/product-import'){window.__importPayload=JSON.parse(options.body||'{}');return {created:1,updated:0,skipped:0,errors:[],selectionMode:window.__importPayload.selectionMode,total:1,costsCaptured:1};}
        throw new Error('Unexpected API '+path);
      }
    };
    return true;
  })()`);
  await evalJs(`eval(${JSON.stringify(uiSrc)})`);
  await waitFor(`document.documentElement.dataset.productImport==='required-costs-v29.2'`,'v29.2 UI ready');
  await evalJs(`products()`);await waitFor(`!!document.getElementById('commerceProductImport')`,'product import button');
  const opened=await evalJs(`window.KunCommerceProductImportV29?.open?.('easyorders')`);if(!opened)throw new Error('Public Easy Orders review entrypoint did not open');
  await waitFor(`!!document.getElementById('syncCommerceProducts')`,'required sync drawer');

  const initial=await evalJs(`(()=>({disabled:document.getElementById('syncCommerceProducts').disabled,modeChecked:!!document.querySelector('input[name="commerceImportMode"]:checked'),costs:document.querySelectorAll('.commerceImportCost').length,text:document.getElementById('drawer').innerText}))()`);
  if(!initial.disabled||initial.modeChecked||initial.costs!==2)throw new Error(`Initial mandatory state is wrong: ${JSON.stringify(initial)}`);
  if(!initial.text.includes('راجع التكاليف قبل المزامنة')||!initial.text.includes('السعر بعد الخصم')||!initial.text.includes('599')||!initial.text.includes('800'))throw new Error('In-system cost review or discounted Easy Orders selling-price explanation/values are not visible');

  await evalJs(`document.querySelector('input[name="commerceImportMode"][value="all"]').click()`);
  let disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(!disabled)throw new Error('All-products sync enabled before costs were entered');
  await evalJs(`(()=>{const inputs=[...document.querySelectorAll('.commerceImportCost')];inputs[0].value='210';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(!disabled)throw new Error('All-products sync enabled with one product cost still missing');
  await evalJs(`(()=>{const inputs=[...document.querySelectorAll('.commerceImportCost')];inputs[1].value='175.5';inputs[1].dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(disabled)throw new Error('All-products sync stayed disabled after every target cost was supplied');

  await evalJs(`document.querySelector('input[name="commerceImportMode"][value="selected"]').click()`);
  disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(!disabled)throw new Error('Selected-products sync enabled before selecting a product');
  await evalJs(`document.querySelector('.commerceImportCheck[value="P1"]').click()`);
  disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(disabled)throw new Error('Selected-products sync should be ready when the selected product has a cost');
  await evalJs(`(()=>{const input=document.querySelector('.commerceImportCost[data-cost-id="P1"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  disabled=await evalJs(`document.getElementById('syncCommerceProducts').disabled`);if(!disabled)throw new Error('Selected-products sync enabled after the selected product cost was cleared');
  await evalJs(`(()=>{const input=document.querySelector('.commerceImportCost[data-cost-id="P1"]');input.value='220';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('syncCommerceProducts').click();return true;})()`);
  await waitFor(`window.__importPayload!==null`,'sync payload');
  const payload=await evalJs(`window.__importPayload`);
  if(payload.selectionMode!=='selected'||payload.selectedExternalIds?.length!==1||payload.selectedExternalIds[0]!=='P1'||Number(payload.productCosts?.P1)!==220)throw new Error(`Mandatory sync payload is wrong: ${JSON.stringify(payload)}`);
  console.log('Browser product import fixture QA passed: inventory/public entry opens the in-system cost review, scope choice is explicit, all/selected modes stay blocked until every targeted product has a cost, and sync sends selection + productCosts.');
}finally{await cleanupBrowser();}