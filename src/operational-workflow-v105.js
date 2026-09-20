import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores,resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const rid=prefix=>`${prefix}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const CLAIMABLE_STATES=new Set(['pending','no_answer','confirmed','preparing','deferred']);

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
function actorId(me){return clean(me?.uid||me?.id||me?.email||`${me?.role||'user'}:${me?.clientId||''}`,200);}
function actorName(me){return clean(me?.name||me?.email||me?.role||'مستخدم',200);}
function requestedClient(me,url,body={}){return resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null);}
async function accessContext(env,me,clientId){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[];
  if(!context.allStores&&!stores.length)throw Object.assign(new Error('لا توجد متاجر مخصصة لهذا المستخدم'),{status:403,code:'STORE_ACCESS_REQUIRED'});
  return {allStores:Boolean(context.allStores),stores,ids:stores.map(row=>String(row.id))};
}
async function orderForAccess(env,me,clientId,orderId,{write=false}={}){
  const row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  const access=await accessContext(env,me,clientId);
  if(!access.allStores&&!access.ids.includes(String(row.store_id||'')))throw Object.assign(new Error('الأوردر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
  if(write&&!access.allStores){const store=access.stores.find(item=>String(item.id)===String(row.store_id||''));if(!store||store.role==='viewer')throw Object.assign(new Error('صلاحية هذا المتجر للعرض فقط'),{status:403,code:'STORE_READ_ONLY'});}
  return row;
}
async function clearClaim(env,clientId,orderId){
  await env.DB.prepare('UPDATE orders SET contact_claim_user_id=NULL,contact_claim_name=NULL,contact_claimed_at=NULL WHERE id=? AND client_id=?').bind(orderId,clientId).run();
}
async function recordClaimEvent(env,row,me,claimAt){
  try{await env.DB.prepare(`INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('OEV'),row.client_id,row.store_id||null,row.id,'contact_claimed',me?.uid||me?.id||null,me?.email||me?.role||null,'customer-service',JSON.stringify({claimedBy:actorName(me),claimedByUserId:actorId(me)}),claimAt).run();}catch{}
  try{await env.DB.prepare(`INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('AUD'),row.client_id,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.role||null,'order.contact_claim','order',row.id,JSON.stringify({claimedBy:actorName(me)}),claimAt).run();}catch{}
}
async function claimContact(env,{me,clientId,orderId}){
  requirePermission(me,'orders','update');
  const row=await orderForAccess(env,me,clientId,orderId,{write:true});
  if(!CLAIMABLE_STATES.has(String(row.state||'')))throw Object.assign(new Error('الأوردر لم يعد متاحًا لقسم خدمة العملاء'),{status:409,code:'ORDER_NOT_CLAIMABLE'});
  const mine=actorId(me),name=actorName(me),existing=clean(row.contact_claim_user_id,200);
  if(existing&&existing!==mine)throw Object.assign(new Error(`الأوردر جاري التواصل عليه بالفعل بواسطة ${row.contact_claim_name||'عضو آخر من الفريق'}`),{status:409,code:'ORDER_CONTACT_ALREADY_CLAIMED',claim:{userId:existing,name:row.contact_claim_name||'',claimedAt:row.contact_claimed_at||null}});
  const at=existing?row.contact_claimed_at||now():now();
  const result=await env.DB.prepare(`UPDATE orders SET contact_claim_user_id=?,contact_claim_name=?,contact_claimed_at=? WHERE id=? AND client_id=? AND (contact_claim_user_id IS NULL OR contact_claim_user_id='' OR contact_claim_user_id=?)`).bind(mine,name,at,orderId,clientId,mine).run();
  if(Number(result?.meta?.changes||0)===0){
    const latest=await env.DB.prepare('SELECT contact_claim_user_id,contact_claim_name,contact_claimed_at FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
    throw Object.assign(new Error(`الأوردر أخذه ${latest?.contact_claim_name||'عضو آخر من الفريق'} للتواصل قبلك`),{status:409,code:'ORDER_CONTACT_ALREADY_CLAIMED',claim:{userId:latest?.contact_claim_user_id||'',name:latest?.contact_claim_name||'',claimedAt:latest?.contact_claimed_at||null}});
  }
  if(!existing)await recordClaimEvent(env,row,me,at);
  return {ok:true,orderId,state:row.state,claim:{userId:mine,name,claimedAt:at,mine:true}};
}
async function claimsBoard(env,{me,clientId,selectedStoreId=''}){
  requirePermission(me,'orders','read');
  const access=await accessContext(env,me,clientId),selected=clean(selectedStoreId,150),binds=[clientId,...CLAIMABLE_STATES];
  if(selected&&!access.allStores&&!access.ids.includes(selected))throw Object.assign(new Error('المتجر غير مسموح لهذا المستخدم'),{status:403,code:'STORE_ISOLATION'});
  if(selected&&access.allStores&&!access.ids.includes(selected))throw Object.assign(new Error('المتجر غير موجود أو غير نشط'),{status:404,code:'STORE_NOT_FOUND'});
  let where=`client_id=? AND state IN (${[...CLAIMABLE_STATES].map(()=>'?').join(',')})`;
  if(selected){where+=' AND store_id=?';binds.push(selected);}else if(!access.allStores){where+=` AND store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT id,store_id,state,contact_claim_user_id,contact_claim_name,contact_claimed_at FROM orders WHERE ${where} ORDER BY COALESCE(contact_claimed_at,created_at,date) DESC`).bind(...binds).all();
  const mine=actorId(me);
  return {ok:true,serverTime:now(),orders:results.map(row=>({orderId:row.id,storeId:row.store_id||null,state:row.state,claim:row.contact_claim_user_id?{userId:row.contact_claim_user_id,name:row.contact_claim_name||'',claimedAt:row.contact_claimed_at||null,mine:String(row.contact_claim_user_id)===mine}:null}))};
}
function normalizePhone(raw){let d=String(raw||'').replace(/[^\d]/g,'');if(d.startsWith('0020'))d='0'+d.slice(4);else if(d.startsWith('20')&&d.length===12)d='0'+d.slice(2);else if(d.startsWith('00966'))d='0'+d.slice(5);else if(d.startsWith('966')&&d.length===12)d='0'+d.slice(3);return (/^01\d{9}$/.test(d)||/^05\d{8}$/.test(d))?d:'';}
async function mobileCallerLookup(env,{me,clientId,phone}){
  requirePermission(me,'customers','read');
  const normalized=normalizePhone(phone);if(!normalized)throw Object.assign(new Error('رقم الهاتف غير صحيح'),{status:400,code:'PHONE_INVALID'});
  const access=await accessContext(env,me,clientId),binds=[clientId,normalized];let scope='';
  if(!access.allStores){scope=` AND o.store_id IN (${access.ids.map(()=>'?').join(',')})`;binds.push(...access.ids);}
  const order=await env.DB.prepare(`SELECT o.id,o.store_id,o.customer_id,o.name,o.phone,o.gov,o.address,o.date,o.created_at,o.total,o.state FROM orders o WHERE o.client_id=? AND o.phone=?${scope} ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC LIMIT 1`).bind(...binds).first();
  const customerBinds=[clientId,normalized];let customerScope='';if(!access.allStores){customerScope=` AND c.store_id IN (${access.ids.map(()=>'?').join(',')})`;customerBinds.push(...access.ids);}
  const customer=await env.DB.prepare(`SELECT c.* FROM customers c WHERE c.client_id=? AND c.phone=?${customerScope} ORDER BY c.created_at DESC LIMIT 1`).bind(...customerBinds).first();
  if(!order&&!customer)return {ok:true,found:false,phone:normalized};
  const statBinds=[clientId,normalized];let statScope='';if(!access.allStores){statScope=` AND store_id IN (${access.ids.map(()=>'?').join(',')})`;statBinds.push(...access.ids);}
  const stats=await env.DB.prepare(`SELECT COUNT(*) total_orders,COALESCE(SUM(CASE WHEN state NOT IN ('cancelled','returned') THEN total ELSE 0 END),0) total_spent,MAX(COALESCE(date,created_at)) last_order_date FROM orders WHERE client_id=? AND phone=?${statScope}`).bind(...statBinds).first();
  return {ok:true,found:true,name:clean(order?.name||customer?.name),phone:clean(order?.phone||customer?.phone||normalized),gov:clean(order?.gov||customer?.gov),address:clean(order?.address||customer?.address),totalOrders:Number(stats?.total_orders||0),totalSpent:Number(stats?.total_spent||0),lastOrderDate:stats?.last_order_date||'',customerId:customer?.id||order?.customer_id||'',orderId:order?.id||'',storeId:order?.store_id||customer?.store_id||''};
}
async function createManualJntOrder({request,env,ctx,delegate,me,url,body}){
  requirePermission(me,'orders','update');
  const clientId=requestedClient(me,url,body),scope=await resolveStoreScope(env,me,clientId,clean(body.storeId||body.store_id,150)||null,{write:true});
  const province=clean(body.province,200),city=clean(body.city,200),area=clean(body.area,200),street=clean(body.street,1000);
  if(!province||!city||!area||!street)throw Object.assign(new Error('المحافظة والمدينة والمنطقة والشارع مطلوبة من دليل J&T'),{status:400,code:'JNT_ADDRESS_REQUIRED'});
  const orderId=clean(body.id,180)||rid('MAN');
  const orderBody={...body,id:orderId,clientId,storeId:scope.storeId||body.storeId||undefined,gov:province,address:[city,area,street].filter(Boolean).join(' — '),state:body.state||'pending'};
  for(const key of ['province','city','area','street','provinceCode','cityCode','districtCode','addressCountryCode'])delete orderBody[key];
  const target=new URL(request.url);target.pathname='/api/orders';target.search='';
  const headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');
  const response=await delegate.fetch(new Request(target,{method:'POST',headers,body:JSON.stringify(orderBody)}),env,ctx);
  if(!response.ok)return response;
  await env.DB.prepare(`UPDATE orders SET jnt_province=?,jnt_city=?,jnt_area=?,jnt_street=?,jnt_province_code=?,jnt_city_code=?,jnt_district_code=?,jnt_country_code=? WHERE id=? AND client_id=?`).bind(province,city,area,street,clean(body.provinceCode,80)||null,clean(body.cityCode,80)||null,clean(body.districtCode,80)||null,clean(body.addressCountryCode,80)||'100000',orderId,clientId).run();
  const data=await response.clone().json().catch(()=>({}));
  return json({...data,ok:true,id:data.id||data.order?.id||orderId,jntAddress:{province,city,area,street,provinceCode:clean(body.provinceCode,80),cityCode:clean(body.cityCode,80),districtCode:clean(body.districtCode,80),countryCode:clean(body.addressCountryCode,80)||'100000'}},response.status);
}
async function enrichOrderDetails(request,env,ctx,delegate,url,me){
  const response=await delegate.fetch(request,env,ctx);if(!response.ok)return response;
  const match=url.pathname.match(/^\/api\/orders\/([^/]+)\/details$/);if(!match)return response;
  const data=await response.clone().json().catch(()=>null);if(!data)return response;
  const clientId=requestedClient(me,url,{}),orderId=decodeURIComponent(match[1]),row=await env.DB.prepare('SELECT jnt_province,jnt_city,jnt_area,jnt_street,jnt_province_code,jnt_city_code,jnt_district_code,jnt_country_code FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)return response;
  const current=data.address||{};data.address={...current,government:row.jnt_province||current.government||'',city:row.jnt_city||current.city||'',area:row.jnt_area||current.area||'',street:row.jnt_street||current.street||'',provinceCode:row.jnt_province_code||'',cityCode:row.jnt_city_code||'',districtCode:row.jnt_district_code||'',countryCode:row.jnt_country_code||''};
  return json(data,response.status);
}

export async function handleOperationalWorkflowV105({request,env,ctx={},delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  const isClaims=path==='/api/customer-service/claims'&&method==='GET';
  const claimMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/claim-contact$/);
  const stateMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/state$/);
  const jtQueueMatch=path.match(/^\/api\/jt\/shipments\/([^/]+)$/);
  const detailsMatch=path.match(/^\/api\/orders\/([^/]+)\/details$/);
  const mobile=path==='/api/mobile/caller-lookup'&&method==='GET';
  const manual=path==='/api/orders/manual-jnt'&&method==='POST';
  if(!isClaims&&!claimMatch&&!stateMatch&&!jtQueueMatch&&!detailsMatch&&!mobile&&!manual)return null;
  try{
    const me=await currentUser(request,env,ctx,delegate);
    if(isClaims){const clientId=requestedClient(me,url,{});return json(await claimsBoard(env,{me,clientId,selectedStoreId:url.searchParams.get('storeId')||''}));}
    if(claimMatch&&method==='POST'){const body=await request.clone().json().catch(()=>({})),clientId=requestedClient(me,url,body);return json(await claimContact(env,{me,clientId,orderId:decodeURIComponent(claimMatch[1])}));}
    if(mobile){const clientId=requestedClient(me,url,{});return json(await mobileCallerLookup(env,{me,clientId,phone:url.searchParams.get('phone')||''}));}
    if(manual){const body=await request.clone().json().catch(()=>({}));return createManualJntOrder({request,env,ctx,delegate,me,url,body});}
    if(detailsMatch&&method==='GET')return enrichOrderDetails(request,env,ctx,delegate,url,me);
    if(stateMatch&&method==='PATCH'){
      const body=await request.clone().json().catch(()=>({})),clientId=requestedClient(me,url,body),response=await delegate.fetch(request,env,ctx);
      if(response.ok)await clearClaim(env,clientId,decodeURIComponent(stateMatch[1]));
      return response;
    }
    if(jtQueueMatch&&method==='POST'){
      const body=await request.clone().json().catch(()=>({})),clientId=requestedClient(me,url,body),response=await delegate.fetch(request,env,ctx);
      if(response.ok){const data=await response.clone().json().catch(()=>({}));if(data.queuedForPrint||data.state==='shipped')await clearClaim(env,clientId,decodeURIComponent(jtQueueMatch[1]));}
      return response;
    }
    return null;
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'OPERATIONAL_WORKFLOW_ERROR',...(error?.claim?{claim:error.claim}:{})},error?.status||500);}
}
