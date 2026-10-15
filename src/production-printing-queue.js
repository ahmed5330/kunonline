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
    id:r.id,clientId:r.client_id,storeId:r.store_id||'',ref:r.ref||r.id,date:r.date||r.created_at||'',createdAt:r.created_at||'',
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

export async function handleProductionPrintingQueue({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/printing'||request.method.toUpperCase()!=='GET')return null;
  try{
    const me=await currentUser(delegate,request,env,ctx),clientId=clientIdFor(me,url),access=await listMyStores(env,me,clientId);
    const states=['confirmed','preparing','shipped'];
    const where=[`client_id=?`,`state IN (${states.map(()=>'?').join(',')})`],binds=[clientId,...states];
    if(!access.allStores){
      const ids=(access.stores||[]).map(x=>String(x.id)).filter(Boolean);
      if(!ids.length)return json({ok:true,clientId,orders:[]});
      where.push(`store_id IN (${ids.map(()=>'?').join(',')})`);binds.push(...ids);
    }
    const {results=[]}=await env.DB.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 1000`).bind(...binds).all();
    const orders=results.map(mapOrder).filter(order=>order.state!=='shipped'||order.queuedForPrint||order.printed);
    return json({ok:true,clientId,orders});
  }catch(error){return json({error:error?.message||'تعذر تحميل قسم الطباعة',code:error?.code||'PRINTING_QUEUE_ERROR'},Number(error?.status)>=400&&Number(error.status)<600?Number(error.status):500);}
}
