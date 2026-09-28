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
    state={__diagnosticError:String(error?.message||error).slice(0,200)};
  }
  const clients=Array.isArray(state.clients)?state.clients:[];
  const configured=clients.filter(c=>String(c?.storeId||'').trim()&&c?.easyOrdersToken);
  const encrypted=configured.filter(c=>String(c.easyOrdersToken||'').startsWith('enc$')).length;
  const plain=configured.length-encrypted;
  const results=Array.isArray(state?.easyOrdersRecovery?.results)?state.easyOrdersRecovery.results:[];
  data.runtimeDiagnostics={
    tokenEncKeyConfigured:Boolean(env.TOKEN_ENC_KEY),
    integrationEncryptionKeyConfigured:Boolean(env.INTEGRATION_ENCRYPTION_KEY),
    sessionSecretConfigured:Boolean(env.SESSION_SECRET),
    easyOrdersWebhookSecretConfigured:Boolean(env.EASYORDERS_WEBHOOK_SECRET),
    legacyCredentials:{configuredClients:configured.length,encryptedClients:encrypted,plainClients:plain},
    legacyErrors:results.filter(r=>r?.status==='error'||r?.error).map(r=>({clientId:String(r?.clientId||''),status:String(r?.status||''),error:String(r?.error||'').slice(0,240)})),
    stateReadError:state.__diagnosticError||null
  };
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
