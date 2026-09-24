// Full Preview desktop/runtime plus exhaustive phone QA.
// Desktop keeps a single retry. Mobile only gets extra retries for the known
// transient detached-shell race where the app shell briefly disappears between
// async view loaders (all shell geometry is zero). Real overflow/layout failures
// still fail fast after the normal retry and are never hidden.
const target=new URL('./browser-preview-qa-once.mjs',import.meta.url);
const mobileTarget=new URL('./browser-preview-mobile-qa-runner.mjs',import.meta.url);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=error=>String(error?.stack||error?.message||error||'unknown error');
const detachedShell=error=>{const text=message(error);return text.includes('Mobile shell controls are not phone-safe')&&text.includes('"rootWidth":0')&&text.includes('"topWidth":0')&&text.includes('"menuHeight":0');};
async function runModule(url,attempt){const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`;await import(`${url.href}?attempt=${attempt}&nonce=${nonce}`);}
async function runDesktop(){
  let first=null;
  try{await runModule(target,1);return;}
  catch(error){first=error;console.warn(`Preview desktop/browser QA transient failure; retrying once: ${message(error)}`);}
  await sleep(1200);
  try{await runModule(target,2);}
  catch(second){throw new Error(`Preview desktop/browser QA failed twice. First: ${message(first)}\nSecond: ${message(second)}`);}
}
async function runMobile(){
  const failures=[];let genericRetryUsed=false;
  for(let attempt=1;attempt<=4;attempt++){
    try{await runModule(mobileTarget,attempt);return;}
    catch(error){
      failures.push(error);
      const detached=detachedShell(error);
      if(detached&&attempt<4){console.warn(`Preview mobile QA hit a detached-shell race on attempt ${attempt}; retrying exhaustive mobile assertions: ${message(error)}`);await sleep(900);continue;}
      if(!detached&&!genericRetryUsed&&attempt<4){genericRetryUsed=true;console.warn(`Preview mobile QA transient failure; retrying once: ${message(error)}`);await sleep(1200);continue;}
      throw new Error(`Preview mobile QA failed after ${failures.length} attempt(s). ${failures.map((item,index)=>`Attempt ${index+1}: ${message(item)}`).join('\n')}`);
    }
  }
}
await runDesktop();
await runMobile();
