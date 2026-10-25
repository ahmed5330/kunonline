import app,{SyncEntrypoint} from '../src/index-commerce-v38.js';
import {syntheticProviderFetch} from './easyorders-synthetic-provider.mjs';

globalThis.fetch=syntheticProviderFetch;
export {SyncEntrypoint};
export default {
  async fetch(request,env,ctx){
    if(env.KUN_ISOLATED_QA!=='true'||env.APP_ENV!=='preview')return new Response('QA configuration required',{status:503});
    if(new URL(request.url).pathname==='/__qa/identity'&&request.method==='GET')
      return Response.json({syntheticOnly:true,sourceSha:env.KUN_CANDIDATE_SHA,externalNetworkPolicy:'synthetic-easyorders-only'});
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){
    if(env.KUN_ISOLATED_QA!=='true')throw new Error('QA_CONFIGURATION_REQUIRED');
    return app.scheduled(controller,env,ctx);
  }
};
