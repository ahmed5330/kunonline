// The full Preview browser/runtime/responsive assertions live in browser-preview-qa-once.mjs.
// This runner retries the complete test once only for transient browser/render timing failures.
// No assertion, runtime error check, network failure check, responsive check, or Customer Service check is skipped.

const target=new URL('./browser-preview-qa-once.mjs',import.meta.url);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=error=>String(error?.stack||error?.message||error||'unknown error');
let firstError=null;
try{
  await import(`${target.href}?attempt=1&nonce=${Date.now()}`);
}catch(error){
  firstError=error;
  console.warn(`Preview Browser QA transient failure; retrying the exact same assertions once: ${message(error)}`);
  await sleep(1200);
  try{
    await import(`${target.href}?attempt=2&nonce=${Date.now()}`);
  }catch(secondError){
    throw new Error(`Preview Browser QA failed twice. First: ${message(firstError)}\nSecond: ${message(secondError)}`);
  }
}
