/* FAOS v1: deterministic commerce event -> balanced DRAFT journal projection.
   No database or network IO. Never post a source event without verified evidence.
   Platform wallet billing is a DIFFERENT legal book and is intentionally excluded. */
import {normalizeLines,minorMoney,moneyMinor} from './accounting-faos-core.js';
const allowedTypes=new Set(['delivery_verified','inventory_cogs_verified','carrier_cod_settled','return_approved','return_stock_inspected','refund_paid']);
const allowedEvidence=new Set(['carrier_delivery_confirmation','signed_receipt','gateway_settlement_statement','verified_inventory_snapshot','approved_return_document','carrier_cod_statement','bank_statement','quality_inspection_report']);
const val=(x,label)=>{try{return moneyMinor(x)}catch{throw Object.assign(new Error('Invalid '+label),{code:'FAOS_EVENT_INVALID_AMOUNT'})}};
function requireString(value,label){const text=String(value??'').trim();if(!text)throw Object.assign(new Error('Missing '+label),{code:'FAOS_EVENT_EVIDENCE_REQUIRED'});return text;}
export function projectFinancialEvent(event){
  if(!event||!allowedTypes.has(event.type))throw Object.assign(new Error('Unsupported commerce event'),{code:'FAOS_EVENT_UNSUPPORTED'});
  if(event.currency!=='EGP')throw Object.assign(new Error('Currency must be EGP in FAOS v1'),{code:'FAOS_EVENT_CURRENCY_NOT_SUPPORTED'});
  const clientId=requireString(event.clientId,'clientId'),
        storeId=requireString(event.storeId,'storeId'),
        eventId=requireString(event.eventId,'eventId'),
        orderId=requireString(event.orderId,'orderId'),
        sourceDocument=requireString(event.sourceDocument,'sourceDocument'),
        evidenceType=requireString(event.evidenceType,'evidenceType');
  if(!allowedEvidence.has(evidenceType))throw Object.assign(new Error('Evidence not recognized'),{code:'FAOS_EVENT_EVIDENCE_REQUIRED'});
  const eventDate=requireString(event.eventDate,'eventDate');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)||Number.isNaN(Date.parse(eventDate+'T00:00:00Z')))throw new Error('Invalid eventDate');
  let lines=[],description='',detail='';
  const debit=(accountCode,minor)=>{if(minor>0)lines.push({accountCode,debit:minorMoney(minor)})};
  const credit=(accountCode,minor)=>{if(minor>0)lines.push({accountCode,credit:minorMoney(minor)})};
  if(event.type==='delivery_verified'){
    if(!['carrier_delivery_confirmation','signed_receipt'].includes(evidenceType))throw new Error('Verified delivery evidence required');
    if(!['cod','gateway','credit'].includes(event.paymentChannel))throw new Error('Invalid paymentChannel');
    const product=val(event.productRevenue,'productRevenue'),shipping=val(event.customerShippingRevenue,'customerShippingRevenue'),tax=val(event.outputTax,'outputTax');
    if(product+shipping+tax<=0)throw new Error('Sale must be positive');
    debit(event.paymentChannel==='cod'?'1230':event.paymentChannel==='gateway'?'1240':'1210',product+shipping+tax);
    credit('4100',product);credit('4110',shipping);credit('2160',tax);
    description='مبيعات مثبتة بتسليم الطلب '+orderId;
  } else if(event.type==='inventory_cogs_verified'){
    if(evidenceType!=='verified_inventory_snapshot')throw new Error('Verified cost snapshot required');
    const cost=val(event.cost,'inventory cost');
    if(!cost)throw new Error('Cost is required');
    debit('5100',cost);credit('1300',cost);description='تكلفة بضاعة مباعة '+orderId;
  } else if(event.type==='carrier_cod_settled'){
    if(evidenceType!=='carrier_cod_statement')throw new Error('Carrier COD statement required');
    requireString(event.awb,'airway bill');requireString(event.settlementId,'settlementId');
    const gross=val(event.codGross,'COD gross'),bank=val(event.bankReceived,'bank received'),
          shipping=val(event.shippingFee,'carrier shipping'),fee=val(event.codFee,'COD fee');
    if(gross===0||bank+shipping+fee!==gross)throw new Error('Carrier COD settlement does not reconcile');
    debit('1120',bank);debit('6110',shipping);debit('6114',fee);credit('1230',gross);
    description='تسوية تحصيل شركة الشحن '+orderId;
  } else if(event.type==='return_approved'){
    if(evidenceType!=='approved_return_document')throw new Error('Approved return document required');
    if(!['refund_payable','carrier_receivable'].includes(event.refundDestination))throw new Error('Missing refund destination');
    const amount=val(event.refundAmount,'refund amount'),tax=val(event.outputTaxReversal,'output tax reversal');
    if(amount<=0||tax>amount)throw new Error('Invalid return amount');
    debit('4191',amount-tax);debit('2160',tax);
    credit(event.refundDestination==='carrier_receivable'?'1230':'2150',amount);
    description='رد قيمة طلب مرتجع '+orderId;
  } else if(event.type==='return_stock_inspected'){
    if(evidenceType!=='quality_inspection_report')throw new Error('Return stock inspection required');
    if(!['restock','writeoff'].includes(event.stockOutcome))throw new Error('Return stock outcome required');
    const cost=val(event.originalCost,'original cost');
    if(!cost)throw new Error('Original cost is required');
    debit(event.stockOutcome==='restock'?'1300':'5130',cost);credit('5100',cost);
    description='فحص مخزون المرتجع '+orderId;
  } else if(event.type==='refund_paid'){
    if(evidenceType!=='bank_statement')throw new Error('Bank refund statement required');
    requireString(event.bankReference,'bankReference');
    const refund=val(event.amount,'refund paid');if(!refund)throw new Error('Amount required');
    debit('2150',refund);credit('1120',refund);
    description='دفع مستحق مرتجع '+orderId;
  }
  // The ledger uses an account subset; COD fee + refund payable are catalog v1 additions.
  const normalized=normalizeLines(lines);
  return {
    clientId,storeId,eventDate,currency:event.currency,sourceType:'commerce_event',
    sourceKey:event.type+':'+eventId,
    orderId,sourceDocument,evidenceType,description,
    lines:normalized.lines.map(x=>({accountCode:x.accountCode,debit:minorMoney(x.debitMinor),credit:minorMoney(x.creditMinor)})),
    debit:minorMoney(normalized.debitMinor),credit:minorMoney(normalized.creditMinor),
    status:'draft_only',autoPosted:false
  };
}
