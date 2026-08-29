const ACTIVE_STATES=new Set(['shipped','signed','collected']);
const REVERSE_STATES=new Set(['returned','cancelled']);
const CATEGORIES=['رواتب وأجور','إيجارات ومرافق','إيجار','اشتراكات وأدوات','شحن ومرتجعات','عمولات','مصاريف بنكية','ضرائب','تسويق ومحتوى','مصاريف إدارية','مشتريات','صيانة','خدمات مهنية','أخرى'];
const METHODS=['cash','bank','card','wallet','instapay','vodafone_cash','other'];
const text=v=>String(v??'').trim();
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const iso=/^\d{4}-\d{2}-\d{2}$/;
function day(v){const x=text(v);return iso.test(x)?x:now().slice(0,10);}
function pct(a,b){return b?r2(n(a)/n(b)*100):0;}
function bucketFor(date,granularity){
  if(granularity==='month')return String(date).slice(0,7);
  if(granularity==='week'){const d=new Date(`${date}T00:00:00Z`),weekday=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-weekday);return d.toISOString().slice(0,10);}
  return String(date).slice(0,10);
}

export async function getStoreManagementFeeSettings(env,{clientId,storeId}){
  if(!clientId||!storeId)throw Object.assign(new Error('حدد المتجر أولًا'),{status:400,code:'STORE_SELECTION_REQUIRED'});
  const row=await env.DB.prepare('SELECT id,client_id,name,currency,management_fee_pct FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first();
  if(!row)throw Object.assign(new Error('المتجر غير موجود'),{status:404,code:'STORE_NOT_FOUND'});
  return {storeId:row.id,clientId:row.client_id,storeName:row.name,currency:row.currency||'EGP',managementFeePct:r2(row.management_fee_pct)};
}

export async function reconcileManagementFeeForOrder(env,orderId){
  const order=await env.DB.prepare(`SELECT o.id,o.client_id,o.store_id,o.state,o.total,o.date,o.created_at,s.management_fee_pct
    FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE o.id=?`).bind(orderId).first();
  if(!order)return {ok:false,skipped:'order_not_found'};
  if(!order.store_id)return {ok:true,skipped:'store_missing'};
  const existing=await env.DB.prepare('SELECT * FROM order_management_fees WHERE order_id=?').bind(order.id).first(),ts=now();
  if(REVERSE_STATES.has(order.state)){
    if(existing?.status==='active'){
      await env.DB.prepare("UPDATE order_management_fees SET status='reversed',reversed_at=?,updated_at=? WHERE order_id=?").bind(ts,ts,order.id).run();
      return {ok:true,status:'reversed',amount:r2(existing.amount),ratePct:r2(existing.rate_pct)};
    }
    return {ok:true,skipped:existing?'already_reversed':'never_activated'};
  }
  if(!ACTIVE_STATES.has(order.state))return {ok:true,skipped:'not_shipped_yet'};
  if(existing){
    if(existing.status==='active')return {ok:true,status:'active',amount:r2(existing.amount),ratePct:r2(existing.rate_pct),deduplicated:true};
    if(existing.status==='reversed'){
      await env.DB.prepare("UPDATE order_management_fees SET status='active',reversed_at=NULL,activated_at=COALESCE(activated_at,?),updated_at=? WHERE order_id=?").bind(ts,ts,order.id).run();
      return {ok:true,status:'active',amount:r2(existing.amount),ratePct:r2(existing.rate_pct),reactivated:true};
    }
  }
  const rate=Math.min(100,Math.max(0,n(order.management_fee_pct))),base=Math.max(0,n(order.total)),amount=r2(base*rate/100);
  await env.DB.prepare(`INSERT INTO order_management_fees (order_id,client_id,store_id,rate_pct,base_amount,amount,status,activated_at,reversed_at,updated_at)
    VALUES (?,?,?,?,?,?,'active',?,NULL,?) ON CONFLICT(order_id) DO UPDATE SET status='active',activated_at=COALESCE(order_management_fees.activated_at,excluded.activated_at),reversed_at=NULL,updated_at=excluded.updated_at`)
    .bind(order.id,order.client_id,order.store_id,rate,base,amount,ts,ts).run();
  return {ok:true,status:'active',amount,ratePct:rate,baseAmount:base};
}

export async function reconcileStoreManagementFees(env,{clientId,storeId,limit=5000}={}){
  if(!clientId||!storeId)return {ok:true,processed:0};
  const {results=[]}=await env.DB.prepare(`SELECT id FROM orders WHERE client_id=? AND store_id=? AND state IN ('shipped','signed','collected','returned','cancelled') ORDER BY COALESCE(date,created_at) DESC LIMIT ?`).bind(clientId,storeId,Math.min(10000,Math.max(1,Number(limit)||5000))).all();
  const out={ok:true,processed:0,active:0,reversed:0};
  for(const row of results){const r=await reconcileManagementFeeForOrder(env,row.id);out.processed++;if(r.status==='active')out.active++;if(r.status==='reversed')out.reversed++;}
  return out;
}

export async function updateStoreManagementFeeSettings(env,{clientId,storeId,managementFeePct,actor=null}){
  const rate=Number(managementFeePct);
  if(!Number.isFinite(rate)||rate<0||rate>100)throw Object.assign(new Error('نسبة الإدارة لازم تكون من 0 إلى 100'),{status:400,code:'MANAGEMENT_FEE_RATE_INVALID'});
  const before=await getStoreManagementFeeSettings(env,{clientId,storeId}),ts=now();
  await env.DB.prepare('UPDATE stores SET management_fee_pct=?,updated_at=? WHERE id=? AND client_id=?').bind(r2(rate),ts,storeId,clientId).run();
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId,actor?.uid||actor?.id||null,actor?.email||actor?.role||'admin','store.management_fee.update','store',storeId,JSON.stringify({managementFeePct:before.managementFeePct}),JSON.stringify({managementFeePct:r2(rate)}),JSON.stringify({rule:'activate_on_shipped_reverse_on_return_or_cancel'}),ts).run();}catch{}
  const reconciliation=await reconcileStoreManagementFees(env,{clientId,storeId});
  return {ok:true,...await getStoreManagementFeeSettings(env,{clientId,storeId}),reconciliation};
}

