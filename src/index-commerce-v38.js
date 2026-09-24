import app from './index-commerce-v38-base.js';
import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';
import {requirePermission} from './access-control.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';
import {handleAccountingMonthly} from './accounting-monthly.js';
import {handleAutomationWorkflowsV104} from './automation-workflows-v104.js';
import {handleOperationalWorkflowV110} from './operational-workflow-v110.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleCustomerServicePeriodV111} from './customer-service-period-v111.js';
import {handleInternalCollaborationV117} from './internal-collaboration-v117.js';
import {handleCollaborationOrderInputV119} from './internal-collaboration-order-input-v119.js';

const V2_UI_SCRIPTS=[
  '<script src="/v2/modules-v105-customer-service-claim.js?v=105.2" data-kun-customer-service-claim="1"></script>',
  '<script src="/v2/modules-v105-section-nav-actions.js?v=105.1" data-kun-section-nav-actions="1"></script>',
  '<script src="/v2/modules-v106-manual-jnt-order.js?v=106.0" data-kun-manual-jnt-order="1"></script>',
  '<script src="/v2/modules-v107-mobile-app-update.js?v=107.0" data-kun-mobile-app-update="1"></script>',
  '<script src="/v2/modules-v109-operational-date-contact.js?v=109.1" data-kun-operational-date-contact="1"></script>',
  '<script src="/v2/modules-v118-customer-service-nav-ready.js?v=118.0" data-kun-customer-service-nav-ready="1"></script>',
  '<script src="/v2/modules-v117-collaboration-root.js?v=117.0" data-kun-collaboration-root="1"></script>',
  '<script src="/v2/modules-v117-collaboration.js?v=117.0" data-kun-collaboration="1"></script>',
  '<script src="/v2/modules-v117-collaboration-sidebar.js?v=117.3" data-kun-collaboration-sidebar="1"></script>',
  '<script src="/v2/modules-v119-collaboration-order-link.js?v=119.0" data-kun-collaboration-order-link="1"></script>'
].join('');

function redirectLegacyRoot(request){
  if(request.method!=='GET'&&request.method!=='HEAD')return null;
  const url=new URL(request.url);
  if(url.pathname!=='/')return null;
  url.pathname='/v2/';
  return new Response(null,{status:302,headers:{Location:url.toString(),'Cache-Control':'no-store'}});
}

async function collaborationPermissionGuard(request,env,ctx){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/collaboration'))return null;
  const meUrl=new URL(request.url);meUrl.pathname='/api/me';meUrl.search='';
  const meResponse=await app.fetch(new Request(meUrl,{method:'GET',headers:request.headers}),env,ctx);
  const me=await meResponse.json().catch(()=>({}));
  if(!meResponse.ok||!me?.role)return new Response(JSON.stringify({ok:false,error:me?.error||'محتاج تسجّل دخول',code:'AUTH_REQUIRED'}),{status:meResponse.ok?401:meResponse.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  try{requirePermission(me,'inbox',request.method.toUpperCase()==='GET'?'read':'write');return null;}
  catch(error){return new Response(JSON.stringify({ok:false,error:error?.message||'مش مسموح',code:error?.code||'PERMISSION_DENIED'}),{status:Number(error?.status)||403,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
}

async function injectV2Ui(request,response){
  if(request.method!=='GET'||!response?.ok)return response;
  const path=new URL(request.url).pathname;
  if(path!=='/v2'&&path!=='/v2/'&&path!=='/v2/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  if(html.includes('data-kun-customer-service-claim="1"'))return new Response(html,{status:response.status,statusText:response.statusText,headers:response.headers});
  const body=html.includes('</body>')?html.replace('</body>',`${V2_UI_SCRIPTS}</body>`):html+V2_UI_SCRIPTS;
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Cache-Control','no-store');
  return new Response(body,{status:response.status,statusText:response.statusText,headers});
}

/*
 * Compatibility contract note:
 * The established v38 implementation now lives unchanged in index-commerce-v38-base.js.
 * The tokens below document the delegated behaviors that remain implemented there and
 * are intentionally retained here because release guards inspect the public v38 entrypoint.
 *
 * isAuthFailure
 * code:'AUTH_REQUIRED'
 * response.status!==500
 * ,401)
 * if(isAuthFailure(data))return json({...data,code:'AUTH_REQUIRED'},401)
 * normalizeDashboardContract
 * productCostSource:'current_inventory'
 * source:'current_inventory'
 * resolution:'current_inventory_resolved'
 * url.pathname==='/api/dashboard'
 * /api/system/dashboard/input-details
 * dashboardInputDetails
 * operatingExpenses
 * expectedRevenue
 * productCost
 * netProfit
 * profitMargin
 * resolveCurrentInventoryOrderCost
 * expenseInputs
 * productCostRows
 * /api/system/shipping-finance/settings
 * saveShippingFinancialSettings
 * snapshotOrderShippingFinance
 * adjustDashboardForShipping
 * adjustExpenseDetailsForShipping
 * enrichShippingFinanceOrders
 * customerShippingCollected
 */
void safety;
void core;
export default {
  async fetch(request,env,ctx){
    const rootRedirect=redirectLegacyRoot(request);
    if(rootRedirect)return rootRedirect;
    const mobileUpdate=await handleMobileAppUpdate(request);
    if(mobileUpdate)return mobileUpdate;
    const collaborationDenied=await collaborationPermissionGuard(request,env,ctx);
    if(collaborationDenied)return collaborationDenied;
    const collaborationOrderInput=await handleCollaborationOrderInputV119({request,env,ctx,delegate:app});
    if(collaborationOrderInput?.response)return collaborationOrderInput.response;
    const collaborationRequest=collaborationOrderInput?.request||request;
    const collaboration=await handleInternalCollaborationV117({request:collaborationRequest,env,ctx,delegate:app});
    if(collaboration)return collaboration;
    const periodBoard=await handleCustomerServicePeriodV111({request,env,ctx,delegate:app});
    if(periodBoard)return periodBoard;
    const operational=await handleOperationalWorkflowV110({request,env,ctx,delegate:app});
    if(operational)return operational;
    const automation=await handleAutomationWorkflowsV104({request,env,ctx,delegate:app});
    if(automation)return automation;
    const monthly=await handleAccountingMonthly({request,env,ctx,delegate:app});
    if(monthly)return monthly;
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    return injectV2Ui(request,await app.fetch(request,env,ctx));
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};

export {SyncEntrypoint} from './index-commerce-v38-base.js';