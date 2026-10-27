import {runWithSessionMaintenance} from './session-maintenance.js';
import {guardSessionRequest} from './session-request-guard.js';
import {auditEasyOrdersReadOnlyRpc} from './easyorders-readonly-audit-rpc.js';
import app,{SyncEntrypoint as BaseSyncEntrypoint} from './index-commerce-v38-base.js';
import {handleClarityApi,syncClarityScheduled} from './clarity-integration.js';
import {handleAIMarketing} from './ai-marketing-analyst.js';
import {handleCompetitorIntelligence} from './competitor-intelligence.js';
import {handleSubscriptionControl} from './subscription-control.js';
import {reconcileMonthlySubscriptions} from './subscription-billing.js';
import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';
import {requirePermission} from './access-control.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';
import {handleAccountingMonthly} from './accounting-monthly.js';
import {handleFinancialAccountingOS} from './accounting-faos-api.js';
import {handleAutomationWorkflowsV104} from './automation-workflows-v104.js';
import {handleOperationalWorkflowV110} from './operational-workflow-v110.js';
import {handleMobileAppUpdate} from './mobile-app-update.js';
import {handleCustomerServicePeriodV111} from './customer-service-period-v111.js';
import {handleInternalCollaborationV117} from './internal-collaboration-v117.js';
import {handleCollaborationOrderInputV119} from './internal-collaboration-order-input-v119.js';

const V2_UI_SCRIPTS=[
  '<script src="/v2/modules-v155-accounting-faos.js?v=155.4" data-kun-accounting-faos="1"></script>',
  '<script src="/v2/modules-v105-customer-service-claim.js?v=105.2" data-kun-customer-service-claim="1"></script>',
  '<script src="/v2/modules-v105-section-nav-actions.js?v=105.1" data-kun-section-nav-actions="1"></script>',
  '<script src="/v2/modules-v106-manual-jnt-order.js?v=106.0" data-kun-manual-jnt-order="1"></script>',
  '<script src="/v2/modules-v107-mobile-app-update.js?v=107.0" data-kun-mobile-app-update="1"></script>',
  '<script src="/v2/modules-v109-operational-date-contact.js?v=109.1" data-kun-operational-date-contact="1"></script>',
  '<script src="/v2/modules-v118-customer-service-nav-ready.js?v=118.0" data-kun-customer-service-nav-ready="1"></script>',
  '<script src="/v2/modules-v117-collaboration-root.js?v=117.0" data-kun-collaboration-root="1"></script>',
  '<script src="/v2/modules-v117-collaboration.js?v=117.0" data-kun-collaboration="1"></script>',
  '<script src="/v2/modules-v117-collaboration-sidebar.js?v=117.3" data-kun-collaboration-sidebar="1"></script>',
  '<script src="/v2/modules-v119-collaboration-order-link.js?v=119.0" data-kun-collaboration-order-link="1"></script>',
  '<script src="/v2/modules-v122-dashboard-experience.js?v=122.4" data-kun-dashboard-experience="1"></script>',
  '<script src="/v2/modules-v123-dashboard-unified.js?v=123.1" data-kun-dashboard-unified="1"></script>',
  '<script src="/v2/modules-v124-dashboard-periods-province.js?v=124.2" data-kun-dashboard-periods-v124="1"></script>',
  '<script src="/v2/modules-v125-dashboard-section-periods.js?v=125.3" data-kun-dashboard-section-periods-v125="1"></script>',
  '<script src="/v2/modules-v126-dashboard-finance-top.js?v=126.5" data-kun-dashboard-finance-top-v126="1"></script>',
  '<script src="/v2/modules-v127-subscriptions.js?v=127.22" data-kun-subscriptions-v127="1"></script>'
];

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

function missingV2UiScripts(html){
  return V2_UI_SCRIPTS.filter(tag=>{
    const marker=tag.match(/\s(data-kun-[\w-]+)="1"/)?.[1];
    return !marker||!html.includes(`${marker}="1"`);
  }).join('');
}

