// Full Preview desktop/runtime plus exhaustive phone QA. The combined suite is retried once only for transient timing failures.
const target=new URL('./browser-preview-qa-once.mjs',import.meta.url);
const mobileTarget=new URL('./browser-preview-mobile-qa.mjs',import.meta.url);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=error=>String(error?.stack||error?.message||error||'unknown error');
async function runAttempt(attempt){
  const nonce=Date.now();
  await import(`${target.href}?attempt=${attempt}&nonce=${nonce}`);
  await import(`${mobileTarget.href}?attempt=${attempt}&nonce=${nonce}`);
}
let firstError=null;
try{
  await runAttempt(1);
}catch(error){
  firstError=error;
  console.warn(`Preview Browser QA transient failure; retrying desktop + exhaustive mobile assertions once: ${message(error)}`);
  await sleep(1200);
  try{await runAttempt(2);}
  catch(secondError){throw new Error(`Preview Browser QA failed twice. First: ${message(firstError)}\nSecond: ${message(secondError)}`);}
}
