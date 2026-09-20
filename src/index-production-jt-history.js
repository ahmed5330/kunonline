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

export default {
  async fetch(request,env,ctx){
    const mobileUpdate=handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    return injectMobileUpdateUi(request,await app.fetch(request,env,ctx));
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
