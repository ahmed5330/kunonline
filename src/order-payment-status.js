/**
 * Financial evidence is independent of order fulfilment and COD collection.
 *
 * A provider's 'paid'/'refunded' event may only be asserted by the verified
 * EasyOrders ingestion path. Never derive payment proof from confirmation,
 * shipment, COD collection, payment method, or client-provided history.
 *
 * Legacy compatible: append payment events to orders.history JSON, without
 * changing a live database schema.
 */
const clean=value=>String(value??'').trim();
const normalizeDate=value=>{
  const str=clean(value);
  if(!str||!/^\d{4}-\d{2}-\d{2}[T ]/.test(str))return '';
  const parsed=Date.parse(str);
  return Number.isFinite(parsed)?new Date(parsed).toISOString():'';
};
export const verifiedProviderPaymentStatus=value=>{
  switch(clean(value).toLowerCase()){
    case 'paid': return 'paid';
    case 'refunded': return 'refunded';
    default: return 'unknown';
  }
};
export function createProviderPaymentEvent(providerStatus,{reference='',at='',source='easyorders-webhook'}={}){
  const paymentStatus=verifiedProviderPaymentStatus(providerStatus);
  if(paymentStatus==='unknown')return null;
  // Distinguish a timestamp explicitly supplied by the provider from the
  // server's arrival time. An arrival timestamp cannot prove a newer payment.
  const providerAt=normalizeDate(at);
  return {
    type:'payment_status',
    paymentStatus,
    source,
    ref:clean(reference),
    at:providerAt||new Date().toISOString(),
    providerAt,
  };
}
function parseHistory(value){
  if(Array.isArray(value))return value;
  if(typeof value==='string'){
    try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{}
  }
  return [];
}
function providerEvents(value){
  return parseHistory(value).filter(event=>
    event?.type==='payment_status'&&event?.source==='easyorders-webhook'&&
    verifiedProviderPaymentStatus(event.paymentStatus)!=='unknown'
  );
}
/** Reduce provider evidence without treating late webhook retries as new payments. */
export function paymentFromHistory(value){
  const events=providerEvents(value);
  let selected=null;
  for(const event of events){
    const state=verifiedProviderPaymentStatus(event.paymentStatus);
    const ref=clean(event.ref);
    const providerAt=normalizeDate(event.providerAt);
    if(!selected){
      selected={status:state,source:'easyorders',reference:ref,at:clean(event.at),providerAt};
      continue;
    }
    if(selected.status==='refunded'&&state==='paid'){
      // Re-paying after a refund must be evidenced by a NEW transaction ID
      // with a later explicit provider timestamp. Unknown chronology fails closed.
      if(!ref||!selected.reference||ref===selected.reference||
         !providerAt||!selected.providerAt||providerAt<=selected.providerAt)continue;
    }else if(selected.status==='paid'&&state==='refunded'){
      // A refund of an older payment may not override a newer, proven re-payment.
      if(ref&&selected.reference&&ref!==selected.reference&&
         providerAt&&selected.providerAt&&providerAt<selected.providerAt)continue;
    }else if(selected.status===state&&ref===selected.reference){
      continue;
    }else if(selected.status==='paid'&&state==='paid'&&
             providerAt&&selected.providerAt&&providerAt<selected.providerAt)continue;
    else if(selected.status==='refunded'&&state==='refunded'&&
             providerAt&&selected.providerAt&&providerAt<selected.providerAt)continue;
    selected={status:state,source:'easyorders',reference:ref,at:clean(event.at),providerAt};
  }
  if(!selected)return {status:'unknown',source:'',reference:'',at:''};
  return {status:selected.status,source:selected.source,reference:selected.reference,at:selected.at};
}
export function paymentFromOrder({history,providerStatus}={}){
  const stored=paymentFromHistory(history);
  const fresh=verifiedProviderPaymentStatus(providerStatus);
  // Provider order detail reads have no monotonic event sequence. They are
  // useful when no journal exists; never override an already verified journal
  // with an unsequenced contradictory response.
  if(fresh==='refunded')return {status:'refunded',source:'easyorders',reference:stored.reference,at:stored.at};
  return stored.status!=='unknown' ? stored :
    fresh==='unknown' ? stored : {status:fresh,source:'easyorders',reference:'',at:''};
}
/**
 * Atomic SQLite append. Replays of the same (status, transaction reference)
 * are idempotent. An old paid callback cannot reverse a refund unless a
 * different transaction and strictly newer provider timestamp are supplied.
 * Both conditions are evaluated inside one UPDATE to avoid webhook races.
 */
export async function appendProviderPaymentEvent(db,{orderId,clientId,event}){
  if(!event||event.source!=='easyorders-webhook'||!orderId||!clientId)return false;
  const state=verifiedProviderPaymentStatus(event.paymentStatus);
  if(state==='unknown')return false;
  const ref=clean(event.ref),time=normalizeDate(event.providerAt);
  const history="CASE WHEN json_valid(history) THEN CASE WHEN json_type(history)='array' THEN history ELSE '[]' END ELSE '[]' END";
  const safeEntry="CASE WHEN payment_entry.type='object' THEN payment_entry.value ELSE '{}' END";
  const condition=`SELECT 1 FROM json_each(${history}) AS payment_entry
    WHERE json_extract(${safeEntry},'$.type')='payment_status'
      AND json_extract(${safeEntry},'$.source')='easyorders-webhook'`;
  const sql=`UPDATE orders
    SET history=json_insert(${history},'$[#]',json(?))
    WHERE id=? AND client_id=?
      AND NOT EXISTS (${condition}
        AND json_extract(${safeEntry},'$.paymentStatus')=?
        AND COALESCE(json_extract(${safeEntry},'$.ref'),'')=?)
      AND NOT EXISTS (${condition}
        AND json_extract(${safeEntry},'$.paymentStatus')='refunded'
        AND ?='paid'
        AND (
          ?='' OR COALESCE(json_extract(${safeEntry},'$.ref'),'')=''
          OR COALESCE(json_extract(${safeEntry},'$.ref'),'')=?
          OR ?='' OR COALESCE(json_extract(${safeEntry},'$.providerAt'),'')=''
          OR ?<=json_extract(${safeEntry},'$.providerAt')
        ))`;
  const result=await db.prepare(sql).bind(JSON.stringify(event),orderId,clientId,state,ref,state,
    ref,ref,time,time).run();
  if(result?.success===false)throw new Error('Unable to persist verified provider payment event');
  return (result?.meta?.changes??0)>0;
}
