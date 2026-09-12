import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(base!=='https://kunonline-preview.mr-a-mnaa.workers.dev')throw new Error('Mobile QA is restricted to Kun Online Preview');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Mobile QA requires Cloudflare account/token');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const nonce=randomBytes(5).toString('hex'),email=`qa-mobile-${nonce}@example.test`,userId=`QA-MOBILE-${nonce}`,password=`Mobile!${randomBytes(12).toString('hex')}Aa1`,orderId=`QA-MOBILE-CALL-${nonce}`,createdAt=new Date().toISOString();
const origin=new URL(base).origin,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null,clientId=null;

async function d1(sql,params=[]){const r=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})}),p=await r.json().catch(()=>({})),x=p?.result?.[0];if(!r.ok||p.success===false||x?.success===false)throw new Error(`Preview D1 failed ${r.status}: ${JSON.stringify(p?.errors||x?.error||p).slice(0,900)}`);return x?.results||[];}
async function hashPassword(value){const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']),bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;}
async function cleanup(){if(clientId){for(const table of ['order_events','order_notes'])try{await d1(`DELETE FROM ${table} WHERE order_id=? AND client_id=?`,[orderId,clientId]);}catch{}try{await d1('DELETE FROM orders WHERE id=? AND client_id=?',[orderId,clientId]);}catch{}}try{await d1('DELETE FROM login_attempts WHERE email=?',[email]);}catch{}try{await d1('DELETE FROM users WHERE id=?',[userId]);}catch{}}
async function findChrome(){for(const p of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(p);return p;}catch{}throw new Error('No Chrome/Chromium executable found for mobile QA');}
async function waitDebugger(port){let last;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await r.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(e){last=e;}await sleep(180);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function launch(executable){userDir=await mkdtemp(join(tmpdir(),'kun-mobile-qa-'));const port=10400+(randomBytes(2).readUInt16BE(0)%2500);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});return waitDebugger(port);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.listeners=new Map();ws.addEventListener('message',e=>this.message(e));}message(e){let m;try{m=JSON.parse(String(e.data));}catch{return;}if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(`${p.method}: ${m.error.message}`)):p.resolve(m.result);return;}for(const fn of this.listeners.get(m.method)||[])fn(m.params||{});}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);this.pending.set(id,{resolve,reject,timer,method});this.ws.send(JSON.stringify({id,method,params}));});}on(method,fn){if(!this.listeners.has(method))this.listeners.set(method,new Set());this.listeners.get(method).add(fn);}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=12000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const v=await evalJs(expression);if(v)return v;}catch(e){last=e;}await sleep(160);}throw new Error(`Mobile QA wait failed: ${label}${last?` (${last.message})`:''}`);}
async function navigate(url){await cdp.send('Page.navigate',{url});await waitFor(`document.readyState==='complete'`,'document ready');}
function sameOrigin(url){try{return new URL(url).origin===origin;}catch{return false;}}
async function setViewport(width,height){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenWidth:width,screenHeight:height});await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await sleep(180);}
async function layoutFor(view,width){return evalJs(`(()=>{const vw=window.innerWidth,doc=document.documentElement,body=document.body,root=document.getElementById('root'),content=document.querySelector('.content'),isVisible=el=>{if(!el)return false;const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;},allowed=el=>Boolean(el.closest('.table-wrap,.dash-table-wrap,.tabs,.nav,.cs-store-tabs,.dash-trend-tabs,[class*="scroll"],[class*="matrix-wrap"],[class*="compare-wrap"],[class*="comparison-wrap"]')),bad=[...(root?.querySelectorAll('*')||[])].filter(el=>{if(!isVisible(el)||allowed(el))return false;if(el.closest('.side:not(.mobile-open),.drawer:not(.open),.help-popover:not(.show)'))return false;const r=el.getBoundingClientRect();return r.width>vw+24||r.left<-18||r.right>vw+18;}).slice(0,6).map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,cls:String(el.className||'').slice(0,90),w:Math.round(r.width),left:Math.round(r.left),right:Math.round(r.right)}}),top=document.querySelector('.top')?.getBoundingClientRect(),menu=document.getElementById('mobileMenuBtn')?.getBoundingClientRect(),store=document.getElementById('storeBtn'),search=document.getElementById('globalSearch');return {view:${JSON.stringify(view)},width:${width},innerWidth:vw,overflow:Math.max(doc.scrollWidth,body.scrollWidth)-vw,rootWidth:Math.round(root?.getBoundingClientRect().width||0),contentWidth:Math.round(content?.getBoundingClientRect().width||0),topWidth:Math.round(top?.width||0),menuHeight:Math.round(menu?.height||0),storeVisible:Boolean(store&&isVisible(store)),searchVisible:Boolean(search&&isVisible(search)),inputFont:search?parseFloat(getComputedStyle(search).fontSize):0,bad};})()`);}

