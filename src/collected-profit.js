const text=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const r2=value=>Math.round(num(value)*100)/100;
const iso=/^\d{4}-\d{2}-\d{2}$/;
const isAdCategory=value=>/(ads?|advert|facebook|meta|google|tiktok|اعلان|إعلان|اعلانات|إعلانات)/i.test(text(value));
function cairoToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=type=>parts.find(x=>x.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`;}
function dateOr(value,fallback){const v=text(value);if(v==='beginning')return '2000-01-01';return iso.test(v)?v:fallback;}
function orderBusinessDate(row){return String(row?.date||row?.created_at||'').slice(0,10);}

export async function collectedProfitOverview(env,{clientId,storeId=null,from=null,to=null,includeDetails=false}={}){
  const end=dateOr(to,cairoToday()),start=dateOr(from,end);if(start>end)throw Object.assign(new Error('بداية الفترة يجب أن تكون قبل نهايتها'),{status:400,code:'DATE_RANGE_INVALID'});
  const orderBinds=[clientId];let orderStore='';if(storeId){orderStore=' AND o.store_id=?';orderBinds.push(storeId);}orderBinds.push(start,end);
  const ordersResult=await env.DB.prepare(`SELECT o.id,o.ref,o.store_id,o.name,o.total,o.collected_amount,o.collected_at,o.date,o.created_at,s.name store_name,COALESCE(f.rate_pct,0) management_rate_pct,COALESCE(CASE WHEN f.status='active' THEN f.amount ELSE 0 END,0) management_fee FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id LEFT JOIN order_management_fees f ON f.order_id=o.id AND f.client_id=o.client_id WHERE o.client_id=?${orderStore} AND o.state='collected' AND date(COALESCE(o.collected_at,o.date,o.created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(o.collected_at,o.date,o.created_at) DESC,o.created_at DESC`).bind(...orderBinds).all();
  const orders=ordersResult.results||[],orderDates=orders.map(orderBusinessDate).filter(date=>iso.test(date)).sort(),orderPeriodFrom=orderDates[0]||null,orderPeriodTo=orderDates.at(-1)||null;
  let transactions=[],integratedAds=0;
  if(orderPeriodFrom&&orderPeriodTo){
    const txBinds=[clientId],adsBinds=[clientId];let txStore='',adsStore='';if(storeId){txStore=' AND store_id=?';adsStore=' AND store_id=?';txBinds.push(storeId);adsBinds.push(storeId);}txBinds.push(orderPeriodFrom,orderPeriodTo);adsBinds.push(orderPeriodFrom,orderPeriodTo);
    const [txResult,adsRow]=await Promise.all([
      env.DB.prepare(`SELECT id,date,created_at,category,amount,note,method,counterparty,store_id FROM transactions WHERE client_id=?${txStore} AND type='expense' AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?) ORDER BY COALESCE(date,created_at) DESC,created_at DESC`).bind(...txBinds).all(),
      env.DB.prepare(`SELECT COALESCE(SUM(spend),0) spend FROM campaign_daily_metrics WHERE client_id=?${adsStore} AND date(metric_date) BETWEEN date(?) AND date(?)`).bind(...adsBinds).first()
    ]);transactions=txResult.results||[];integratedAds=r2(adsRow?.spend);
  }
  const storeRow=storeId?await env.DB.prepare('SELECT name,currency,management_fee_pct FROM stores WHERE id=? AND client_id=?').bind(storeId,clientId).first():{name:'كل المتاجر',currency:'EGP',management_fee_pct:null};
  const collectedGross=r2(orders.reduce((sum,row)=>sum+num(row.collected_amount??row.total),0)),managementFees=r2(orders.reduce((sum,row)=>sum+num(row.management_fee),0));
  const manualAdTransactions=transactions.filter(row=>isAdCategory(row.category)),manualAds=r2(manualAdTransactions.reduce((sum,row)=>sum+num(row.amount),0)),adSpend=integratedAds>0?integratedAds:manualAds,adSpendSource=integratedAds>0?'integrations':'manual';
  const generalTransactions=transactions.filter(row=>!isAdCategory(row.category)),generalExpenses=r2(generalTransactions.reduce((sum,row)=>sum+num(row.amount),0)),periodExpenses=r2(generalExpenses+adSpend),collectedProfit=r2(collectedGross-managementFees-periodExpenses);
  const result={ok:true,clientId,storeId,storeName:storeRow?.name||'كل المتاجر',currency:storeRow?.currency||'EGP',from:start,to:end,collectionPeriodFrom:start,collectionPeriodTo:end,orderPeriodFrom,orderPeriodTo,collectedOrders:orders.length,collectedGross,managementFees,generalExpenses,adSpend,adSpendSource,periodExpenses,collectedProfit,formula:'المبلغ المحصل فعليًا من شركة الشحن − نسبة الإدارة على الأوردرات المحصلة − المصاريف التي تم صرفها خلال مدة هذه الأوردرات'};
  if(!includeDetails)return result;
  result.orders=orders.map(row=>({id:row.id,ref:row.ref||null,storeId:row.store_id||null,storeName:row.store_name||'',customerName:row.name||'',orderDate:orderBusinessDate(row)||null,orderTotal:r2(row.total),collectedAmount:r2(row.collected_amount??row.total),collectedAt:row.collected_at||null,managementRatePct:r2(row.management_rate_pct),managementFee:r2(row.management_fee),afterManagement:r2(num(row.collected_amount??row.total)-num(row.management_fee))}));
  result.expenses={from:orderPeriodFrom,to:orderPeriodTo,general:generalExpenses,manualAds,integratedAds,adSpend,adSpendSource,total:periodExpenses,entries:transactions.map(row=>({id:row.id,date:row.date||String(row.created_at||'').slice(0,10),category:row.category||'أخرى',amount:r2(row.amount),note:row.note||'',method:row.method||'',counterparty:row.counterparty||'',counted:!isAdCategory(row.category)||adSpendSource==='manual'}))};
  return result;
}
