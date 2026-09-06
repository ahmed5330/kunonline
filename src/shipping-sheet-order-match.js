import {requirePermission} from './access-control.js';
import {listMyStores} from './store-scope.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const num=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};
const fail=(message,status=400,code='SHIPPING_SHEET_MATCH_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const VALID_TARGETS=new Set(['shipped','delivered','returned']);
const TARGET_STATES={
  shipped:new Set(['confirmed','preparing','shipped']),
  delivered:new Set(['confirmed','preparing','shipped','signed','collected']),
  returned:new Set(['confirmed','preparing','shipped','signed','returned','collected'])
};

export function normalizeShippingPhone(value){
  let digits=clean(value,80).replace(/\D/g,'');if(!digits)return '';
  if(digits.startsWith('00'))digits=digits.slice(2);
  if(/^20(1\d{9})$/.test(digits))digits=`0${digits.slice(2)}`;
  else if(/^966(5\d{8})$/.test(digits))digits=`0${digits.slice(3)}`;
  if(/^1\d{9}$/.test(digits))digits=`0${digits}`;
  if(/^5\d{8}$/.test(digits))digits=`0${digits}`;
  return digits;
}
export function normalizeShippingName(value){
  return clean(value,300).toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}
const compact=value=>clean(value,180).toUpperCase().replace(/[\s_\-./#]+/g,'');
function grams(value){const text=normalizeShippingName(value).replace(/\s/g,'');if(text.length<2)return new Set(text?[text]:[]);const out=new Set();for(let i=0;i<text.length-1;i++)out.add(text.slice(i,i+2));return out;}
export function shippingNameSimilarity(a,b){
  const left=normalizeShippingName(a),right=normalizeShippingName(b);if(!left||!right)return 0;if(left===right)return 1;
  const at=new Set(left.split(' ').filter(Boolean)),bt=new Set(right.split(' ').filter(Boolean)),intersection=[...at].filter(x=>bt.has(x)).length,union=new Set([...at,...bt]).size,tokenScore=union?intersection/union:0;
  const ag=grams(left),bg=grams(right),common=[...ag].filter(x=>bg.has(x)).length,dice=ag.size+bg.size?2*common/(ag.size+bg.size):0;return Math.max(tokenScore,dice);
}
function amountTolerance(value){const n=Math.abs(Number(value)||0);return Math.min(3,Math.max(1,n*0.0025));}
export function shippingAmountMatches(sheetAmount,order){
  const wanted=num(sheetAmount);if(wanted===null)return {provided:false,match:false,difference:null,matchedValue:null};
  const values=[num(order?.total),num(order?.collected_amount)].filter(v=>v!==null),best=values.map(value=>({value,diff:Math.abs(value-wanted)})).sort((a,b)=>a.diff-b.diff)[0];if(!best)return {provided:true,match:false,difference:null,matchedValue:null};
  return {provided:true,match:best.diff<=amountTolerance(wanted),difference:best.diff,matchedValue:best.value};
}
function dateBonus(signal,order){const a=new Date(signal?.eventDate||signal?.date||''),b=new Date(order?.date||order?.created_at||'');if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime()))return 0;const days=Math.abs(a-b)/86400000;return days<=7?4:days<=30?2:days<=60?1:0;}
export function scoreShippingOrderMatch(signal={},order={}){
  const phone=normalizeShippingPhone(signal.phone),orderPhone=normalizeShippingPhone(order.phone),phoneProvided=Boolean(phone),phoneMatch=phoneProvided&&Boolean(orderPhone)&&phone===orderPhone;
  const name=normalizeShippingName(signal.name),nameProvided=Boolean(name),nameSimilarity=nameProvided?shippingNameSimilarity(name,order.name):0;
  const amount=shippingAmountMatches(signal.amount,order),evidence=[];let score=0;
  if(phoneMatch){score+=48;evidence.push('رقم الهاتف مطابق');}else if(phoneProvided)evidence.push('رقم الهاتف مختلف');
  if(amount.match){score+=32;evidence.push(`قيمة التحصيل مطابقة${amount.difference?` بفارق ${amount.difference.toFixed(2)}`:''}`);}else if(amount.provided)evidence.push('قيمة التحصيل مختلفة');
  if(nameProvided){const namePoints=Math.round(Math.max(0,Math.min(1,nameSimilarity))*20);score+=namePoints;evidence.push(nameSimilarity>=.9?'الاسم مطابق جدًا':nameSimilarity>=.68?'الاسم متقارب':nameSimilarity>=.55?'الاسم مقبول':'الاسم مختلف');}
  score+=dateBonus(signal,order);
  const allThree=phoneProvided&&nameProvided&&amount.provided;
  const autoEligible=phoneMatch&&(
    (amount.provided&&amount.match&&(!nameProvided||nameSimilarity>=.55))||
    (!amount.provided&&nameProvided&&nameSimilarity>=.9)
  );
  const minimum=allThree?90:amount.provided?80:66;
  return {score,autoEligible:autoEligible&&score>=minimum,phoneProvided,phoneMatch,nameProvided,nameSimilarity,amountProvided:amount.provided,amountMatch:amount.match,amountDifference:amount.difference,evidence};
}
function statesFor(signal){const target=VALID_TARGETS.has(clean(signal?.target,20).toLowerCase())?clean(signal.target,20).toLowerCase():'delivered';return TARGET_STATES[target]||TARGET_STATES.delivered;}
function publicOrder(order){return {id:order.id,ref:order.ref||null,awb:order.awb||null,state:order.state||'pending',storeId:order.store_id||null,shippingCost:order.shipping_cost===null?null:Number(order.shipping_cost),inventoryBlocked:false};}
function contradiction(signal,order){const score=scoreShippingOrderMatch(signal,order),checks=[];if(score.phoneProvided)checks.push(score.phoneMatch);if(score.amountProvided)checks.push(score.amountMatch);if(score.nameProvided)checks.push(score.nameSimilarity>=.4);return {contradictory:checks.length>=2&&checks.filter(Boolean).length===0,score};}
function uniqueExact(signal,candidates,keySelector,value){const token=compact(value);if(!token)return null;const hits=candidates.filter(order=>compact(keySelector(order))===token);if(hits.length!==1)return hits.length>1?{ambiguous:true,reason:'المعرّف موجود على أكثر من أوردر'}:null;const guard=contradiction(signal,hits[0]);if(guard.contradictory)return {review:true,reason:'رقم البوليصة/الطلب مطابق لكن بيانات الهاتف والاسم/القيمة متعارضة؛ راجع الصف يدويًا',candidateOrderId:hits[0].id,score:100,evidence:guard.score.evidence};return {matched:true,order:publicOrder(hits[0]),score:100,evidence:['مطابقة مباشرة بالمعرّف']};}
export function chooseShippingOrderMatch(signal={},allCandidates=[]){
  const allowed=[...allCandidates].filter(order=>statesFor(signal).has(clean(order.state,30)));
  const awb=uniqueExact(signal,allowed,order=>order.awb,signal.awb);if(awb)return {...awb,matchedBy:awb.matched?'awb':'review'};
  const orderIdToken=compact(signal.orderId||signal.orderRef);if(orderIdToken){const hits=allowed.filter(order=>[order.id,order.ref].some(value=>compact(value)===orderIdToken));if(hits.length===1){const guard=contradiction(signal,hits[0]);if(guard.contradictory)return {review:true,matchedBy:'review',reason:'رقم الطلب مطابق لكن بيانات الهاتف والاسم/القيمة متعارضة؛ راجع الصف يدويًا',candidateOrderId:hits[0].id,score:100,evidence:guard.score.evidence};return {matched:true,matchedBy:'order',order:publicOrder(hits[0]),score:100,evidence:['مطابقة مباشرة برقم الطلب/المرجع']};}if(hits.length>1)return {ambiguous:true,matchedBy:'ambiguous',reason:'رقم الطلب/المرجع غير فريد'};}
  const scored=allowed.map(order=>({order,...scoreShippingOrderMatch(signal,order)})).filter(row=>row.phoneMatch||row.amountMatch||row.nameSimilarity>=.55).sort((a,b)=>b.score-a.score),top=scored[0],second=scored[1];
  if(!top)return {matched:false,matchedBy:'none',score:0,reason:'لم يتم العثور على أوردر يطابق رقم الهاتف والاسم وقيمة التحصيل'};
  if(!top.autoEligible)return {matched:false,review:top.score>=60,matchedBy:'review',score:top.score,candidateOrderId:top.order.id,evidence:top.evidence,reason:'وجدنا تشابهًا لكنه غير كافٍ للمطابقة التلقائية الآمنة'};
  if(second&&second.autoEligible&&top.score-second.score<8)return {matched:false,ambiguous:true,matchedBy:'ambiguous',score:top.score,evidence:top.evidence,reason:'أكثر من أوردر قريب جدًا من نفس بيانات الهاتف/الاسم/التحصيل؛ لن نختار تلقائيًا'};
  return {matched:true,matchedBy:'phone-name-amount',order:publicOrder(top.order),score:Math.min(100,top.score),evidence:top.evidence,confidence:top.score>=96?'very-high':'high'};
}
async function effectiveStore(env,{clientId,storeId,me}){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[],wanted=clean(storeId,120);
  if(wanted){const allowed=stores.some(row=>String(row.id)===wanted);if(!allowed)fail('المتجر غير مسموح لهذا المستخدم',403,'STORE_ISOLATION');return wanted;}
  if(context.allStores)return '';
  if(stores.length===1)return String(stores[0].id);
  fail('اختار متجرًا قبل مطابقة شيت شركة الشحن',400,'STORE_SELECTION_REQUIRED');
}
export async function matchShippingSheetRows(env,{clientId,storeId='',rows=[],me}={}){
  requirePermission(me,'orders','read');rows=Array.isArray(rows)?rows.slice(0,2000):[];if(!rows.length)return {ok:true,matches:[],candidateCount:0};
  const scopedStore=await effectiveStore(env,{clientId,storeId,me}),binds=[clientId],storeSql=scopedStore?' AND o.store_id=?':'';if(scopedStore)binds.push(scopedStore);
  const {results=[]}=await env.DB.prepare(`SELECT o.id,o.ref,o.awb,o.state,o.store_id,o.name,o.phone,o.total,o.collected_amount,o.shipping_cost,o.date,o.created_at FROM orders o WHERE o.client_id=?${storeSql} AND o.state IN ('confirmed','preparing','shipped','signed','collected','returned') AND NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id) ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC LIMIT 10000`).bind(...binds).all();
  const matches=rows.map((raw,index)=>{const signal={rowNo:raw?.rowNo??index+2,awb:clean(raw?.awb,160),orderId:clean(raw?.orderId||raw?.orderRef,160),phone:clean(raw?.phone,80),name:clean(raw?.name,300),amount:raw?.amount,eventDate:clean(raw?.eventDate,80),target:clean(raw?.target,20)};const result=chooseShippingOrderMatch(signal,results);return {rowNo:signal.rowNo,...result};});
  return {ok:true,storeId:scopedStore||null,candidateCount:results.length,candidatePoolCapped:results.length>=10000,matches,policy:{priority:['awb','order-id/ref','phone+name+collection-amount'],autoMatchRequiresUnique:true,ambiguousRowsBlocked:true,amountTolerance:'max 1 EGP or 0.25%, capped at 3 EGP'}};
}
