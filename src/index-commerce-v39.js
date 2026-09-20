import app from './index-commerce-v38.js';
import {handleAutomationWorkflowsV104} from './automation-workflows-v104.js';

export default {
  async fetch(request,env,ctx){
    const handled=await handleAutomationWorkflowsV104({request,env,ctx,delegate:app});
    if(handled)return handled;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};

export {SyncEntrypoint} from './index-commerce-v38.js';
