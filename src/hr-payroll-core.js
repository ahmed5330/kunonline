// Pure payroll draft calculation. No DB, routes, posting, payment or customer/provider access.
// Owner-approved basis: actual verified collections net of verified refunds, not order status/value.
const fail=code=>{throw Object.assign(new Error(code),{code});};
const integer=(value,code='HR_INVALID_AMOUNT')=>{if(!Number.isSafeInteger(value)||value<0)fail(code);return value;};
const sum=(a,b)=>{const total=a+b;if(!Number.isSafeInteger(total))fail('HR_AMOUNT_OVERFLOW');return total;};
function scopeMatch(value,scope){if(!value||value.clientId!==scope.clientId||value.storeId!==scope.storeId||value.employeeId!==scope.employeeId)fail('HR_SCOPE_MISMATCH');}
function cairoMonth(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('HR_DATE_ZONE_REQUIRED');
 const date=new Date(value);if(Number.isNaN(date.getTime()))fail('HR_INVALID_DATE');
 const day=new Date(value.slice(0,10)+'T00:00:00Z');if(Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))fail('HR_INVALID_DATE');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).formatToParts(date);
 return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
}
export function normalizeHREmployee(value){
 if(!value||!String(value.name||'').trim()||String(value.name).trim().length>120)fail('HR_EMPLOYEE_NAME_REQUIRED');
 const code=String(value.code||'').trim();if(!/^[\p{L}\p{N}_-]{1,60}$/u.test(code))fail('HR_EMPLOYEE_CODE_INVALID');
 integer(value.baseSalaryMinor);integer(value.commissionRateBps,'HR_COMMISSION_RATE_INVALID');
 if(value.commissionRateBps>10000||typeof value.commissionEnabled!=='boolean')fail('HR_COMMISSION_RATE_INVALID');
 if(!['active','inactive'].includes(value.status))fail('HR_EMPLOYEE_STATUS_INVALID');
 return {name:String(value.name).trim(),code,baseSalaryMinor:value.baseSalaryMinor,commissionEnabled:value.commissionEnabled,commissionRateBps:value.commissionRateBps,status:value.status};
}
export function calculatePayrollDraft({scope,employee,month,events=[],adjustments=[]}){
 if(!scope?.clientId||!scope.storeId||!scope.employeeId)fail('HR_SCOPE_REQUIRED');
 const person=normalizeHREmployee(employee);if(person.status!=='active')fail('HR_EMPLOYEE_INACTIVE');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('HR_PERIOD_INVALID');
 if(!Array.isArray(events)||events.length>10000||!Array.isArray(adjustments)||adjustments.length>1000)fail('HR_INPUT_LIMIT');
 const unique=new Map(),collectedByOrder=new Map(),refundedByOrder=new Map(),timeline=new Map();
 let collectedMinor=0,refundMinor=0,bonusMinor=0,deductionMinor=0;
 for(const event of events){
   scopeMatch(event,scope);
   if(!event.id||!event.orderId||!event.sourceReference||event.verified!==true||event.currency!=='EGP'||!['collection','refund'].includes(event.kind))fail('HR_VERIFIED_CASH_EVIDENCE_REQUIRED');
   integer(event.amountMinor);if(!event.amountMinor)fail('HR_POSITIVE_CASH_AMOUNT_REQUIRED');
   const period=cairoMonth(event.occurredAt),canonical=JSON.stringify([event.clientId,event.storeId,event.employeeId,event.orderId,event.sourceReference,event.currency,event.kind,event.amountMinor,event.occurredAt]);
   if(unique.has(event.id)){if(unique.get(event.id)!==canonical)fail('HR_EVENT_REPLAY_CONFLICT');continue;}
   unique.set(event.id,canonical);
   if(!timeline.has(event.orderId))timeline.set(event.orderId,[]);timeline.get(event.orderId).push(event);
   const map=event.kind==='collection'?collectedByOrder:refundedByOrder;map.set(event.orderId,sum(map.get(event.orderId)||0,event.amountMinor));
   if(period===month){if(event.kind==='collection')collectedMinor=sum(collectedMinor,event.amountMinor);else refundMinor=sum(refundMinor,event.amountMinor);}
 }
 for(const [order,refund] of refundedByOrder)if(refund>(collectedByOrder.get(order)||0))fail('HR_REFUND_COLLECTION_PROOF_REQUIRED');
 for(const entries of timeline.values()){
   let balance=0;
   for(const row of entries.sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||(a.kind==='collection'?-1:1))){balance+=row.kind==='collection'?row.amountMinor:-row.amountMinor;if(balance<0)fail('HR_REFUND_COLLECTION_PROOF_REQUIRED');}
 }
 const netCollectedMinor=collectedMinor-refundMinor;
 // Do not silently claw prior commissions back from basic salary or invent a carry policy.
 if(netCollectedMinor<0)fail('HR_NEGATIVE_NET_REQUIRES_REVIEW');
 const adjustmentIds=new Set();
 for(const row of adjustments){
   scopeMatch(row,scope);
   if(row.month!==month)fail('HR_ADJUSTMENT_PERIOD_MISMATCH');
   if(!row.id||adjustmentIds.has(row.id)||!row.approvedBy||!row.reason||!row.sourceReference||!['bonus','deduction'].includes(row.kind))fail('HR_APPROVED_ADJUSTMENT_REQUIRED');
   adjustmentIds.add(row.id);integer(row.amountMinor);
   if(row.kind==='bonus')bonusMinor=sum(bonusMinor,row.amountMinor);else deductionMinor=sum(deductionMinor,row.amountMinor);
 }
 const commissionBig=person.commissionEnabled?(BigInt(netCollectedMinor)*BigInt(person.commissionRateBps)+5000n)/10000n:0n;
 if(commissionBig>BigInt(Number.MAX_SAFE_INTEGER))fail('HR_AMOUNT_OVERFLOW');
 const commissionMinor=Number(commissionBig),grossMinor=sum(sum(person.baseSalaryMinor,commissionMinor),bonusMinor);
 if(deductionMinor>grossMinor)fail('HR_NEGATIVE_PAY_REQUIRES_REVIEW');
 return {status:'draft_unposted',basis:'verified_net_actual_collections_after_refunds',scope:{...scope},month,currency:'EGP',baseSalaryMinor:person.baseSalaryMinor,collectedMinor,refundMinor,netCollectedMinor,commissionMinor,bonusMinor,deductionMinor,netPayBeforeStatutoryMinor:grossMinor-deductionMinor,cashEvidenceIds:[...unique.keys()],adjustmentIds:[...adjustmentIds],financialPostingEnabled:false,paymentEnabled:false,statutoryDeductionsCalculated:false};
}
