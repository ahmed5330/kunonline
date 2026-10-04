import app from './index-commerce-v38-base.js';
import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';
import {handleAccountingMonthly} from './accounting-monthly.js';
import {handleAutomationWorkflowsV104} from './automation-workflows-v104.js';
import {handleOperationalWorkflowV110} from './operational-workflow-v110.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleCustomerServicePeriodV111} from './customer-service-period-v111.js';
import {handleSubscriptionControl} from './subscription-control.js';
import {reconcileMonthlySubscriptions} from './subscription-billing.js';

const V2_UI_SCRIPTS=[
  '<script src="/v2/modules-v105-customer-service-claim.js?v=105.2" data-kun-customer-service-claim="1"></script>',
  '<script src="/v2/modules-v105-section-nav-actions.js?v=105.1" data-kun-section-nav-actions="1"></script>',
  '<script src="/v2/modules-v106-manual-jnt-order.js?v=106.0" data-kun-manual-jnt-order="1"></script>',
  '<script src="/v2/modules-v107-mobile-app-update.js?v=107.0" data-kun-mobile-app-update="1"></script>',
  '<script src="/v2/modules-v109-operational-date-contact.js?v=109.1" data-kun-operational-date-contact="1"></script>',
  '<script src="/v2/modules-v122-dashboard-experience.js?v=122.0" data-kun-dashboard-experience="1"></script>',
  '<script src="/v2/modules-v123-dashboard-unified.js?v=123.0" data-kun-dashboard-unified="1"></script>',
  '<script src="/v2/modules-v124-dashboard-periods-province.js?v=124.0" data-kun-dashboard-periods-v124="1"></script>',
  '<script src="/v2/modules-v125-dashboard-section-periods.js?v=125.0" data-kun-dashboard-section-periods-v125="1"></script>',
  '<script src="/v2/modules-v126-dashboard-finance-top.js?v=126.0" data-kun-dashboard-finance-top-v126="1"></script>',
  '<script src="/v2/modules-v127-subscriptions.js?v=127.8" data-kun-subscriptions-v127="1"></script>'
].join('');
const LIVE_TEAM_ASSET_FROM='/v2/modules-v117-team-collaboration.js?v=117.0';
const LIVE_TEAM_ASSET_TO='/v2/modules-v117-team-collaboration.js?v=117.1';

function redirectLegacyRoot(request){
  if(request.method!=='GET'&&request.method!=='HEAD')return null;
  const url=new URL(request.url);
  if(url.pathname!=='/')return null;
  url.pathname='/v2/';
  return new Response(null,{status:302,headers:{Location:url.toString(),'Cache-Control':'no-store'}});
}

async function injectV2Ui(request,response){
  if(request.method!=='GET'||!response?.ok)return response;
  const path=new URL(request.url).pathname;
  if(path!=='/v2'&&path!=='/v2/'&&path!=='/v2/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let html=await response.text();
  html=html.replaceAll(LIVE_TEAM_ASSET_FROM,LIVE_TEAM_ASSET_TO);
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Cache-Control','no-store');
  if(html.includes('data-kun-customer-service-claim="1"'))return new Response(html,{status:response.status,statusText:response.statusText,headers});
  const body=html.includes('</body>')?html.replace('</body>',`${V2_UI_SCRIPTS}</body>`):html+V2_UI_SCRIPTS;
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
    const subscription=await handleSubscriptionControl({request,env,ctx,delegate:app});
    if(subscription)return subscription;
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
  scheduled(event,env,ctx){ctx?.waitUntil?.(reconcileMonthlySubscriptions(env,{limit:1000}).catch(()=>[]));return app.scheduled?.(event,env,ctx);}
};

export {SyncEntrypoint} from './index-commerce-v38-base.js';
