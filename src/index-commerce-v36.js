import commerceV35,{SyncEntrypoint as SyncEntrypointV35} from './index-commerce-v35.js';
import {recordCarrierFinancials} from './carrier-financials.js';

const BUILD='preview-v36-2026-09-01-jnt-sheet-financials';
const clean=value=>String(value??'').trim();
const num=value=>Number(value)||0;
const parseArr=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});

async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV35.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)return null;
  return me;
}
function resolvedClient(me,request,body={}){
  const requested=clean(body.clientId||body.client_id||new URL(request.url).searchParams.get('clientId'));
  if(me?.clientId){if(requested&&requested!==clean(me.clientId))return null;return clean(me.clientId);}
  return requested||null;
}
async function explicitInventoryLinks(env,{clientId,orderId,productId}){
  const row=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN product_id IS NOT NULL AND trim(product_id)<>'' THEN 1 ELSE 0 END) linked FROM order_items WHERE order_id=? AND client_id=? AND qty>0").bind(orderId,clientId).first().catch(()=>({total:0,linked:0}));
  return num(row?.total)>0?num(row?.linked)===num(row?.total):Boolean(clean(productId));
}
async function restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId}){
  const fresh=await env.DB.prepare('SELECT state,restocked FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(fresh?.state==='returned'&&Number(fresh?.restocked)!==1)await env.DB.prepare('UPDATE orders SET restocked=1 WHERE id=? AND client_id=?').bind(orderId,clientId).run().catch(()=>{});
}

async function guardedReturnedReconfirmation(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({}));
  if(clean(body.state)!=='confirmed')return commerceV35.fetch(request,env,ctx);
  const me=await currentUser(request,env,ctx);if(!me)return commerceV35.fetch(request,env,ctx);
  const clientId=resolvedClient(me,request,body);if(!clientId)return commerceV35.fetch(request,env,ctx);
  const orderId=decodeURIComponent(match[1]),row=await env.DB.prepare('SELECT id,state,restocked,product_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(!row||row.state!=='returned'||Number(row.restocked)!==1)return commerceV35.fetch(request,env,ctx);
  if(!await explicitInventoryLinks(env,{clientId,orderId,productId:row.product_id}))return commerceV35.fetch(request,env,ctx);

  // The FIFO confirmation path will deduct current inventory itself. Temporarily clear
  // the legacy return marker so the old order PATCH does not deduct the same quantity
  // a second time while leaving the returned state. If confirmation fails, restore it.
  await env.DB.prepare("UPDATE orders SET restocked=0 WHERE id=? AND client_id=? AND state='returned' AND restocked=1").bind(orderId,clientId).run();
  let response;
  try{response=await commerceV35.fetch(request,env,ctx);}catch(error){await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});throw error;}
  if(!response.ok)await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});
  else{
    const fresh=await env.DB.prepare('SELECT state FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
    if(fresh?.state==='returned')await restoreLegacyReturnFlagIfStillReturned(env,{clientId,orderId});
  }
  return response;
}

async function customerServiceShippingFallback(request,env,ctx,match,response,body){
  if(response.status!==403||clean(body.state)!=='shipped')return response;
  const denied=await response.clone().json().catch(()=>({}));
  if(!clean(denied?.error).includes('الحالة دي برّه الصلاحية المتاحة ليك'))return response;

  const me=await currentUser(request,env,ctx);if(me?.role!=='client')return response;
  const clientId=resolvedClient(me,request,body);if(!clientId)return response;
  const orderId=decodeURIComponent(match[1]),row=await env.DB.prepare('SELECT id,state,store_id,history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(!row||!['confirmed','preparing','shipped'].includes(clean(row.state)))return response;

  // The Customer Service route has already enforced store assignment/write access before
  // reaching the legacy order permission gate. Keep the selected-store boundary explicit too.
  const url=new URL(request.url),requestedStore=clean(body.storeId||body.store_id||url.searchParams.get('storeId'));
  if(requestedStore&&requestedStore!==clean(row.store_id))return response;

  const stateRow=await env.DB.prepare('SELECT json FROM state WHERE id=1').first().catch(()=>null);let tenant=null;
  try{tenant=(JSON.parse(stateRow?.json||'{}').clients||[]).find(item=>clean(item?.id)===clientId)||null;}catch{}
  if(!tenant?.customerServiceEnabled)return response;

  if(row.state==='shipped')return json({ok:true,state:'shipped',history:parseArr(row.history),customerServiceShippingHandoff:true},200);
  const history=parseArr(row.history),at=new Date().toISOString();
  history.push({type:'state',state:'shipped',at,by:me?.email||me?.name||me?.role||'client',byName:me?.name||me?.email||me?.role||'client',byUserId:me?.uid||me?.id||null,note:'تم التسليم إلى مرحلة جاري الشحن من خدمة العملاء'});
  await env.DB.prepare("UPDATE orders SET state='shipped',checkpoint='جاري الشحن',history=? WHERE id=? AND client_id=? AND state IN ('confirmed','preparing')").bind(JSON.stringify(history),orderId,clientId).run();
  const fresh=await env.DB.prepare('SELECT state FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first().catch(()=>null);
  if(fresh?.state!=='shipped')return response;
  return json({ok:true,state:'shipped',history,customerServiceShippingHandoff:true,inventoryChanged:false},200);
}

async function customerServiceStateTransition(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({}));
  if(clean(body.state)==='confirmed')return guardedReturnedReconfirmation(request,env,ctx,match);
  const response=await commerceV35.fetch(request,env,ctx);
  return customerServiceShippingFallback(request,env,ctx,match,response,body);
}

async function carrierFinancialsRoute(request,env,ctx,match){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx);
  if(!me)return json({error:'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
  const clientId=resolvedClient(me,request,body);
  if(!clientId)return json({error:'مش مسموح الوصول لبيانات متجر آخر',code:'TENANT_ISOLATION'},403);
  const orderId=decodeURIComponent(match[1]);
  return json(await recordCarrierFinancials(env,{clientId,orderId,me,body}));
}

async function fetchV36(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v36.js'});
    const financialMatch=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/carrier-financials$/);
    if(financialMatch&&method==='PATCH')return carrierFinancialsRoute(request,env,ctx,financialMatch);
    const stateMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/state$/);
    if(stateMatch&&method==='PATCH')return customerServiceStateTransition(request,env,ctx,stateMatch);
    return commerceV35.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V36_ERROR',path,method},error?.status||500);}
}

export class SyncEntrypoint extends SyncEntrypointV35{
  async health(){const base=await super.health();return {...base,entrypoint:'index-commerce-v36.js',returnReconfirmStockGuard:true,customerServiceShippingHandoff:true,carrierFinancials:true};}
}

export default {fetch:fetchV36,scheduled(controller,env,ctx){return commerceV35.scheduled?.(controller,env,ctx);}};