function rangeSql(storeId,from,to,alias=''){
  const p=alias?`${alias}.`:'';
  return {clause:`${storeId?` AND ${p}store_id=?`:''} AND date(COALESCE(${p}date,${p}created_at)) BETWEEN date(?) AND date(?)`,binds:storeId?[storeId,from,to]:[from,to]};
}

export async function accountingOverview(env,{clientId,storeId=null,from=null,to=null}){
  const end=day(to),start=day(from||end),storeWhere=storeId?' AND store_id=?':'',base=storeId?[clientId,storeId,start,end]:[clientId,start,end];
  const [tx,fees,orders,store]=await Promise.all([
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) manual_income,COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) manual_expenses,COUNT(*) entries FROM transactions WHERE client_id=?${storeWhere} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`).bind(...base).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN f.status='active' THEN f.amount ELSE 0 END),0) active_amount,COALESCE(SUM(CASE WHEN f.status='reversed' THEN f.amount ELSE 0 END),0) reversed_amount,SUM(CASE WHEN f.status='active' THEN 1 ELSE 0 END) active_orders,SUM(CASE WHEN f.status='reversed' THEN 1 ELSE 0 END) reversed_orders FROM order_management_fees f JOIN orders o ON o.id=f.order_id AND o.client_id=f.client_id WHERE f.client_id=?${storeId?' AND f.store_id=?':''} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...base).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN state='collected' THEN total ELSE 0 END),0) collected_revenue,COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue,COUNT(CASE WHEN state IN ('shipped','signed','collected') THEN 1 END) shipped_orders FROM orders WHERE client_id=?${storeWhere} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`).bind(...base).first(),
    storeId?env.DB.prepare('SELECT name,currency,management_fee_pct FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first():Promise.resolve({name:'كل المتاجر',currency:'EGP',management_fee_pct:null})
  ]);
  const managementFees=r2(fees?.active_amount),manualExpenses=r2(tx?.manual_expenses),manualIncome=r2(tx?.manual_income),totalExpenses=r2(manualExpenses+managementFees),collectedRevenue=r2(orders?.collected_revenue),netCash=r2(collectedRevenue+manualIncome-totalExpenses);
  return {ok:true,clientId,storeId,from:start,to:end,currency:store?.currency||'EGP',storeName:store?.name||'كل المتاجر',managementFeePct:storeId?r2(store?.management_fee_pct):null,collectedRevenue,deliveredRevenue:r2(orders?.delivered_revenue),manualIncome,manualExpenses,managementFees,totalExpenses,netCash,entries:Number(tx?.entries)||0,shippedOrders:Number(orders?.shipped_orders)||0,managementActiveOrders:Number(fees?.active_orders)||0,managementReversedOrders:Number(fees?.reversed_orders)||0,reversedManagementAmount:r2(fees?.reversed_amount)};
}