let failure=null;
try{
  await cleanup();await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'Mobile QA',await hashPassword(password),'admin','active',createdAt]);
  cdp=await connect(await launch(await findChrome()));const exceptions=[],serverErrors=[];const requests=new Map();
  cdp.on('Runtime.exceptionThrown',p=>exceptions.push(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'uncaught'));
  cdp.on('Network.requestWillBeSent',p=>requests.set(p.requestId,p.request?.url||''));
  cdp.on('Network.responseReceived',p=>{const url=p.response?.url||'',status=Number(p.response?.status)||0;if(sameOrigin(url)&&status>=500)serverErrors.push(`${status} ${url}`);});
  for(const m of ['Page.enable','Runtime.enable','Network.enable'])await cdp.send(m);
  await setViewport(390,844);await navigate(`${base}/healthz`);
  const login=await evalJs(`(async()=>{const r=await fetch('/api/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email,password})})});return r.status})()`);if(login!==200)throw new Error(`Mobile QA login failed: ${login}`);
  await navigate(`${base}/v2/`);await waitFor(`document.documentElement.dataset.mobileUx==='v88-ready'&&document.getElementById('mobileMenuBtn')&&document.getElementById('root')`,'mobile UX v88 ready',20000);await sleep(700);
  const menu=await evalJs(`(()=>{const b=document.getElementById('mobileMenuBtn'),side=document.querySelector('.side'),back=document.getElementById('mobileNavBack');b.click();const r=side.getBoundingClientRect();return {open:side.classList.contains('mobile-open'),overlay:back.classList.contains('show'),left:r.left,right:r.right,width:r.width,vw:innerWidth,bodyLock:document.body.classList.contains('kun-mobile-nav-open')};})()`);
  if(!menu.open||!menu.overlay||!menu.bodyLock||menu.width>menu.vw*.9||menu.left<-2||menu.right>menu.vw+2)throw new Error(`Mobile navigation drawer is unsafe: ${JSON.stringify(menu)}`);
  await evalJs(`document.getElementById('mobileNavBack').click()`);await waitFor(`!document.querySelector('.side').classList.contains('mobile-open')`,'mobile nav close');

  const views=await evalJs(`[...document.querySelectorAll('.nav button[data-view]')].filter(b=>{const s=getComputedStyle(b);return s.display!=='none'&&s.visibility!=='hidden'&&!b.disabled}).map(b=>b.dataset.view)`);
  if(!Array.isArray(views)||views.length<25)throw new Error(`Mobile QA expected at least 25 visible sections, got ${views?.length||0}`);
  const tested=[];
  for(const [width,height] of [[390,844],[360,800]]){
    await setViewport(width,height);
    for(const view of views){
      const clicked=await evalJs(`(()=>{const b=document.querySelector('.nav button[data-view="${view}"]');if(!b||getComputedStyle(b).display==='none')return false;b.click();return true;})()`);if(!clicked)continue;
      await sleep(['campaigns','admin-clients','customer-service','inventory','integrations'].includes(view)?520:280);
      const text=await evalJs(`(document.getElementById('root')?.innerText||'').trim()`);if(String(text).length<2)throw new Error(`Mobile section ${view} rendered empty at ${width}px`);
      const layout=await layoutFor(view,width);
      if(layout.overflow>12)throw new Error(`Global horizontal overflow in ${view} at ${width}px: ${JSON.stringify(layout)}`);
      if(layout.bad.length)throw new Error(`Off-screen mobile content in ${view} at ${width}px: ${JSON.stringify(layout.bad)}`);
      if(!layout.storeVisible||!layout.searchVisible||layout.inputFont<15.5||layout.menuHeight<40)throw new Error(`Mobile shell controls are not phone-safe in ${view} at ${width}px: ${JSON.stringify(layout)}`);
      tested.push(`${view}@${width}`);
    }
  }

  await setViewport(390,844);clientId=await evalJs(`window.kunClientId?.()`);if(!clientId)throw new Error('Mobile call QA could not resolve client context');
  const store=(await d1("SELECT id FROM stores WHERE client_id=? AND status='active' ORDER BY is_default DESC LIMIT 1",[clientId]))[0]?.id||null;if(!store)throw new Error('Mobile call QA could not resolve an active store');
  await d1("INSERT INTO orders (id,client_id,store_id,name,phone,product,qty,total,state,date,created_at,history,contact_log,note) VALUES (?,?,?,?,?,?,1,25,'pending',?,?, '[]','[]',?)",[orderId,clientId,store,'Mobile Call QA','01012345678','Mobile QA product',createdAt.slice(0,10),createdAt,'mobile call persistence']);
  await evalJs(`document.querySelector('.nav button[data-view="customer-service"]').click()`);const selector=`.cs-order[data-cs-order="${orderId}"]`;await waitFor(`document.querySelector(${JSON.stringify(selector)})?.querySelector('[data-cs-action="call"]')`,'mobile call card',15000);
  const callMeta=await evalJs(`(()=>{const a=document.querySelector(${JSON.stringify(selector)}).querySelector('[data-cs-action="call"]');return {target:a.target,rel:a.rel,href:a.getAttribute('href'),safe:a.dataset.mobileSafeCall};})()`);if(callMeta.target!=='_blank'||!callMeta.rel.includes('noopener')||callMeta.safe!=='1')throw new Error(`Call link is not resume-safe on mobile: ${JSON.stringify(callMeta)}`);
  await evalJs(`(()=>{const a=document.querySelector(${JSON.stringify(selector)}).querySelector('[data-cs-action="call"]'),event=new MouseEvent('click',{bubbles:true,cancelable:true});a.dispatchEvent(event);})()`);
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.querySelector('[data-cs-action="contact"]')?.textContent.includes('(1)')`,'mobile call recorded once');
  const state=(await d1('SELECT state FROM orders WHERE id=? AND client_id=?',[orderId,clientId]))[0]?.state;if(state!=='pending')throw new Error(`Call action changed order state unexpectedly: ${state}`);
  await evalJs(`window.dispatchEvent(new Event('blur'));document.querySelector(${JSON.stringify(selector)})?.remove();window.dispatchEvent(new Event('focus'));`);
  await waitFor(`document.querySelector(${JSON.stringify(selector)})?.isConnected`,'Customer Service card restored after phone resume',12000);
  const restored=await evalJs(`(()=>{const card=document.querySelector(${JSON.stringify(selector)}),r=card.getBoundingClientRect();return {visible:getComputedStyle(card).display!=='none'&&r.width>0&&r.height>0,contact:card.querySelector('[data-cs-action="contact"]')?.textContent||'',highlight:card.classList.contains('kun-mobile-call-restore')};})()`);
  if(!restored.visible||!restored.contact.includes('(1)'))throw new Error(`Customer Service order disappeared after mobile call resume: ${JSON.stringify(restored)}`);
  if(exceptions.length)throw new Error(`Mobile QA uncaught browser errors: ${exceptions.slice(0,5).join(' | ')}`);if(serverErrors.length)throw new Error(`Mobile QA server errors: ${serverErrors.slice(0,5).join(' | ')}`);
  console.log(`Mobile Preview QA passed: ${views.length} visible sections at 390px and 360px (${tested.length} section/viewport checks), safe drawer/top controls, no global horizontal overflow, and Customer Service call remains pending + restores its card after simulated phone resume.`);
}catch(e){failure=e;}finally{try{cdp?.close();}catch{}try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}try{await cleanup();}catch(cleanupError){failure=new Error(`${failure?.message||''}; mobile QA cleanup failed: ${cleanupError.message}`);}}
if(failure)throw failure;
