import {createHash} from 'node:crypto';

export function isolatedQaRunSuffix(runId,attempt='1'){
  if(!/^[1-9]\d{0,19}$/.test(String(runId||''))||! /^[1-9]\d{0,3}$/.test(String(attempt||'')))
    throw new Error('QA_RUNTIME_IDENTITY_INVALID');
  return `${runId}${String(attempt).padStart(4,'0')}`;
}

export async function waitForIsolatedQaAsset({base,expectedBytes,fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=24}={}){
  const url=new URL(base);
  if(url.protocol!=='https:'||!/^kunonline-isolated-qa-\d+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)
    throw new Error('QA_ASSET_TARGET_UNSAFE');
  if(!Number.isInteger(attempts)||attempts<1||attempts>24||!expectedBytes?.length)throw new Error('QA_ASSET_INPUT_INVALID');
  const hash=b=>createHash('sha256').update(b).digest('hex'),expected=hash(expectedBytes);
  for(let i=0;i<attempts;i++){
    const response=await fetchImpl(new URL('/v2/modules-v106-manual-jnt-order.js?v=106.0',url),{redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Cache-Control':'no-cache'}});
    if(response.status===200){
      if(hash(Buffer.from(await response.arrayBuffer()))!==expected)throw new Error('QA_ASSET_CONTENT_MISMATCH');
      return;
    }
    if(response.status!==404)throw new Error('QA_ASSET_HTTP_REJECTED');
    if(i+1<attempts)await wait(1000);
  }
  throw new Error('QA_ASSET_PROPAGATION_TIMEOUT');
}
