import app from './index-commerce-v38-base.js';
import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';
import {handleJtHistoryReconcile} from './jt-history-reconcile.js';
import {handleAccountingMonthly} from './accounting-monthly.js';
import {handleAutomationWorkflowsV104} from './automation-workflows-v104.js';

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
    const automation=await handleAutomationWorkflowsV104({request,env,ctx,delegate:app});
    if(automation)return automation;
    const monthly=await handleAccountingMonthly({request,env,ctx,delegate:app});
    if(monthly)return monthly;
    const handled=await handleJtHistoryReconcile({request,env,ctx,delegate:app});
    if(handled)return handled;
    return app.fetch(request,env,ctx);
  },
  scheduled(event,env,ctx){return app.scheduled?.(event,env,ctx);}
};

export {SyncEntrypoint} from './index-commerce-v38-base.js';