import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const asset=await readFile(process.env.KUN_CALCULATOR_FIXTURE_ASSET||new URL('../public/v2/modules-v94-ecommerce-calculator.js',import.meta.url),'utf8');
const html="<html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0;font-family:Arial}#root{box-sizing:border-box;width:100%;padding:16px}</style></head><body><nav class=\"nav\" hidden><button class=\"active\" data-view=\"ecommerce-calculator\">calculator</button></nav><div id=\"root\"></div><script>window.__errors=[];addEventListener(\"error\",e=>__errors.push(e.message));</script><script src=\"/calculator.js\"></script></body></html>";
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/calculator.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/calculator.js'?asset:html);});
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
 profile=await mkdtemp(join(tmpdir(),'calculator-layout-'));
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
  await waitFor('!!document.querySelector(".kun96-head")');
  const result=await evaluate(`(()=>{const width=innerWidth;return {width,overflow:document.documentElement.scrollWidth-width,bad:[...document.querySelectorAll('#root *')].filter(x=>{if(x.closest('.kun96-impact'))return false;const r=x.getBoundingClientRect(),s=getComputedStyle(x);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&(r.left < -2||r.right>width+2||r.width>width+2);}).slice(0,6).map(x=>({className:x.className,left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right})),widest:[...document.querySelectorAll("#root *")].map(x=>({c:x.className,w:x.getBoundingClientRect().width,sw:x.scrollWidth})).sort((a,b)=>b.w-a.w).slice(0,10),errors:window.__errors};})()`);
  assert.equal(result.width,width,JSON.stringify(result));assert.ok(result.overflow<=1,'Calculator must fit the mobile viewport');
  assert.deepEqual(result.bad,[],'Calculator controls and content must remain inside the mobile viewport');
  assert.deepEqual(result.errors,[]);
 }
 console.log('PASS: actual calculator header, steps and form fit 360px and 390px RTL without off-screen content.');
}finally{
 cdp?.close();
 if(browser&&browser.exitCode===null){const stopped=new Promise(resolve=>browser.once('exit',resolve));browser.kill('SIGTERM');await Promise.race([stopped,sleep(3000)]);if(browser.exitCode===null){browser.kill('SIGKILL');await stopped;}}
 await new Promise(resolve=>server.close(resolve));
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
