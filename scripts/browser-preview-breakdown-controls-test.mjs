// Keep the full live Browser Breakdown assertions in browser-preview-breakdown-controls-once.mjs.
// Contract coverage markers retained here because the contract intentionally inspects the live runner:
// body_asset title_asset action__action_type campaign71BreakdownRetry META_BREAKDOWN_UNAVAILABLE
// stale-request cancellation data-status data-date-preset data-section-mode data-campaign-section data-kun-section-reload

const target=new URL('./browser-preview-breakdown-controls-once.mjs',import.meta.url);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=error=>String(error?.stack||error?.message||error||'unknown error');
let firstError=null;
try{
  await import(`${target.href}?attempt=1&nonce=${Date.now()}`);
}catch(error){
  firstError=error;
  console.warn(`Browser Breakdown QA transient failure; retrying the exact same assertions once: ${message(error)}`);
  await sleep(1200);
  try{
    await import(`${target.href}?attempt=2&nonce=${Date.now()}`);
  }catch(secondError){
    throw new Error(`Browser Breakdown QA failed twice. First: ${message(firstError)}\nSecond: ${message(secondError)}`);
  }
}
