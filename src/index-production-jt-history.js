import app from './index-production-sync.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';

const MOBILE_UPDATE_SCRIPT='<script src="/v2/modules-v107-mobile-app-update.js?v=107.0" data-kun-mobile-app-update="1"></script>';

async function injectMobileUpdateUi(request,response){
  if(request.method!=='GET'||!response?.ok)return response;
  const path=new URL(request.url).pathname;
  if(path!=='/v2'&&path!=='/v2/'&&path!=='/v2/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  if(html.includes('data-kun-mobile-app-update="1"'))return new Response(html,{status:response.status,statusText:response.statusText,headers:response.headers});
  const body=html.includes('</body>')?html.replace('</body>',`${MOBILE_UPDATE_SCRIPT}</body>`):html+MOBILE_UPDATE_SCRIPT;
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Cache-Control','no-store');
  return new Response(body,{status:response.status,statusText:response.statusText,headers});
}

async function augmentEasyOrdersHealth(request,response,env){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/health/easyorders-sync'||!response)return response;
  const data=await response.clone().json().catch(()=>null);
  if(!data||typeof data!=='object')return response;
  let state={};
  try{
    const row=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();
    state=JSON.parse(row?.json||'{}');
  }catch(error){
    state={__diagnosticError:String(error?.message||error).slice(0,160)};
  }
  const clients=Array.isArray(state.clients)?state.clients:[];
  const configured=clients.filter(c=>String(c?.storeId||'').trim()&&c?.easyOrdersToken);
  const results=Array.isArray(state?.easyOrdersRecovery?.results)?state.easyOrdersRecovery.results:[];
  const failed=results.filter(r=>r?.status==='error'||r?.error);
  const invalidApiKey=failed.filter(r=>/api-key\s+not\s+valid|invalid\s+api.?key/i.test(String(r?.error||''))).length;
  const unreadableKey=failed.filter(r=>/missing or cannot be decrypted|cannot be decrypted/i.test(String(r?.error||''))).length;
  data.runtimeDiagnostics={
    configuredLegacyClients:configured.length,
    failedLegacyClients:failed.length,
    failureCode:invalidApiKey?'EASYORDERS_API_KEY_INVALID':unreadableKey?'EASYORDERS_API_KEY_UNREADABLE':failed.length?'EASYORDERS_SYNC_ERROR':null,
    invalidApiKeyClients:invalidApiKey,
    unreadableKeyClients:unreadableKey,
    stateReadFailed:Boolean(state.__diagnosticError)
  };
  const credentialFailure=data.runtimeDiagnostics.failureCode==='EASYORDERS_API_KEY_INVALID'||data.runtimeDiagnostics.failureCode==='EASYORDERS_API_KEY_UNREADABLE';
  if(credentialFailure&&data?.legacyFallback?.active===true&&String(data.legacyFallback.status||'')==='error'){
    data.legacyFallback.status='needs_reconnect';
    if(String(data.status||'')==='error')data.status='needs_reconnect';
    data.runtimeDiagnostics.actionRequired='reconnect_easyorders';
  }
  const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');headers.delete('Content-Length');
  return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request,env,ctx){
    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    const response=await app.fetch(request,env,ctx);
    const diagnosed=await augmentEasyOrdersHealth(request,response,env);
    return injectMobileUpdateUi(request,diagnosed);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
