import {shippingRowsForRange} from './shipping-finance.js';

// Preview owns the accounting calculation. Keep its totals and correct the
// displayed shipping component to the same business-only expense basis.
// Keep the P&L equation balanced when the production shipping presentation
// differs from the upstream dashboard basis. Correcting just the shipping row
// made the sum of costs disagree with the visible net profit.
export function reconcileMonthlyShippingTotals(data,correctShipping){
  if(!data?.costs||!data?.profit)return data;
  const round=value=>Math.round((Number(value)||0)*100)/100;
  const previous=round(data.costs.shipping),next=round(correctShipping),delta=round(next-previous);
  data.costs.shipping=next;
  if(!delta)return data;
  data.costs.operatingExpenses=round(data.costs.operatingExpenses+delta);
  data.profit.operatingNetProfit=round(data.profit.operatingNetProfit-delta);
  data.profit.accountingNetProfit=round(data.profit.accountingNetProfit-delta);
  const sales=round(data.sales?.revenue);
  data.profit.marginPct=sales?round(data.profit.accountingNetProfit/sales*100):0;
  return data;
}

export async function reconcileFinancePresentation(request,response,env){
  const path=new URL(request.url).pathname;
  if(request.method!=='GET'||!response?.ok||!['/api/dashboard','/api/accounting/monthly'].includes(path))return response;
  const data=await response.clone().json().catch(()=>null);
  if(!data)return response;
  if(path==='/api/dashboard'){
    if(data.finance?.businessShippingExpense===undefined)return response;
    data.finance.expenseBreakdown={...(data.finance.expenseBreakdown||{}),shipping:data.finance.businessShippingExpense};
  }else{
    // Use the scope returned by the authorized upstream response, never a
    // caller-supplied tenant or store. This is a read-only presentation repair.
    if(!data.ok||!data.clientId||!data.period?.from||!data.period?.to||!data.costs)return response;
    const rows=await shippingRowsForRange(env,{clientId:data.clientId,storeId:data.storeId||null,from:data.period.from,to:data.period.to});
    reconcileMonthlyShippingTotals(data,rows.reduce((sum,row)=>sum+Number(row.finance.businessShippingCost||0),0));
  }
  const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(JSON.stringify(data),{status:response.status,headers});
}
