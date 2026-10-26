import {inspectMobileOverflow} from './mobile-overflow-inspection.mjs';
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const asset='';
const html="<html dir=\"rtl\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0;overflow-x:hidden}#root{padding:12px;box-sizing:border-box;width:100%}.bounded-component{width:100%;overflow-x:auto}table{min-width:1050px;border-collapse:collapse}td{padding:14px}</style></head><body><div id=\"root\"><div class=\"bounded-component\"><table><tbody><tr><td>one</td><td>two</td><td>three</td><td>four</td></tr></tbody></table></div></div></body></html>";
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
  await waitFor('!!document.querySelector(".bounded-component table")');
  await evaluate('window.__inspect='+inspectMobileOverflow.toString());
  assert.deepEqual(await evaluate('window.__inspect(document.getElementById("root"),'+width+')'),[],'A bounded actual horizontal scroller must keep wide table columns reachable');
  await evaluate('document.querySelector(".bounded-component").style.overflowX="hidden"');
  assert.ok((await evaluate('window.__inspect(document.getElementById("root"),'+width+')')).length>0,'Clipped content without scrolling must fail');
  await evaluate('document.querySelector(".bounded-component").style.overflowX="auto";document.querySelector(".bounded-component").style.width="800px"');
  assert.ok((await evaluate('window.__inspect(document.getElementById("root"),'+width+')')).length>0,'The scrolling container itself must fit the viewport');
  await evaluate('document.getElementById("root").innerHTML="";var wide=document.createElement("div");wide.style.width="800px";wide.textContent="uncontained overflow";document.getElementById("root").appendChild(wide)');
  assert.ok((await evaluate('window.__inspect(document.getElementById("root"),'+width+')')).length>0,'Uncontained wide content must fail');
 }
 console.log('PASS: actual mobile geometry permits bounded RTL scrolling and rejects hidden, oversized and uncontained overflow.');
}finally{
 cdp?.close();
 if(browser&&browser.exitCode===null){const stopped=new Promise(resolve=>browser.once('exit',resolve));browser.kill('SIGTERM');await Promise.race([stopped,sleep(3000)]);if(browser.exitCode===null){browser.kill('SIGKILL');await stopped;}}
 await new Promise(resolve=>server.close(resolve));
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
