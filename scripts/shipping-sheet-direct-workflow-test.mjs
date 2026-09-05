import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [entry,direct]=await Promise.all([read('src/index-commerce-v36.js'),read('src/shipping-sheet-direct-workflow.js')]);
const must=(ok,message)=>{if(!ok)throw new Error(`Direct Smart Shipping contract failed: ${message}`);};
const has=(text,needle,message=needle)=>must(text.includes(needle),message);

for(const marker of ['applyShippingSheetWorkflowDirect','gateShippingSheetInventory','setShippingCost','settleState','recordCarrierFinancials','markShippingSheetInventoryResolved','markPostShippingDeliveredV47','finalizeHistoricalReturnedInventoryBackfill','reconcileManagementFeeForOrder','directSettlement:true'])has(direct,marker,`missing direct workflow marker: ${marker}`);
must(!direct.includes('commerceV35.fetch')&&!direct.includes('childRequest('),'direct Smart Shipping workflow must not recurse through a Commerce HTTP router');
const flow=direct.slice(direct.indexOf('export async function applyShippingSheetWorkflowDirect'));
must(flow.indexOf('gateShippingSheetInventory')<flow.indexOf('setShippingCost')&&flow.indexOf('setShippingCost')<flow.indexOf('settleState')&&flow.indexOf('settleState')<flow.indexOf('recordCarrierFinancials'),'direct workflow order must be inventory -> shipping cost/state -> carrier financials');
has(direct,"if(['confirmed','preparing'].includes(clean(row.state)))",'delivered reconciliation must advance legacy confirmed/preparing orders directly');
has(direct,"if(clean(row.state)==='shipped')await markPostShippingDeliveredV47",'shipped orders must use the direct post-shipping state writer');
has(direct,"if(clean(row.state)==='returned')return {state:'returned',changed:false}",'repeated returned sheets must be state-idempotent');
has(direct,'inventoryAlreadySynced','direct result must expose already-synced inventory');
has(direct,'inventoryAllocatedNow','direct result must expose newly allocated inventory');

has(entry,"import {applyShippingSheetWorkflowDirect} from './shipping-sheet-direct-workflow.js'",'v36 must import the direct workflow');
const applyRoute=entry.slice(entry.indexOf('async function shippingSheetApplyRoute'),entry.indexOf('async function shippingSheetRetryRoute'));
has(applyRoute,'applyShippingSheetWorkflowDirect','shipping-sheet-apply must use the direct workflow');
const retryRoute=entry.slice(entry.indexOf('async function shippingSheetRetryRoute'),entry.indexOf('async function guardedDirectDelivered'));
has(retryRoute,'applyShippingSheetWorkflowDirect','shipping-sheet-retry must resume through the direct workflow');
has(entry,"if(applyMatch&&method==='PATCH')return await shippingSheetApplyRoute",'router must await apply route so v36 catches async failures as JSON');
has(entry,"if(retryMatch&&method==='PATCH')return await shippingSheetRetryRoute",'router must await retry route so v36 catches async failures as JSON');
has(entry,'shippingSheetDirectSettlement:true','health must advertise direct settlement');

new Function(direct.replace(/^import .*$/gm,'').replace(/^export /gm,''));
console.log('Direct Smart Shipping contract passed: shipping-sheet apply/retry run inventory -> state -> financials in one Worker invocation, keep idempotent stock semantics, and async failures stay inside the v36 JSON error boundary.');
