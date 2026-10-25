// Local Cloudflare Worker smoke: loads this branch, not the deployed Preview worker.
// Never connects to remote D1, Cloudflare production, Meta, or customer accounts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const portServer=createServer();
await new Promise(done=>portServer.listen(0,'127.0.0.1',done));
const port=portServer.address().port;
await new Promise(done=>portServer.close(done));
const bin=process.platform==='win32'?'npx.cmd':'./node_modules/.bin/wrangler';
const args=process.platform==='win32'?
  ['wrangler','dev','--local','--config','wrangler.preview.toml','--ip','127.0.0.1','--port',String(port)]:
  ['dev','--local','--config','wrangler.preview.toml','--ip','127.0.0.1','--port',String(port)];
let output='',child;
try{
 child=spawn(bin,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 const record=chunk=>{output=(output+String(chunk)).slice(-14000);};
 child.stdout?.on('data',record);child.stderr?.on('data',record);
 child.on('error',error=>record(error.message));
 const root='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<140;i++){
   if(child.exitCode!==null)break;
   try{
     const response=await fetch(root+'/v2/modules-v150-growth-planner.js?v=150.0');
     if(response.status===200 && (await response.text()).includes('KunGrowthPlanner150')){ready=true;break;}
   }catch{}
   await delay(300);
 }
 assert.ok(ready,'local branch Worker did not serve the growth planner: '+output.slice(-2500));
 const html=await fetch(root+'/v2/');
 assert.equal(html.status,200,'real branch Worker should serve the V2 shell');
 const page=await html.text();
 assert.match(page,/modules-v150-growth-planner\.js\?v=150\.0/);
 assert.match(page,/modules-v27-meta-ads\.js\?v=27\.2/);
 const manifest=await fetch(root+'/api/preview/growth-release');
 assert.equal(manifest.status,200,'Release capability metadata must remain public before subscription middleware');
 const release=await manifest.json();
 assert.equal(release.release,'kun-growth-wallet-20261015-r1');
 assert.ok(release.capabilities.includes('wallet-ledger-integrity'));
 for(const field of ['uid','clientId','orders','users'])assert.equal(Object.hasOwn(release,field),false,'Public metadata must not expose tenant state');
 const endpoints=[
   ['/api/growth/inventory-catalog','GET'],
   ['/api/growth/operating-evidence','GET'],
   ['/api/growth/scaling-readiness','GET'],
   ['/api/growth/experiment/compare','GET'],
   ['/api/growth/scenario/preview','POST']
 ];
 for(const [path,method] of endpoints){
   const options={method,headers:{'Content-Type':'application/json'}};
   if(method==='POST')options.body=JSON.stringify({plan:{horizonDays:7,proposedDailyBudget:1000}});
   const res=await fetch(root+path+'?clientId=ATTACKER&storeId=S1',options);
   assert.equal(res.status,401,method+' '+path+' must reject anonymous access');
   const body=await res.text();
   assert.ok(!body.includes('ATTACKER'),'do not echo client identifiers from unauthorized URLs');
 }
 console.log('Local Preview Worker smoke PASS: branch shell/assets + 5 authenticated growth APIs locked');
}finally{
 if(child&&!child.killed)child.kill('SIGTERM');
}
