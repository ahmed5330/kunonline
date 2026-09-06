import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const uiSrc=await readFile(new URL('../public/v2/modules-v75-customer-service-interactions.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let chrome=null,userDir=null,cdp=null;

async function findChrome(){for(const path of ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'])try{await access(path);return path;}catch{}throw new Error('No Chrome/Chromium executable found for Customer Service interaction fixture QA');}
async function waitDebugger(port){let last;for(let i=0;i<80;i++){try{const response=await fetch(`http://127.0.0.1:${port}/json/list`),pages=await response.json(),page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||pages.find(x=>x.webSocketDebuggerUrl);if(page)return page.webSocketDebuggerUrl;}catch(error){last=error;}await sleep(150);}throw new Error(`Chrome DevTools unavailable: ${last?.message||'timeout'}`);}
async function launch(executable){userDir=await mkdtemp(join(tmpdir(),'kun-cs-v75-'));const port=9800+(randomBytes(2).readUInt16BE(0)%2500);chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${userDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});return waitDebugger(port);}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>this.message(event));}message(event){let message;try{message=JSON.parse(String(event.data));}catch{return;}if(!message.id)return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},12000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}close(){try{this.ws.close();}catch{}}}
async function connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CDP connect timeout')),8000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP connect failed'));},{once:true});});return new CDP(ws);}
async function evalJs(expression){const out=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(out.exceptionDetails)throw new Error(`Browser evaluate exception: ${out.exceptionDetails.exception?.description||out.exceptionDetails.text||'unknown'}`);return out.result?.value;}
async function waitFor(expression,label,timeout=7000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await evalJs(expression);if(value)return value;}catch(error){last=error;}await sleep(100);}throw new Error(`Browser wait failed: ${label}${last?` (${last.message})`:''}`);}

