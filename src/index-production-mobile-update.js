import app from './index-production-sync.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';

export default {
  async fetch(request,env,ctx){
    const mobileUpdate=handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};