export async function listAccountingEntries(env,{clientId,storeId=null,from=null,to=null,limit=300}){
  const end=day(to),start=day(from||end),binds=[clientId];let where='client_id=?';if(storeId){where+=' AND store_id=?';binds.push(storeId);}where+=' AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)';binds.push(start,end,Math.min(1000,Math.max(1,Number(limit)||300)));
  const {results=[]}=await env.DB.prepare(`SELECT id,type,date,category,amount,currency,method,client_id clientId,store_id storeId,note,created_by createdBy,created_at createdAt,document_no documentNo,counterparty,tax_amount taxAmount,due_date dueDate,reference_type referenceType,reference_id referenceId,attachment_url attachmentUrl,metadata_json metadataJson FROM transactions WHERE ${where} ORDER BY date DESC,created_at DESC LIMIT ?`).bind(...binds).all();
  return results.map(x=>({...x,taxAmount:r2(x.taxAmount),metadata:(()=>{try{return JSON.parse(x.metadataJson||'{}')}catch{return {}}})()}));
}

export async function listManagementFeeEntries(env,{clientId,storeId=null,from=null,to=null,limit=500}){
  const end=day(to),start=day(from||end),binds=[clientId];let where='f.client_id=?';if(storeId){where+=' AND f.store_id=?';binds.push(storeId);}where+=' AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)';binds.push(start,end,Math.min(1000,Math.max(1,Number(limit)||500)));
  const {results=[]}=await env.DB.prepare(`SELECT f.order_id orderId,f.store_id storeId,f.rate_pct ratePct,f.base_amount baseAmount,f.amount,f.status,f.activated_at activatedAt,f.reversed_at reversedAt,f.updated_at updatedAt,o.date,o.state,o.name customerName,o.ref,o.total FROM order_management_fees f JOIN orders o ON o.id=f.order_id AND o.client_id=f.client_id WHERE ${where} ORDER BY COALESCE(o.date,o.created_at) DESC LIMIT ?`).bind(...binds).all();
  return results.map(x=>({...x,ratePct:r2(x.ratePct),baseAmount:r2(x.baseAmount),amount:r2(x.amount),total:r2(x.total)}));
}