try{
  cdp=await connect(await launch(await findChrome()));await cdp.send('Runtime.enable');
  await evalJs(`(()=>{
    window.__requests=[];window.__toasts=[];window.__oldBubbleCalls=0;window.__oldChangeCalls=0;window.__contactCount=0;window.__confirmCalls=[];
    window.kunClientId=async()=> 'CLI-QA';window.showToast=message=>window.__toasts.push(String(message));
    window.KunConfirmInventoryV58={open:async(orderId,select)=>{window.__confirmCalls.push(orderId);select.value='confirmed';select.dataset.current='confirmed';return {ok:true};}};
    window.fetch=async(url,options={})=>{
      const body=options.body?JSON.parse(options.body):{};window.__requests.push({url:String(url),method:options.method||'GET',body,keepalive:Boolean(options.keepalive)});
      let data={ok:true};
      if(String(url).includes('/notes'))data={ok:true,history:[{type:'internal_note',note:body.note}]};
      if(String(url).includes('/contact')){window.__contactCount++;data={ok:true,contactCount:window.__contactCount,log:Array.from({length:window.__contactCount},(_,i)=>({type:'contact',intent:body.intent,at:String(i)})),history:[{type:'contact',intent:body.intent}]};}
      return new Response(JSON.stringify(data),{status:String(url).includes('/notes')?201:200,headers:{'Content-Type':'application/json'}});
    };
    document.body.innerHTML='<nav class="nav"><button class="active" data-view="customer-service">خدمة العملاء</button></nav><div id="root"><div class="cs-page"><article class="cs-order" data-cs-order="ORD-QA"><div class="cs-field cs-note-field"><input data-cs-note value="ملاحظة اختبار"><button type="button" data-cs-action="note">إضافة</button></div><div class="cs-field"><select data-cs-state data-current="pending"><option value="pending" selected>في انتظار التأكيد</option><option value="confirmed">تم التأكيد</option></select></div><div class="cs-actions"><button type="button" data-cs-action="contact">تواصل (0)</button><a href="#dial" data-cs-action="call">مكالمة</a></div></article></div></div>';
    document.addEventListener('click',event=>{if(event.target.closest?.('[data-cs-action]'))window.__oldBubbleCalls++;});
    document.addEventListener('change',event=>{if(event.target.closest?.('[data-cs-state]'))window.__oldChangeCalls++;});
    return true;
  })()`);
  await evalJs(`eval(${JSON.stringify(uiSrc)})`);
  await waitFor(`document.documentElement.dataset.customerServiceInteractions==='v75-ready'&&window.KunCustomerServiceInteractionsV75?.version==='75.0'`,'v75 ready');

  await evalJs(`document.querySelector('[data-cs-action="note"]').click()`);
  await waitFor(`window.__requests.filter(x=>x.url.includes('/notes')).length===1`,'note request');
  const note=await evalJs(`(()=>({requests:window.__requests.filter(x=>x.url.includes('/notes')),value:document.querySelector('[data-cs-note]').value,latest:document.querySelector('.cs-internal-latest')?.textContent||'',old:window.__oldBubbleCalls}))()`);
  if(note.requests.length!==1||note.requests[0].body.note!=='ملاحظة اختبار'||note.value!==''||!note.latest.includes('ملاحظة اختبار')||note.old!==0)throw new Error(`Customer Service note interaction failed or duplicated: ${JSON.stringify(note)}`);

  await evalJs(`document.querySelector('[data-cs-action="contact"]').click()`);
  await waitFor(`window.__requests.filter(x=>x.url.includes('/contact')&&x.body.intent==='contact').length===1`,'contact request');
  const contact=await evalJs(`(()=>({requests:window.__requests.filter(x=>x.url.includes('/contact')&&x.body.intent==='contact'),label:document.querySelector('[data-cs-action="contact"]').textContent,old:window.__oldBubbleCalls}))()`);
  if(contact.requests.length!==1||contact.requests[0].body.channel!=='phone'||contact.label.trim()!=='تواصل (1)'||contact.old!==0)throw new Error(`Customer Service contact interaction failed or duplicated: ${JSON.stringify(contact)}`);

  const callDispatch=await evalJs(`(()=>{const link=document.querySelector('[data-cs-action="call"]'),event=new MouseEvent('click',{bubbles:true,cancelable:true});return link.dispatchEvent(event);})()`);
  if(callDispatch!==true)throw new Error('Call click was incorrectly preventDefault-ed; tel action must remain available');
  await waitFor(`window.__requests.filter(x=>x.url.includes('/contact')&&x.body.intent==='call').length===1`,'call request');
  const call=await evalJs(`(()=>({requests:window.__requests.filter(x=>x.url.includes('/contact')&&x.body.intent==='call'),label:document.querySelector('[data-cs-action="contact"]').textContent,old:window.__oldBubbleCalls,toasts:window.__toasts}))()`);
  if(call.requests.length!==1||call.requests[0].body.channel!=='phone'||call.requests[0].keepalive!==true||call.label.trim()!=='تواصل (2)'||call.old!==0||!call.toasts.some(x=>x.includes('تم تسجيل المكالمة')))throw new Error(`Customer Service call interaction failed or duplicated: ${JSON.stringify(call)}`);

  await evalJs(`(()=>{const select=document.querySelector('[data-cs-state]');select.value='confirmed';select.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}));})()`);
  await waitFor(`window.__confirmCalls.length===1`,'confirmation workflow opened');
  const confirm=await evalJs(`(()=>{const select=document.querySelector('[data-cs-state]');return {calls:window.__confirmCalls.slice(),value:select.value,current:select.dataset.current,old:window.__oldChangeCalls,error:document.querySelector('.cs-v75-error')?.textContent||''};})()`);
  if(confirm.calls.length!==1||confirm.calls[0]!=='ORD-QA'||confirm.value!=='confirmed'||confirm.current!=='confirmed'||confirm.old!==0||confirm.error)throw new Error(`Customer Service confirmation selection failed or fell through to the old handler: ${JSON.stringify(confirm)}`);

  console.log('Browser Customer Service v75 fixture QA passed: note, contact, call and confirmation selection are handled exactly once; note/count UI updates immediately, call keeps the native tel action, confirmation opens the inventory workflow, and old handlers cannot duplicate the action.');
}finally{try{cdp?.close();}catch{}try{if(chrome&&!chrome.killed)chrome.kill('SIGTERM');}catch{}try{if(userDir)await rm(userDir,{recursive:true,force:true});}catch{}}