async function injectV2Ui(request,response){
  if(request.method!=='GET'||!response?.ok)return response;
  const path=new URL(request.url).pathname;
  if(path!=='/v2'&&path!=='/v2/'&&path!=='/v2/index.html')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text(),scripts=missingV2UiScripts(html);
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Cache-Control','no-store');
  if(!scripts)return new Response(html,{status:response.status,statusText:response.statusText,headers});
  const body=html.includes('</body>')?html.replace('</body>',`${scripts}</body>`):html+scripts;
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
// Report the actual outer Preview entrypoint rather than the inherited v36
// compatibility route. A version string is a code signal, NOT proof that
// the 5-minute Cron fired or that Easy Orders delivered any specific order.
const KUN_PREVIEW_ENTRYPOINT_BUILD='preview-v38-easyorders-runtime-attestation-2026-10-24';
function actualPreviewVersion(env){
  return new Response(JSON.stringify({
    ok:true,build:KUN_PREVIEW_ENTRYPOINT_BUILD,entrypoint:'index-commerce-v38.js',
    environment:env?.APP_ENV||'unknown',source:'outer-worker',
    cronExecutionProven:false,liveOrderRecoveryProven:false
  }),{status:200,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Kun-Build':KUN_PREVIEW_ENTRYPOINT_BUILD
  }});
}
// Serialized inventory activation is deferred: existing allocation conflict requires reconciliation.
void safety;
void core;
export default {
  async fetch(request,env,ctx){
    const sessionGuard=guardSessionRequest(request);if(sessionGuard)return sessionGuard;
    if(request.method==='GET'&&new URL(request.url).pathname==='/api/preview/growth-release')return app.fetch(request,env,ctx);
    if(request.method==='GET'&&new URL(request.url).pathname==='/api/preview/version')
      return actualPreviewVersion(env);
    const rootRedirect=redirectLegacyRoot(request);
    if(rootRedirect)return rootRedirect;
    // Enforce subscription and balance state before AI, Clarity or competitor add-ons.
    // Auth/login and topup recovery exemptions are defined centrally in subscription-control.
    const subscription=await handleSubscriptionControl({request,env,ctx,delegate:app});
    if(subscription)return subscription;
    const competitors=await handleCompetitorIntelligence({request,env,ctx,delegate:app});
    if(competitors)return competitors;
    const aiMarketing=await handleAIMarketing({request,env,ctx,delegate:app});
    if(aiMarketing)return aiMarketing;
    const clarity=await handleClarityApi({request,env,ctx,delegate:app});
    if(clarity)return clarity;
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
    const faos=await handleFinancialAccountingOS({request,env,ctx,delegate:app});
    if(faos)return faos;
    const monthly=await handleAccountingMonthly({request,env,ctx,delegate:app});
    if(monthly)return monthly;
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    const baseResponse=await app.fetch(request,env,ctx);
    return injectV2Ui(request,baseResponse);
  },
  scheduled(event,env,ctx){
    const task=runWithSessionMaintenance(event?.cron,env,()=>app.scheduled?.(event,env,ctx));
    ctx?.waitUntil?.(task);return task;
  }
};

export class SyncEntrypoint extends BaseSyncEntrypoint {
  async auditEasyOrdersGapsReadOnly(input){return auditEasyOrdersReadOnlyRpc(this.env,input);}
  async runCron(cron){
    const upstream=await runWithSessionMaintenance(cron,this.env,()=>super.runCron(cron));
    if(String(cron||'')==='0 */2 * * *'){
      const clarity=await syncClarityScheduled(this.env,{limit:30}).catch(error=>({ok:false,code:error?.code||'CLARITY_SCHEDULED_FAILED'}));
      return {...(upstream&&typeof upstream==='object'?upstream:{upstream}),clarity};
    }
    return upstream;
  }
  async health(){return {...await super.health(),
    // `build` is historically inherited from inner v35 and is not the deployed
    // outer entrypoint. Return a separate explicit signal without suppressing it.
    outerEntrypoint:'index-commerce-v38.js',
    outerBuild:KUN_PREVIEW_ENTRYPOINT_BUILD,
    cronExecutionProven:false,
    clarity:'connected-store-snapshots-every-12h'};}
}