export async function createAccountingEntry(env,{clientId,storeId,body,actor}){
  if(!storeId)throw Object.assign(new Error('اختار متجر/فرع قبل تسجيل حركة محاسبية'),{status:400,code:'STORE_SELECTION_REQUIRED'});
  const type=text(body.type);if(!['expense','income'].includes(type))throw Object.assign(new Error('نوع الحركة لازم يكون مصروف أو إيراد'),{status:400,code:'ACCOUNTING_TYPE_INVALID'});
  const amount=r2(body.amount);if(amount<=0)throw Object.assign(new Error('المبلغ لازم يكون أكبر من صفر'),{status:400,code:'ACCOUNTING_AMOUNT_INVALID'});
  const category=text(body.category)||'أخرى',method=text(body.method)||'cash',entryId=rid('TX'),ts=now();
  const store=await env.DB.prepare('SELECT currency FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first();if(!store)throw Object.assign(new Error('المتجر غير موجود'),{status:404,code:'STORE_NOT_FOUND'});
  const metadata=body.metadata&&typeof body.metadata==='object'&&!Array.isArray(body.metadata)?body.metadata:{};
  await env.DB.prepare(`INSERT INTO transactions (id,type,date,category,amount,currency,method,client_id,store_id,note,created_by,created_at,document_no,counterparty,tax_amount,due_date,reference_type,reference_id,attachment_url,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(entryId,type,day(body.date),category,amount,text(body.currency)||store.currency||'EGP',method,clientId,storeId,text(body.note),actor?.email||actor?.name||actor?.role||'user',ts,text(body.documentNo)||null,text(body.counterparty)||null,r2(body.taxAmount),iso.test(text(body.dueDate))?text(body.dueDate):null,text(body.referenceType)||null,text(body.referenceId)||null,text(body.attachmentUrl)||null,JSON.stringify(metadata)).run();
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId,actor?.uid||actor?.id||null,actor?.email||actor?.role||'user','accounting.entry.create','transaction',entryId,JSON.stringify({type,category,amount}),ts).run();}catch{}
  return {ok:true,id:entryId};
}

export async function deleteAccountingEntry(env,{clientId,storeId,id,actor}){
  const row=await env.DB.prepare('SELECT id FROM transactions WHERE id=? AND client_id=? AND store_id IS ?').bind(id,clientId,storeId).first();if(!row)throw Object.assign(new Error('الحركة غير موجودة'),{status:404,code:'ACCOUNTING_ENTRY_NOT_FOUND'});
  await env.DB.prepare('DELETE FROM transactions WHERE id=? AND client_id=? AND store_id IS ?').bind(id,clientId,storeId).run();
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),clientId,storeId,actor?.uid||actor?.id||null,actor?.email||actor?.role||'user','accounting.entry.delete','transaction',id,'{}',now()).run();}catch{}
  return {ok:true,id};
}

async function activeFeesForRange(env,{clientId,storeId=null,from,to}){
  const binds=[clientId];let where="f.client_id=? AND f.status='active'";if(storeId){where+=' AND f.store_id=?';binds.push(storeId);}where+=' AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)';binds.push(from,to);
  const {results=[]}=await env.DB.prepare(`SELECT f.order_id,f.amount,f.rate_pct,o.date,o.created_at,o.state FROM order_management_fees f JOIN orders o ON o.id=f.order_id AND o.client_id=f.client_id WHERE ${where}`).bind(...binds).all();return results;
}

export async function decorateDashboardWithManagementFees(env,snapshot,{clientId,storeId=null}){
  if(!snapshot?.ok)return snapshot;const rows=await activeFeesForRange(env,{clientId,storeId,from:snapshot.from,to:snapshot.to}),total=r2(rows.reduce((s,x)=>s+n(x.amount),0)),shippedActive=r2(rows.filter(x=>x.state==='shipped').reduce((s,x)=>s+n(x.amount),0));
  snapshot.accounting={...(snapshot.accounting||{}),managementFees:total,managementFeeOrders:rows.length};
  if(snapshot.finance){const platform=n(snapshot.finance.expenseBreakdown?.admin),expenses=r2(n(snapshot.finance.expenses)+total),net=r2(n(snapshot.finance.netProfit)-total);snapshot.finance.expenses=expenses;snapshot.finance.netProfit=net;snapshot.finance.expenseBreakdown={...(snapshot.finance.expenseBreakdown||{}),platformFees:r2(platform),managementFees:total,admin:r2(platform+total)};}
  if(snapshot.overview){snapshot.overview.netProfit=r2(n(snapshot.overview.netProfit)-total);snapshot.overview.profitMargin=pct(snapshot.overview.netProfit,snapshot.overview.expectedRevenue);snapshot.overview.expectedProfit=r2(n(snapshot.overview.expectedProfit)-shippedActive);snapshot.overview.expectedProfitPerActiveOrder=snapshot.overview.activeOrders?r2(snapshot.overview.expectedProfit/snapshot.overview.activeOrders):0;const details=snapshot.overview.details||{};if(Array.isArray(details.expectedProfit)){const row=details.expectedProfit.find(x=>x.label==='مصاريف الإدارة');if(row)row.value=r2(n(row.value)+shippedActive);else details.expectedProfit.push({label:'نسبة الإدارة على الطلبات المشحونة',value:shippedActive,money:true});const profit=details.expectedProfit.find(x=>x.label==='الربح التشغيلي المتوقع');if(profit)profit.value=snapshot.overview.expectedProfit;}if(Array.isArray(details.margin)){const exp=details.margin.find(x=>x.label==='كل المصروفات التشغيلية');if(exp)exp.value=snapshot.finance?.expenses??r2(n(exp.value)+total);const net=details.margin.find(x=>x.label==='صافي الربح');if(net)net.value=snapshot.overview.netProfit;const margin=details.margin.find(x=>x.label==='هامش الربح');if(margin)margin.value=snapshot.overview.profitMargin;}}
  if(snapshot.trend?.points?.length){const byBucket=new Map();for(const row of rows){const key=bucketFor(String(row.date||row.created_at||snapshot.from).slice(0,10),snapshot.trend.granularity);byBucket.set(key,r2(n(byBucket.get(key))+n(row.amount)));}for(const point of snapshot.trend.points){const fee=n(byBucket.get(point.key));if(!fee)continue;point.managementFees=r2(fee);point.adminFees=r2(n(point.adminFees)+fee);point.netProfit=r2(n(point.netProfit)-fee);}}
  return snapshot;
}

export async function decorateProfitIntelligence(env,data,{clientId,storeId=null,from,to}){
  if(!data?.summary)return data;const end=day(to),start=day(from||end),rows=await activeFeesForRange(env,{clientId,storeId,from:start,to:end}),managementFees=r2(rows.reduce((s,x)=>s+n(x.amount),0));data.summary.managementFees=managementFees;data.summary.operatingExpenses=r2(n(data.summary.operatingExpenses)+managementFees);data.summary.netProfit=r2(n(data.summary.netProfit)-managementFees);data.summary.marginPct=pct(data.summary.netProfit,data.summary.netRevenue);return data;
}

export function accountingCatalog(){return {categories:CATEGORIES,methods:METHODS,managementRule:{activateStates:[...ACTIVE_STATES],reverseStates:[...REVERSE_STATES],base:'order_total'}};}
