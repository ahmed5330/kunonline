import commerceV24 from './index-commerce-v24.js';

// v25 used to mask unknown Preview API routes with synthetic empty responses.
// That made broken/missing protected routes look healthy in the UI and could hide regressions.
// Keep this layer as a transparent compatibility hop so missing routes remain visible to tests and operators.
async function fetchV25(request,env,ctx){
  return commerceV24.fetch(request,env,ctx);
}

export default {fetch:fetchV25,scheduled(controller,env,ctx){return commerceV24.scheduled?.(controller,env,ctx);}};
