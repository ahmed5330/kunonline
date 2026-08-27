import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,webcrypto} from 'node:crypto';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/browser-preview-qa.mjs <base-url>');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw new Error('Preview browser QA requires Cloudflare account/token environment');
const config=await readFile(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
const databaseId=config.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
if(!databaseId)throw new Error('Preview database_id missing');
const d1Url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const email='qa-ci-v28-browser@example.test',userId='QA-CI-V28-BROWSER';
const password=`Browser!${randomBytes(18).toString('hex')}Aa1`;
const createdAt=new Date().toISOString();
const origin=new URL(base).origin;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let chrome=null,userDir=null,cdp=null,chromeErr='';

async function d1(sql,params=[]){
  const response=await fetch(d1Url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const payload=await response.json().catch(()=>({}));
  const result=payload?.result?.[0];
  if(!response.ok||payload.success===false||result?.success===false)throw new Error(`Preview D1 query failed (${response.status}): ${JSON.stringify(payload?.errors||result?.error||payload).slice(0,800)}`);
  return result?.results||[];
}
async function hashPassword(value){
  const salt=randomBytes(16),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const bits=await webcrypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2$100000$${salt.toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}
async function cleanupUser(){
  await d1('DELETE FROM login_attempts WHERE email=?',[email]);
  await d1('DELETE FROM users WHERE email=?',[email]);
}
async function findChrome(){
  for(const candidate of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']){
    try{await access(candidate);return candidate;}catch{}
  }
  throw new Error('No Chrome/Chromium executable found on GitHub runner');
}
async function waitDebugger(port,loops=80){
  let last;
  for(let i=0;i<loops;i++){
    try{
      const response=await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages=await response.json();
      const page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);
      if(page)return page.webSocketDebuggerUrl;
    }catch(error){last=error;}
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint unavailable: ${last?.message||'timeout'}`);
}
async function launchChrome(executable){
  const failures=[];
  for(let attempt=1;attempt<=3;attempt++){
    try{
      if(chrome&&!chrome.killed)chrome.kill('SIGTERM');
      if(userDir)await rm(userDir,{recursive:true,force:true});
      userDir=await mkdtemp(join(tmpdir(),`kun-browser-qa-${attempt}-`));
      const port=9300+(randomBytes(2).readUInt16BE(0)%5000);chromeErr='';
      chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
      chrome.stderr.on('data',d=>{chromeErr+=String(d);if(chromeErr.length>12000)chromeErr=chromeErr.slice(-12000);});
      const ws=await waitDebugger(port);return ws;
    }catch(error){failures.push(`attempt ${attempt}: ${error.message}${chromeErr?` stderr=${chromeErr.slice(-1200)}`:''}`);try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}await sleep(750);}
  }
  throw new Error(`Chrome launch failed after 3 attempts: ${failures.join(' | ')}`);
}
class CDPClient{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.listeners=new Map();ws.addEventListener('message',e=>this.message(e));}
  message(event){
    let msg;try{msg=JSON.parse(String(event.data));}catch{return;}
    if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(new Error(`${p.method}: ${msg.error.message}`));else p.resolve(msg.result);return;}
    const set=this.listeners.get(msg.method);if(set)for(const fn of set)fn(msg.params||{});
  }
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);this.pending.set(id,{resolve,reject,timer,method});this.ws.send(JSON.stringify({id,method,params}));});}
  on(method,fn){if(!this.listeners.has(method))this.listeners.set(method,new Set());this.listeners.get(method).add(fn);}
  close(){try{this.ws.close();}catch{}}
}
async function connectCDP(url){
  const ws=new WebSocket(url);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CDP WebSocket connection timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP WebSocket connection failed'));},{once:true});});
  return new CDPClient(ws);
}
async function evaluate(expression){
  const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.text||'unknown'}`);
  return out.result?.value;
}
async function waitFor(expression,label,timeout=12000){
  const started=Date.now();let last;
  while(Date.now()-started<timeout){
    try{const value=await evaluate(expression);if(value)return value;}catch(error){last=error;}
    await sleep(250);
  }
  throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);
}
async function navigate(url){
  await cdp.send('Page.navigate',{url});
  await waitFor(`document.readyState==='complete'`,'document ready');
}
function isSameOrigin(url){try{return new URL(url).origin===origin;}catch{return false;}}

let primaryError=null;
try{
  await cleanupUser();
  const hash=await hashPassword(password);
  await d1('INSERT INTO users (id,email,name,password,role,client_id,status,created_at,last_login) VALUES (?,?,?,?,?,NULL,?,?,NULL)',[userId,email,'CI Browser QA',hash,'admin','active',createdAt]);

  const executable=await findChrome();
  const wsUrl=await launchChrome(executable);
  cdp=await connectCDP(wsUrl);

  const exceptions=[],consoleErrors=[],logErrors=[],networkFailures=[],serverErrors=[],criticalResponses=[];
  const requests=new Map();
  cdp.on('Runtime.exceptionThrown',p=>{const d=p.exceptionDetails||{},desc=d.exception?.description||String(d.exception?.value||''),frames=(d.stackTrace?.callFrames||[]).slice(0,5).map(f=>`${f.functionName||'<anon>'}@${f.url||'inline'}:${Number(f.lineNumber)+1}:${Number(f.columnNumber)+1}`).join(' <- ');exceptions.push([desc,d.text,frames].filter(Boolean).join(' :: ')||'uncaught exception');});
  cdp.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')consoleErrors.push((p.args||[]).map(x=>x.value??x.description??'').join(' '));});
  cdp.on('Log.entryAdded',p=>{const e=p.entry||{};if(e.level==='error'&&(!e.url||isSameOrigin(e.url)))logErrors.push(`${e.source||'log'}: ${e.text||''}`);});
  cdp.on('Network.requestWillBeSent',p=>requests.set(p.requestId,{url:p.request?.url||'',type:p.type||''}));
  cdp.on('Network.loadingFailed',p=>{const r=requests.get(p.requestId)||{};if(isSameOrigin(r.url)&&!p.canceled)networkFailures.push(`${p.type||r.type||'resource'} ${r.url}: ${p.errorText||'failed'}`);});
  cdp.on('Network.responseReceived',p=>{const r=p.response||{},url=r.url||'';if(!isSameOrigin(url))return;const status=Number(r.status)||0;if(status>=500)serverErrors.push(`${status} ${url}`);if(status>=400&&['Document','Script','Stylesheet'].includes(p.type))criticalResponses.push(`${status} ${p.type} ${url}`);});
  for(const method of ['Page.enable','Runtime.enable','Network.enable','Log.enable'])await cdp.send(method);

  await navigate(`${base}/healthz`);
  const login=await evaluate(`(async()=>{const r=await fetch('/api/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email,password})})});return {status:r.status,text:(await r.text()).slice(0,500)}})()`);
  if(login?.status!==200)throw new Error(`Browser login failed ${login?.status}: ${login?.text||''}`);

  exceptions.length=0;consoleErrors.length=0;logErrors.length=0;networkFailures.length=0;serverErrors.length=0;criticalResponses.length=0;requests.clear();
  await navigate(`${base}/v2/`);
  await waitFor(`document.querySelector('#root')&&document.querySelector('[data-view="orders"]')`,'v28 app shell');
  await waitFor(`document.documentElement.dataset.role==='admin'||document.querySelector('[data-view="admin-clients"]')`,'admin context');
  await waitFor(`document.documentElement.dataset.v28Team==='ready'`,'v28 team overlay loaded');
  await sleep(900);

  const title=await evaluate('document.title');
  if(!/kun online v28/i.test(String(title)))throw new Error(`Unexpected v28 browser title: ${title}`);
  const session=await evaluate(`(async()=>{const r=await fetch('/api/me',{credentials:'include'});return {status:r.status,text:(await r.text()).slice(0,300)}})()`);
  if(session?.status!==200)throw new Error(`Authenticated browser session failed: ${session?.status} ${session?.text||''}`);
  const resources=await evaluate(`performance.getEntriesByType('resource').map(x=>x.name)`);
  if(!Array.isArray(resources)||!resources.some(x=>String(x).includes('/v2/modules-v22.js'))||!resources.some(x=>String(x).includes('/v2/modules-v24-team.js')))throw new Error('v28 required UI modules were not loaded in the browser');

  const essentialViews=['orders','wallet','admin-clients','ad-studio','integrations','access','store-access','settings'];
  for(const view of essentialViews){
    const clicked=await evaluate(`(()=>{const b=document.querySelector('[data-view="${view}"]');if(!b)return false;b.click();return true})()`);
    if(!clicked)throw new Error(`Missing v28 navigation view: ${view}`);
    await sleep(view==='access'||view==='store-access'?900:650);
    const rootText=await evaluate(`(document.querySelector('#root')?.innerText||'').trim()`);
    if(String(rootText).length<3)throw new Error(`View ${view} rendered an empty root`);
    if(view==='access'||view==='store-access'){
      await waitFor(`!!document.getElementById('v28AddMember')`,`v28 team action in ${view}`);
      const hasTeamText=await evaluate(`(document.querySelector('#root')?.innerText||'').includes('إضافة عضو فريق')`);if(!hasTeamText)throw new Error(`v28 team controls missing in ${view}`);
    }
  }
  await evaluate(`document.querySelector('[data-view="access"]').click()`);await waitFor(`!!document.getElementById('v28AddMember')`,'team page create button');
  const opened=await evaluate(`(()=>{const b=document.getElementById('v28AddMember');if(!b)return false;b.click();return true})()`);if(!opened)throw new Error('Team create button did not click');
  await waitFor(`!!document.getElementById('v28CreateMember')&&!!document.getElementById('v28MemberRole')`,'team create drawer');
  const roleCount=await evaluate(`document.querySelectorAll('#v28MemberRole option').length`);if(Number(roleCount)<5)throw new Error(`Team create drawer role catalog incomplete: ${roleCount}`);
  await evaluate(`document.getElementById('v23Close')?.click()`);await sleep(250);

  const viewportResults=[];
  for(const [width,height] of [[1440,1000],[820,1000],[390,844]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=390});
    await sleep(400);
    const layout=await evaluate(`({innerWidth:window.innerWidth,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),rootWidth:document.querySelector('#root')?.getBoundingClientRect().width||0})`);
    const overflow=Number(layout?.scrollWidth||0)-Number(layout?.innerWidth||0);
    if(overflow>80)throw new Error(`Responsive overflow at ${width}px: ${overflow}px (scroll=${layout?.scrollWidth}, viewport=${layout?.innerWidth})`);
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(!shot?.data||shot.data.length<1000)throw new Error(`Responsive screenshot failed at ${width}px`);
    viewportResults.push(`${width}px`);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const themes=[];
  for(const theme of ['light','gray','dark']){
    const info=await evaluate(`(()=>{document.body.dataset.theme='${theme}';document.documentElement.dataset.theme='${theme}';const s=getComputedStyle(document.body);return {theme:document.body.dataset.theme,bg:s.backgroundColor,color:s.color}})()`);
    if(info?.theme!==theme||!info?.bg||!info?.color)throw new Error(`Theme ${theme} did not apply`);
    await sleep(200);
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(!shot?.data||shot.data.length<1000)throw new Error(`Theme screenshot failed: ${theme}`);
    themes.push(theme);
  }

  await sleep(600);
  const failures=[];
  if(exceptions.length)failures.push(`uncaught=${exceptions.slice(0,5).join(' | ')}`);
  if(consoleErrors.length)failures.push(`console.error=${consoleErrors.slice(0,5).join(' | ')}`);
  if(logErrors.length)failures.push(`browser-log=${logErrors.slice(0,5).join(' | ')}`);
  if(networkFailures.length)failures.push(`network-failed=${networkFailures.slice(0,5).join(' | ')}`);
  if(serverErrors.length)failures.push(`server-5xx=${serverErrors.slice(0,5).join(' | ')}`);
  if(criticalResponses.length)failures.push(`critical-http=${criticalResponses.slice(0,5).join(' | ')}`);
  if(failures.length)throw new Error(`Browser runtime QA failed: ${failures.join(' ; ')}`);

  console.log(`Browser Preview QA passed: authenticated v28 navigation + team controls, console/network clean, responsive screenshots ${viewportResults.join('/')} and themes ${themes.join('/')}.`);
}catch(error){primaryError=error;
}finally{
  try{cdp?.close();}catch{}
  try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}
  try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}
  try{await cleanupUser();}catch(cleanupError){if(primaryError)primaryError=new Error(`${primaryError.message}; browser QA cleanup failed: ${cleanupError.message}`);else primaryError=cleanupError;}
}
if(primaryError)throw primaryError;