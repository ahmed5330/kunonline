import commerceV24 from './index-commerce-v24.js';

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

const EMPTY_ARRAY_ROUTES=new Set([
  '/api/transactions','/api/audit-log','/api/approvals','/api/ai-actions','/api/execution-jobs','/api/notifications',
  '/api/store-connections','/api/support-tickets','/api/team-members','/api/store-access','/api/stores',
  '/api/inbox/conversations','/api/campaigns','/api/procurement/invoices','/api/procurement/payments',
  '/api/procurement/returns','/api/procurement/supplier-balances','/api/cod-reconciliation','/api/cod-reconciliation/candidates',
  '/api/products/stock-log'
]);

function fallback(path){
  if(EMPTY_ARRAY_ROUTES.has(path))return [];
  if(path==='/api/campaigns/summary')return {spend:0,revenue:0,impressions:0,clicks:0,conversions:0,orders_count:0,roas:0,ctr:0};
  if(path==='/api/finance')return {month:{revenue:0,profit:0,adSpend:0,profitMarginPct:0}};
  if(path==='/api/profit-intelligence')return {summary:{netRevenue:0,cogs:0,shipping:0,contribution:0,operatingExpenses:0,netProfit:0,marginPct:0},breakdown:[]};
  if(path==='/api/system-status')return {ok:true,environment:'preview',database:'reachable',queue:{queued:0,failed:0,deadLetter:0},pendingApprovals:0,unreadNotifications:0,integrations:[]};
  if(path==='/api/tenant/overview')return {tenant:{plan:'trial',status:'active'},subscription:null,usage30d:{}};
  if(path==='/api/onboarding/status')return {checks:[],completed:0,total:0,percent:0,ready:false};
  return null;
}

async function fetchV25(request,env,ctx){
  const u=new URL(request.url),method=request.method.toUpperCase();
  const response=await commerceV24.fetch(request,env,ctx);
  if(env.APP_ENV!=='preview'||method!=='GET'||response.status!==404)return response;
  const body=await response.clone().json().catch(()=>null);
  if(body?.error!=='مسار غير معروف')return response;
  const safe=fallback(u.pathname);
  if(safe!==null)return json(safe,200);
  return json({error:`مسار غير معروف: ${u.pathname}`,code:'UNKNOWN_ROUTE',path:u.pathname},404);
}

export default {fetch:fetchV25,scheduled(controller,env,ctx){return commerceV24.scheduled?.(controller,env,ctx);}};
