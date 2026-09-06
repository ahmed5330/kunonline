import commerceV13 from './index-commerce-v13.js';
import {requirePermission} from './access-control.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
async function meFromBase(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV13.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const me=await r.json().catch(()=>({}));
  if(!r.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return me;
}
function targetClient(me,requested){
  if(me.role==='client'){
    if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return me.clientId;
  }
  if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}
async function supplierBalances(env,clientId,storeId){
  const {results=[]}=await env.DB.prepare(`
    SELECT s.id supplier_id,s.name supplier_name,s.phone,
      COALESCE(i.invoiced,0) invoiced,
      COALESCE(p.paid,0) paid,
      COALESCE(r.returned,0) returned
    FROM suppliers s
    LEFT JOIN (SELECT supplier_id,SUM(total) invoiced FROM supplier_invoices WHERE client_id=? AND (? IS NULL OR store_id=?) GROUP BY supplier_id) i ON i.supplier_id=s.id
    LEFT JOIN (SELECT supplier_id,SUM(amount) paid FROM supplier_payments WHERE client_id=? AND (? IS NULL OR store_id=?) GROUP BY supplier_id) p ON p.supplier_id=s.id
    LEFT JOIN (SELECT supplier_id,SUM(total) returned FROM purchase_returns WHERE client_id=? AND (? IS NULL OR store_id=?) AND status='completed' GROUP BY supplier_id) r ON r.supplier_id=s.id
    WHERE s.client_id=? AND (? IS NULL OR s.store_id=?) AND s.active=1
    ORDER BY s.name
  `).bind(clientId,storeId,storeId,clientId,storeId,storeId,clientId,storeId,storeId,clientId,storeId,storeId).all();
  return results.map(x=>{const invoiced=Number(x.invoiced||0),paid=Number(x.paid||0),returned=Number(x.returned||0);return {...x,invoiced,paid,returned,balance:Math.round((invoiced-paid-returned)*100)/100};});
}
async function fetchV14(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/procurement/supplier-balances'&&method==='GET'){
      const me=await meFromBase(request,env,ctx);requirePermission(me,'finance','read');
      const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));
      const storeId=url.searchParams.get('storeId')||request.headers.get('X-Kun-Store-Id')||null;
      return json(await supplierBalances(env,clientId,storeId));
    }
    return commerceV13.fetch(request,env,ctx);
  }catch(e){return json({error:e.message||'حدث خطأ',code:e.code||null},e.status||500);}
}
export default {fetch:fetchV14,scheduled(controller,env,ctx){return commerceV13.scheduled?.(controller,env,ctx);}};
