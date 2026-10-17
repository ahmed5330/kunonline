import {requirePermission} from './access-control.js';
import {listMyStores} from './store-scope.js';

const ALLOWED_ROLES=new Set(['admin','client','ops','support']);
const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const arr=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[]}catch{return []}};

async function delegatedJson(delegate,request,env,ctx,path){
  const u=new URL(request.url);u.pathname=path;u.search='';
  const r=await delegate.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  return {response:r,data:await r.clone().json().catch(()=>({}))};
}
async function currentUser(delegate,request,env,ctx){
  const {response,data}=await delegatedJson(delegate,request,env,ctx,'/api/me');
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.status===200?401:response.status||401,code:'AUTH_REQUIRED'});
  if(!ALLOWED_ROLES.has(data.role))throw Object.assign(new Error('قسم الطباعة غير متاح لهذا الدور'),{status:403,code:'PRINTING_ROLE_DENIED'});
  requirePermission(data,'orders','read');
  return data;
}
function clientIdFor(me,url){
  const requested=clean(url.searchParams.get('clientId')||me.clientId,160);
  if(me.role==='client'){
    if(requested&&requested!==clean(me.clientId,160))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return clean(me.clientId,160);
  }
  if(!requested)throw Object.assign(new Error('تعذر تحديد حساب المتجر'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}
function latest(history,type){return [...history].reverse().find(x=>x?.type===type)||null;}
function mapOrder(r){
  const history=arr(r.history),queued=latest(history,'jt_print_queued'),created=latest(history,'jt_shipment_created'),printed=latest(history,'jt_label_printed');
  const shipment=(created?.shipment&&typeof created.shipment==='object'?created.shipment:queued?.shipment&&typeof queued.shipment==='object'?queued.shipment:{})||{};
  return {
    id:r.id,clientId:r.client_id,storeId:r.store_id||'',storeName:r.store_name||'',ref:r.ref||r.id,date:r.date||r.created_at||'',createdAt:r.created_at||'',
    name:r.name||'',phone:r.phone||'',phone2:shipment.receiverPhone2||r.jnt_phone2||'',gov:r.gov||'',address:r.address||'',
    product:r.product||'',qty:Number(r.qty)||1,total:Number(r.total)||0,note:r.note||'',awb:r.awb||created?.awb||'',state:r.state||'confirmed',checkpoint:r.checkpoint||'',
    province:shipment.province||r.jnt_province||r.gov||'',provinceCode:shipment.provinceCode||r.jnt_province_code||'',
    city:shipment.city||r.jnt_city||'',cityCode:shipment.cityCode||r.jnt_city_code||'',
    area:shipment.area||r.jnt_area||'',districtCode:shipment.districtCode||r.jnt_district_code||r.jnt_area_code||'',
    street:shipment.street||r.jnt_street||r.address||'',countryCode:r.jnt_country_code||r.jnt_address_country_code||'100000',
    weight:Number(shipment.weight||r.parcel_weight||1)||1,history,
    queuedForPrint:Boolean(queued),shipmentCreated:Boolean(r.awb||created?.awb),printed:Boolean(printed?.official!==false&&printed?.awb),
    sortingCode:clean(created?.sortingCode||printed?.sortingCode,160),txlogisticId:clean(created?.txlogisticId||queued?.txlogisticId,160)
  };
}

/**
 * Keep the legacy combined response for Android callers, but let the web Printing
 * queue page safely through ALL confirmed orders instead of silently dropping older
 * work whenever recently shipped records fill the old LIMIT 1000.
 */
export async function handleProductionPrintingQueue({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/printing'||request.method.toUpperCase()!=='GET')return null;
  try{
    const me=await currentUser(delegate,request,env,ctx),clientId=clientIdFor(me,url),access=await listMyStores(env,me,clientId);
    const stores=access.stores||[],storeIds=stores.map(store=>String(store.id)).filter(Boolean);
    const selectedStoreId=clean(url.searchParams.get('storeId'),160);
    if(selectedStoreId&&!storeIds.includes(selectedStoreId))throw Object.assign(new Error('المتجر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
    if(!access.allStores&&!storeIds.length)return json({ok:true,clientId,orders:[],stores:[],counts:{waiting:0,printed:0},total:0,hasMore:false});
    const where=['o.client_id=?'],binds=[clientId];
    if(selectedStoreId){where.push('o.store_id=?');binds.push(selectedStoreId);}
    else if(!access.allStores){where.push(`o.store_id IN (${storeIds.map(()=>'?').join(',')})`);binds.push(...storeIds);}
    const scopedWhere=where.join(' AND ');
    const source=`FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE ${scopedWhere}`;
    // Use identical filters for counters, pages and the legacy Android response.
    // A delayed marketplace callback may leave an already-printed order with a
    // stale "confirmed" state; never let it vanish from both printing tabs.
    const printedFilter="o.state IN ('confirmed','preparing','shipped') AND instr(COALESCE(o.history,''),'jt_label_printed')>0";
    const waitingFilter="((o.state IN ('confirmed','preparing') OR (o.state='shipped' AND instr(COALESCE(o.history,''),'jt_print_queued')>0)) AND instr(COALESCE(o.history,''),'jt_label_printed')=0)";
    const counts=await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN ${waitingFilter} THEN 1 ELSE 0 END),0) waiting,
      COALESCE(SUM(CASE WHEN ${printedFilter} THEN 1 ELSE 0 END),0) printed
      ${source}`).bind(...binds).first();
    const normalizedCounts={waiting:Number(counts?.waiting)||0,printed:Number(counts?.printed)||0};
    const tab=clean(url.searchParams.get('tab'),20);
    const storeOptions=stores.map(store=>({id:store.id,name:store.name,code:store.code||'',role:store.role||'owner'}));
    if(tab==='waiting'||tab==='printed'){
      const limit=Math.min(200,Math.max(1,Math.floor(Number(url.searchParams.get('limit')))||100));
      const offset=Math.min(1000000,Math.max(0,Math.floor(Number(url.searchParams.get('offset')))||0));
      const stateFilter=tab==='waiting'?waitingFilter:printedFilter;
      const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name ${source} AND ${stateFilter} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`).bind(...binds,limit,offset).all();
      const orders=results.map(mapOrder).filter(order=>tab==='waiting'?!order.printed:order.printed);
      const total=normalizedCounts[tab];
      return json({ok:true,clientId,selectedStoreId:selectedStoreId||null,stores:storeOptions,orders,tab,limit,offset,total,hasMore:offset+limit<total,counts:normalizedCounts});
    }
    // Backward-compatible response for older Android builds: shipping history cannot
    // crowd confirmed orders out of the first page.
    const pending=await env.DB.prepare(`SELECT o.*,s.name store_name ${source} AND ${waitingFilter} ORDER BY o.created_at DESC,o.id DESC LIMIT 1000`).bind(...binds).all();
    const printed=await env.DB.prepare(`SELECT o.*,s.name store_name ${source} AND ${printedFilter} ORDER BY o.created_at DESC,o.id DESC LIMIT 250`).bind(...binds).all();
    const orders=[...(pending.results||[]),...(printed.results||[])].map(mapOrder);
    return json({ok:true,clientId,selectedStoreId:selectedStoreId||null,stores:storeOptions,orders,counts:normalizedCounts,truncated:normalizedCounts.waiting>1000});
  }catch(error){return json({error:error?.message||'تعذر تحميل قسم الطباعة',code:error?.code||'PRINTING_QUEUE_ERROR'},Number(error?.status)>=400&&Number(error.status)<600?Number(error.status):500);}
}
