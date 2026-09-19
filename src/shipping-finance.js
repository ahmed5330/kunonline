const MODES=new Set(['customer_full','customer_partial','customer_free']);
const LABELS={customer_full:'الشحن كامل على العميل',customer_partial:'الشحن جزئي على العميل',customer_free:'الشحن مجاني للعميل'};
const C=v=>String(v??'').trim(),N=v=>Number(v)||0,R=v=>Math.round(N(v)*100)/100,F=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?R(v):null);
const validMode=v=>MODES.has(C(v));
const parseHistory=value=>{if(Array.isArray(value))return value;try{const x=JSON.parse(value||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
const get=(row,a,b)=>row?.[a]!==undefined?row[a]:row?.[b];
const settingId=(clientId,storeId)=>`${clientId}:${storeId||'*'}`;

export const shippingFinanceModes=Object.freeze({...LABELS});

export async function getShippingFinancialSettings(env,{clientId,storeId=null}){
  const sid=C(storeId),exact=await env.DB.prepare('SELECT * FROM shipping_financial_settings WHERE client_id=? AND store_id=? LIMIT 1').bind(clientId,sid).first();
  let row=exact,inherited=false;
  if(!row&&sid){row=await env.DB.prepare("SELECT * FROM shipping_financial_settings WHERE client_id=? AND store_id='' LIMIT 1").bind(clientId).first();inherited=Boolean(row);}
  if(!row)return {configured:false,inherited:false,clientId,storeId:sid||null,mode:null,modeLabel:'غير محدد',customerShippingAmount:0,businessShippingAmount:0};
  return {configured:true,inherited,clientId,storeId:sid||null,settingStoreId:row.store_id||null,mode:row.mode,modeLabel:LABELS[row.mode]||row.mode,customerShippingAmount:R(row.customer_shipping_amount),businessShippingAmount:R(row.business_shipping_amount),updatedBy:row.updated_by||null,updatedAt:row.updated_at||null};
}

export async function saveShippingFinancialSettings(env,{clientId,storeId=null,mode,customerShippingAmount=0,businessShippingAmount=0,actor='user'}){
  const sid=C(storeId),m=C(mode),customer=R(customerShippingAmount),business=R(businessShippingAmount);
  if(!validMode(m))throw Object.assign(new Error('اختار: الشحن كامل على العميل، جزئي على العميل، أو مجاني للعميل'),{status:400,code:'SHIPPING_FINANCE_MODE_INVALID'});
  if(customer<0||business<0)throw Object.assign(new Error('قيم الشحن لا يمكن أن تكون سالبة'),{status:400,code:'SHIPPING_FINANCE_AMOUNT_INVALID'});
  if(m==='customer_full'&&customer<=0)throw Object.assign(new Error('اكتب قيمة الشحن التي يدفعها العميل'),{status:400,code:'CUSTOMER_SHIPPING_AMOUNT_REQUIRED'});
  if(m==='customer_partial'&&(customer<=0||business<=0))throw Object.assign(new Error('في الشحن الجزئي اكتب جزء العميل والجزء الذي يتحمله البيزنس'),{status:400,code:'PARTIAL_SHIPPING_SPLIT_REQUIRED'});
  if(m==='customer_free'&&business<=0)throw Object.assign(new Error('اكتب تكلفة الشحن التي يتحملها البيزنس'),{status:400,code:'BUSINESS_SHIPPING_AMOUNT_REQUIRED'});
  if(sid){const store=await env.DB.prepare("SELECT id FROM stores WHERE id=? AND client_id=? AND status='active'").bind(sid,clientId).first();if(!store)throw Object.assign(new Error('المتجر غير موجود أو غير نشط'),{status:404,code:'STORE_NOT_FOUND'});}
  const normalizedCustomer=m==='customer_free'?0:customer,normalizedBusiness=m==='customer_full'?0:business,at=new Date().toISOString();
  await env.DB.prepare('INSERT INTO shipping_financial_settings(id,client_id,store_id,mode,customer_shipping_amount,business_shipping_amount,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,customer_shipping_amount=excluded.customer_shipping_amount,business_shipping_amount=excluded.business_shipping_amount,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(settingId(clientId,sid),clientId,sid,m,normalizedCustomer,normalizedBusiness,C(actor),at).run();
  return getShippingFinancialSettings(env,{clientId,storeId:sid});
}

function carrierEvent(row){return [...parseHistory(get(row,'history','history'))].reverse().find(x=>x?.type==='carrier_financials')||null;}
function configuredShippingTotal(settings={}){
  if(!settings?.configured)return 0;
  if(settings.mode==='customer_partial')return Math.max(0,R(N(settings.customerShippingAmount)+N(settings.businessShippingAmount)));
  if(settings.mode==='customer_full')return Math.max(0,R(settings.customerShippingAmount));
  if(settings.mode==='customer_free')return Math.max(0,R(settings.businessShippingAmount));
  return 0;
}
export function resolveOrderShippingFinance(row,settings={}){
  const total=Math.max(0,R(get(row,'total','total'))),unit=Math.max(0,R(get(row,'unitPrice','unit_price'))),qty=Math.max(1,N(get(row,'qty','qty'))||1),legacy=Math.max(0,R(get(row,'shippingCost','shipping_cost'))),historyCarrier=carrierEvent(row);
  let subtotal=F(get(row,'productSubtotal','product_subtotal')),customer=F(get(row,'customerShippingCharge','customer_shipping_charge')),carrier=F(get(row,'carrierShippingCost','carrier_shipping_cost')),business=F(get(row,'businessShippingCost','business_shipping_cost'));
  const source=C(get(row,'source','source')),savedMode=C(get(row,'shippingFinanceMode','shipping_finance_mode')),savedSource=C(get(row,'shippingFinanceSource','shipping_finance_source'));
  let customerObserved=customer!==null;
  if(subtotal===null&&unit>0&&unit*qty<=total+0.01)subtotal=R(unit*qty);
  if(customer===null&&subtotal!==null){customer=Math.max(0,R(total-subtotal));customerObserved=true;}
  if(customer===null&&!historyCarrier&&(/easy\s*orders/i.test(source)||(legacy>0&&!savedSource))){customer=Math.min(total,legacy);customerObserved=true;}
  if(customer===null&&settings?.configured&&['customer_full','customer_partial'].includes(settings.mode))customer=Math.min(total,R(settings.customerShippingAmount));
  if(customer===null)customer=0;
  if(subtotal===null)subtotal=Math.max(0,R(total-customer));
  if(carrier===null&&historyCarrier&&Number.isFinite(Number(historyCarrier.shippingCost)))carrier=Math.max(0,R(historyCarrier.shippingCost));
  const configuredTotal=configuredShippingTotal(settings),estimatedTotal=carrier!==null?carrier:configuredTotal;
  let mode;
  if(validMode(savedMode))mode=savedMode;
  else if(customerObserved){
    if(customer<=0)mode='customer_free';
    else if(estimatedTotal>customer+0.01)mode='customer_partial';
    else mode='customer_full';
  }else if(settings?.configured&&validMode(settings.mode))mode=settings.mode;
  else mode=customer>0?'customer_full':'customer_free';
  if(business===null){
    if(mode==='customer_full')business=0;
    else if(mode==='customer_partial')business=Math.max(0,R((estimatedTotal||N(settings?.businessShippingAmount)+customer)-customer));
    else business=Math.max(0,R(estimatedTotal||N(settings?.businessShippingAmount)||N(settings?.customerShippingAmount)));
  }
  business=Math.max(0,R(business));
  return {productSubtotal:R(subtotal),customerShippingCharge:R(customer),carrierShippingCost:carrier===null?null:R(carrier),businessShippingCost:business,shippingFinanceMode:mode,shippingFinanceModeLabel:LABELS[mode]||mode,shippingFinanceSource:savedSource||'derived',productRevenue:Math.max(0,R(total-customer)),orderTotal:total,customerPaysShipping:customer>0,shippingFreeForCustomer:customer<=0,shippingTotalCostEstimate:R(estimatedTotal)};
}

async function canonicalRows(env,clientId,ids=[]){
  const cleanIds=[...new Set(ids.map(C).filter(Boolean))];if(!cleanIds.length)return [];
  const out=[];for(let i=0;i<cleanIds.length;i+=80){const part=cleanIds.slice(i,i+80),{results=[]}=await env.DB.prepare(`SELECT id,client_id,store_id,total,unit_price,qty,shipping_cost,product_subtotal,customer_shipping_charge,carrier_shipping_cost,business_shipping_cost,shipping_finance_mode,shipping_finance_source,source,history,date,created_at,state,gov,ref,name FROM orders WHERE client_id=? AND id IN (${part.map(()=>'?').join(',')})`).bind(clientId,...part).all();out.push(...results);}return out;
}

export async function enrichShippingFinanceOrders(env,orders,{clientId}){
  if(!Array.isArray(orders)||!orders.length)return orders||[];
  const raw=await canonicalRows(env,clientId,orders.map(x=>x.id)),byId=new Map(raw.map(x=>[String(x.id),x])),settings=new Map();
  const settingFor=async storeId=>{const k=C(storeId);if(!settings.has(k))settings.set(k,await getShippingFinancialSettings(env,{clientId,storeId:k}));return settings.get(k);};
  const out=[];for(const item of orders){const row=byId.get(String(item.id))||item,s=await settingFor(get(row,'storeId','store_id')),f=resolveOrderShippingFinance(row,s);out.push({...item,...f,product_subtotal:f.productSubtotal,customer_shipping_charge:f.customerShippingCharge,carrier_shipping_cost:f.carrierShippingCost,business_shipping_cost:f.businessShippingCost,shipping_finance_mode:f.shippingFinanceMode,shipping_finance_source:f.shippingFinanceSource});}return out;
}

export async function snapshotOrderShippingFinance(env,{orderId,clientId=null,source='order',carrierShippingCost=undefined}){
  const binds=clientId?[orderId,clientId]:[orderId],row=await env.DB.prepare(`SELECT id,client_id,store_id,total,unit_price,qty,shipping_cost,product_subtotal,customer_shipping_charge,carrier_shipping_cost,business_shipping_cost,shipping_finance_mode,shipping_finance_source,source,history FROM orders WHERE id=?${clientId?' AND client_id=?':''} LIMIT 1`).bind(...binds).first();if(!row)return null;
  if(carrierShippingCost!==undefined&&carrierShippingCost!==null)row.carrier_shipping_cost=R(carrierShippingCost);
  const settings=await getShippingFinancialSettings(env,{clientId:row.client_id,storeId:row.store_id||''}),f=resolveOrderShippingFinance(row,settings),src=C(source)||'order';
  await env.DB.prepare('UPDATE orders SET product_subtotal=?,customer_shipping_charge=?,carrier_shipping_cost=?,business_shipping_cost=?,shipping_finance_mode=?,shipping_finance_source=?,shipping_cost=? WHERE id=? AND client_id=?').bind(f.productSubtotal,f.customerShippingCharge,f.carrierShippingCost,f.businessShippingCost,f.shippingFinanceMode,src,f.businessShippingCost,row.id,row.client_id).run();
  return {...f,id:row.id,clientId:row.client_id,storeId:row.store_id||null};
}

function rangeQuery(storeId){return {where:`client_id=?${storeId?' AND store_id=?':''} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`,binds:(clientId,from,to)=>storeId?[clientId,storeId,from,to]:[clientId,from,to]};}
export async function shippingRowsForRange(env,{clientId,storeId=null,from,to}){
  const q=rangeQuery(storeId),{results=[]}=await env.DB.prepare(`SELECT id,client_id,store_id,total,unit_price,qty,shipping_cost,product_subtotal,customer_shipping_charge,carrier_shipping_cost,business_shipping_cost,shipping_finance_mode,shipping_finance_source,source,history,date,created_at,state,gov,ref,name FROM orders WHERE ${q.where} ORDER BY COALESCE(date,created_at) DESC`).bind(...q.binds(clientId,from,to)).all(),settings=new Map(),out=[];
  for(const row of results){const key=C(row.store_id);if(!settings.has(key))settings.set(key,await getShippingFinancialSettings(env,{clientId,storeId:key}));out.push({...row,finance:resolveOrderShippingFinance(row,settings.get(key))});}return out;
}

export async function adjustExpenseDetailsForShipping(env,data,scope){
  if(!data||typeof data!=='object')return data;const rows=await shippingRowsForRange(env,scope),shipping=rows.filter(x=>x.finance.businessShippingCost>0).map(x=>({group:'shipping',id:C(x.id),label:`شحن أوردر ${C(x.ref||x.id)}`,description:`البيزنس يتحمل ${x.finance.businessShippingCost} ج${x.finance.customerShippingCharge?` · العميل دفع ${x.finance.customerShippingCharge} ج شحن`:''}`,date:C(x.date||x.created_at).slice(0,10),amount:x.finance.businessShippingCost})),shippingTotal=R(shipping.reduce((s,x)=>s+x.amount,0)),items=[...(data.items||[]).filter(x=>x.group!=='shipping'),...shipping],totals={...(data.totals||{}),shipping:shippingTotal};return {...data,items,totals,total:R(Object.values(totals).reduce((s,x)=>s+N(x),0)),shippingFinance:{customerCollected:R(rows.reduce((s,x)=>s+x.finance.customerShippingCharge,0)),businessExpense:shippingTotal}};
}

const excluded=new Set(['cancelled','returned']);
function bucket(date,g){const d=C(date).slice(0,10);if(g==='month')return d.slice(0,7);if(g==='week'){const x=new Date(`${d}T00:00:00Z`),day=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-day);return x.toISOString().slice(0,10);}return d;}
export async function adjustDashboardForShipping(env,data,scope){
  if(!data||typeof data!=='object')return data;const rows=await shippingRowsForRange(env,scope),eligible=rows.filter(x=>!excluded.has(C(x.state))),customerEligible=R(eligible.reduce((s,x)=>s+x.finance.customerShippingCharge,0)),legacyAll=R(rows.reduce((s,x)=>s+N(x.shipping_cost),0)),businessAll=R(rows.reduce((s,x)=>s+x.finance.businessShippingCost,0)),oldFinance=data.finance||{},oldOverview=data.overview||{},oldRevenue=R(oldFinance.revenue??oldOverview.expectedRevenue),newRevenue=Math.max(0,R(oldRevenue-customerEligible)),oldExpenses=R(oldFinance.expenses),newExpenses=Math.max(0,R(oldExpenses-legacyAll+businessAll)),productCost=R(oldFinance.productCost),gross=R(newRevenue-productCost),net=R(gross-newExpenses),margin=newRevenue?R(net/newRevenue*100):0;
  const marginDetails=[{label:'الإيراد المتوقع',value:newRevenue,money:true},{label:'تكلفة المنتج',value:productCost,money:true},{label:'كل المصروفات التشغيلية',value:newExpenses,money:true},{label:'صافي الربح',value:net,money:true},{label:'هامش الربح',value:margin,percent:true}],overview={...oldOverview,expectedRevenue:newRevenue,netProfit:net,profitMargin:margin,productRevenue:newRevenue,customerShippingCollected:customerEligible,businessShippingExpense:businessAll,orderValueWithCustomerShipping:oldRevenue,details:{...(oldOverview.details||{}),expectedRevenue:[{label:'إيراد المنتجات',value:newRevenue,money:true},{label:'شحن محصل من العميل — منفصل عن الإيراد',value:customerEligible,money:true},{label:'إجمالي تحصيل الطلبات قبل فصل الشحن',value:oldRevenue,money:true}],margin:marginDetails}};
  const finance={...oldFinance,revenue:newRevenue,expenses:newExpenses,grossProfit:gross,netProfit:net,customerShippingCollected:customerEligible,businessShippingExpense:businessAll,shipping:businessAll};
  let trend=data.trend;if(trend?.points?.length){const maps=new Map();for(const x of rows){const k=bucket(x.date||x.created_at,trend.granularity),v=maps.get(k)||{customer:0,business:0,legacy:0};if(!excluded.has(C(x.state)))v.customer+=x.finance.customerShippingCharge;v.business+=x.finance.businessShippingCost;v.legacy+=N(x.shipping_cost);maps.set(k,v);}trend={...trend,points:trend.points.map(p=>{const a=maps.get(String(p.key))||{customer:0,business:0,legacy:0},revenue=Math.max(0,R(N(p.revenue)-a.customer)),shipping=R(a.business),operating=R(N(p.adSpend)+N(p.otherExpenses)+shipping+N(p.orderOther)+N(p.adminFees)),grossProfit=R(revenue-N(p.productCost));return {...p,revenue,shipping,grossProfit,netProfit:R(grossProfit-operating),customerShippingCollected:R(a.customer)};})};}
  let provinces=data.provinces;if(Array.isArray(provinces)){const byGov=new Map();for(const x of eligible){const g=C(x.gov)||'غير محدد';byGov.set(g,R(N(byGov.get(g))+x.finance.customerShippingCharge));}provinces=provinces.map(p=>({...p,revenue:Math.max(0,R(N(p.revenue)-N(byGov.get(C(p.name)||'غير محدد'))))}));}
  const activeStates=new Set(['confirmed','preparing','shipped']),active=rows.filter(x=>activeStates.has(C(x.state))),activeCustomer=R(active.reduce((s,x)=>s+x.finance.customerShippingCharge,0)),activeLegacy=R(active.reduce((s,x)=>s+N(x.shipping_cost),0)),activeBusiness=R(active.reduce((s,x)=>s+x.finance.businessShippingCost,0)),expectedProfit=oldOverview.expectedProfit===undefined?undefined:R(N(oldOverview.expectedProfit)-activeCustomer+activeLegacy-activeBusiness);if(expectedProfit!==undefined){overview.expectedProfit=expectedProfit;overview.expectedProfitPerActiveOrder=active.length?R(expectedProfit/active.length):0;}
  return {...data,overview,finance,trend,provinces,shippingFinance:{customerCollected:customerEligible,businessExpense:businessAll,policy:'customer-shipping-separated'}};
}