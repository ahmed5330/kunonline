import app from './index-production-sync.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';

export default {
  async fetch(request,env,ctx){
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
