import {shippingRowsForRange} from './shipping-finance.js';

// Preview owns the accounting calculation. Keep its totals and correct the
// displayed shipping component to the same business-only expense basis.
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
    data.costs.shipping=Math.round(rows.reduce((sum,row)=>sum+Number(row.finance.businessShippingCost||0),0)*100)/100;
  }
  const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');headers.set('Content-Type','application/json; charset=utf-8');
  return new Response(JSON.stringify(data),{status:response.status,headers});
}
