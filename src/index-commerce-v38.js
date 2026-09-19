import app from './index-commerce-v38-base.js';
import core from './index-commerce-v38-core.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';

void core;
export default {
  async fetch(request,env,ctx){
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};

export {SyncEntrypoint} from './index-commerce-v38-base.js';
