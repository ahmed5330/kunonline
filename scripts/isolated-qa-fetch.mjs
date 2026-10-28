import {assertIsolatedEasyOrdersQa} from './easyorders-qa-isolation-guard.mjs';

export function createIsolatedQaFetch(nativeFetch,{baseUrl,configText,approvedDatabaseId,wait=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=()=>{}}){
  assertIsolatedEasyOrdersQa({baseUrl,configText,approvedDatabaseId});
  const origin=new URL(baseUrl).origin;
  const readErrors=new Set(['ECONNRESET','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT']);
  return async function qaFetch(input,init={}){
    let url;try{url=new URL(input instanceof Request?input.url:input);}catch{return nativeFetch(input,init);}
    const method=String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    const read=method==='GET'||method==='HEAD';
    const cloudflare=url.origin==='https://api.cloudflare.com';
    const isolatedQuery=cloudflare&&/^\/client\/v4\/accounts\/[a-f0-9]{32}\/d1\/database\//i.test(url.pathname)&&url.pathname.endsWith(`/${approvedDatabaseId}/query`);
    const scope=url.origin===origin||(cloudflare&&(read||isolatedQuery));
    const reusable=!(input instanceof Request)&&(init.body==null||typeof init.body==='string'||init.body instanceof Uint8Array);
    if(!scope||!reusable)return nativeFetch(input,init);
    // Do not follow a write redirect: a later connection timeout would no
    // longer prove that the original write had not reached its server.
    const requestInit=read?init:{...init,redirect:init.redirect==='manual'?'manual':'error'};
    for(let attempt=0;;attempt++){
      try{return await nativeFetch(url.href,requestInit);}
      catch(error){
        const code=error?.cause?.code||error?.code;
        // A connect timeout happens before HTTP is sent. A reset after sending
        // is ambiguous for writes, so those writes must never be replayed.
        const retryable=read?readErrors.has(code):code==='UND_ERR_CONNECT_TIMEOUT';
        if(attempt>=2||!retryable||init.signal?.aborted)throw error;
        onRetry({kind:'ISOLATED_QA_TRANSPORT_RETRY',method,code,nextAttempt:attempt+2});
        await wait(attempt===0?250:750);
      }
    }
  };
}

const installed=Symbol.for('kun.isolatedQaFetch');
export function installIsolatedQaFetch(options){
  if(globalThis[installed])return;
  globalThis.fetch=createIsolatedQaFetch(globalThis.fetch.bind(globalThis),{...options,onRetry:row=>console.warn(JSON.stringify(row))});
  globalThis[installed]=true;
}
