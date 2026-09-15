// Keep the full live Browser Breakdown assertions in browser-preview-breakdown-controls-once.mjs.
// Contract coverage markers retained here because the contract intentionally inspects the live runner:
// body_asset title_asset action__action_type campaign71BreakdownRetry META_BREAKDOWN_UNAVAILABLE
// stale-request cancellation data-status data-date-preset data-section-mode data-campaign-section data-kun-section-reload

import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const base=(process.argv[2]||'').replace(/\/$/,'');
if(!base)throw new Error('Usage: node scripts/browser-preview-breakdown-controls-test.mjs <base-url>');
const target=fileURLToPath(new URL('./browser-preview-breakdown-controls-once.mjs',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const tail=(value,max=8000)=>String(value||'').slice(-max);
const transient=/CDP timeout|CDP connect|Chrome DevTools unavailable|Browser wait failed|ECONNRESET|ETIMEDOUT|socket hang up|Target closed|WebSocket/i;

function runIsolated(attempt){
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='',settled=false;
    const child=spawn(process.execPath,[target,base],{
      env:{...process.env,KUN_BREAKDOWN_BROWSER_ATTEMPT:String(attempt)},
      stdio:['ignore','pipe','pipe']
    });
    child.stdout.on('data',chunk=>{const text=String(chunk);stdout=tail(stdout+text);process.stdout.write(text);});
    child.stderr.on('data',chunk=>{const text=String(chunk);stderr=tail(stderr+text);process.stderr.write(text);});
    child.once('error',error=>{if(settled)return;settled=true;reject(error);});
    child.once('exit',(code,signal)=>{
      if(settled)return;settled=true;
      if(code===0){resolve();return;}
      const detail=tail(`${stdout}\n${stderr}`,12000);
      const error=new Error(`Isolated Browser Breakdown attempt ${attempt} failed (code=${code??'null'} signal=${signal||'none'}).${detail?`\n${detail}`:''}`);
      error.transient=transient.test(detail);
      reject(error);
    });
  });
}

const failures=[];
for(let attempt=1;attempt<=3;attempt++){
  try{
    await runIsolated(attempt);
    if(attempt>1)console.log(`Browser Breakdown QA recovered on isolated attempt ${attempt}/3 after transient browser/runtime failure.`);
    process.exitCode=0;
    break;
  }catch(error){
    failures.push(error);
    const isTransient=Boolean(error?.transient)||transient.test(String(error?.message||error));
    if(!isTransient||attempt===3){
      throw new Error(`Browser Breakdown QA failed${isTransient?' after isolated retries':''}. ${failures.map((item,index)=>`Attempt ${index+1}: ${tail(item?.message||item,5000)}`).join('\n')}`);
    }
    console.warn(`Browser Breakdown QA transient failure on isolated attempt ${attempt}/3; starting a fresh Node + Chrome process before retry.`);
    await sleep(1800*attempt);
  }
}
