/* Kun Online — Easy Orders Store Control v1: official API only, tenant scoped, fail-closed writes. */
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';
import {readConnectionSecrets} from './integration-provider-validation.js';

const BASE='https://api.easy-orders.net/api/v1/external-apps';
const PROFILES=Object.freeze({
  products:{read:true,write:true},
  categories:{read:true,write:true},
  orders:{read:true,write:true},
  stock:{read:false,write:true},
  shipping:{read:false,write:true},
  homepage:{read:false,write:false},
  themes:{read:false,write:false},
  landing_pages:{read:false,write:false},
  coupons:{read:false,write:false},
  payments:{read:false,write:false},
  store_settings:{read:false,write:false}
});
const STATUSES=new Set(['pending','confirmed','pending_payment','paid','paid_failed','processing','waiting_for_pickup','in_delivery','delivered','canceled','returning_from_delivery','request_refund','refund_in_progress','refunded']);
const OP={
  'product.create':{scope:'products',method:'POST',base:'products'},
  'product.update':{scope:'products',method:'PATCH',base:'products'},
  'product.stock':{scope:'stock',method:'PATCH',base:'products'},
  'variant.stock':{scope:'stock',method:'PATCH',base:'products'},
  'category.create':{scope:'categories',method:'POST',base:'categories'},
  'category.update':{scope:'categories',method:'PATCH',base:'categories'},
  'order.status':{scope:'orders',method:'PATCH',base:'orders'},
  'order.note':{scope:'orders',method:'POST',base:'order-notes'},
  'shipping.update':{scope:'shipping',method:'PATCH',base:'shipping'}
};
const clean=v=>String(v??'').trim();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const problem=(message,status,code)=>Object.assign(new Error(message),{status,code});
const safeId=(value,label='المعرّف')=>{
  const id=clean(value);
  if(!/^[\w-]{1,120}$/.test(id))throw problem(label+' غير صالح',400,'INVALID_REMOTE_ID');
  return encodeURIComponent(id);
};
const money=(value,field)=>{
  if(value===''||value===null||value===undefined)throw problem('ادخل '+field,400,'MISSING_PRICE');
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100000000)return (()=>{throw problem(field+' غير صالح',400,'INVALID_PRICE');})();
  return Math.round(n*100)/100;
};
const integer=(value,field)=>{
  const n=Number(value);
  if(value===''||value===null||value===undefined||!Number.isSafeInteger(n)||n<0||n>10000000)throw problem(field+' غير صالح',400,'INVALID_STOCK');
  return n;
};
const text=(value,field,max=2000)=>{
  const s=clean(value);
  if(!s||s.length>max)throw problem(field+' مطلوب ويجب ألا يتجاوز '+max+' حرفًا',400,'INVALID_FIELD');
  return s;
};
function categoryPayload(raw,create){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw problem('بيانات التصنيف غير صحيحة',400,'INVALID_INPUT');
  const fields=['name','slug','thumb','show_in_header','hidden','position','parent_id'],out={};
  for(const key of fields)if(Object.prototype.hasOwnProperty.call(raw,key)){
    const v=raw[key];
    if(key==='name')out[key]=text(v,'اسم التصنيف',200);
    else if(key==='slug')out[key]=text(v,'رابط التصنيف',150);
    else if(key==='position')out[key]=integer(v,'ترتيب التصنيف');
    else if(key==='show_in_header'||key==='hidden'){if(typeof v!=='boolean')throw problem(key+' يجب أن يكون true/false',400,'INVALID_FIELD');out[key]=v;}
    else if(key==='parent_id')out[key]=v===null?null:safeId(v,'معرّف التصنيف الأب');
    else if(key==='thumb')out[key]=httpUrl(v);
  }
  if(create&&!out.name)throw problem('اسم التصنيف مطلوب',400,'INVALID_FIELD');
  if(!Object.keys(out).length)throw problem('لم يتم إدخال تغييرات',400,'EMPTY_CHANGE');
  return out;
}
function httpUrl(v){const value=clean(v);if(value.length>2048)throw problem('الرابط طويل',400,'INVALID_URL');let u;try{u=new URL(value)}catch{throw problem('الرابط غير صالح',400,'INVALID_URL')}if(u.protocol!=='https:')throw problem('روابط الصور يجب أن تكون HTTPS',400,'INVALID_URL');return u.toString();}
function productPayload(raw,create){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw problem('بيانات المنتج غير صحيحة',400,'INVALID_INPUT');
  const out={};
  const keys=['name','description','sku','slug','price','sale_price','thumb','images','quantity','track_stock','disable_orders_for_no_stock','buy_now_text','categories'];
  for(const key of keys)if(Object.prototype.hasOwnProperty.call(raw,key)){
    const v=raw[key];
    if(key==='price'||key==='sale_price')out[key]=money(v,key);
    else if(key==='quantity')out[key]=integer(v,'الكمية');
    else if(key==='track_stock'||key==='disable_orders_for_no_stock'){if(typeof v!=='boolean')throw problem(key+' يجب أن يكون true/false',400,'INVALID_FIELD');out[key]=v;}
    else if(key==='thumb')out[key]=httpUrl(v);
    else if(key==='images'){if(!Array.isArray(v)||v.length>15)throw problem('قائمة الصور غير صالحة',400,'INVALID_IMAGES');out[key]=v.map(httpUrl);}
    else if(key==='categories'){if(!Array.isArray(v)||v.length>30)throw problem('قائمة التصنيفات غير صالحة',400,'INVALID_CATEGORIES');out[key]=v.map(x=>({id:safeId(x?.id,'معرّف التصنيف')}));}
    else out[key]=text(v,key,key==='description'?18000:250);
  }
  if(create&&(!out.name||out.price===undefined))throw problem('اسم المنتج وسعره مطلوبان',400,'INVALID_FIELD');
  if(!Object.keys(out).length)throw problem('لم يتم إدخال تغييرات',400,'EMPTY_CHANGE');
  return out;
}
function shippingPayload(input){
  const rows=Array.isArray(input?.cities)?input.cities:null;
  if(!rows?.length||rows.length>120)throw problem('حدد مناطق الشحن وتكلفتها',400,'INVALID_SHIPPING');
  const seen=new Set();
  const cities=rows.map(x=>{
    const name=text(x?.name,'اسم المنطقة',80);
    if(/[,:\r\n]/.test(name))throw problem('اسم المنطقة يحتوي على علامة غير مسموحة',400,'INVALID_CITY');
    const key=name.toLocaleLowerCase('ar-EG');
    if(seen.has(key))throw problem('منطقة شحن مكررة: '+name,400,'DUPLICATE_CITY');seen.add(key);
    return name+':'+money(x?.shipping_cost,'تكلفة الشحن');
  });
  return {is_active:true,cities:cities.join(',')};
}
export function buildEasyOrdersAction(body){
  const op=clean(body?.operation),rule=OP[op];
  if(!rule)throw problem('العملية غير مدعومة في API الرسمي',400,'UNSUPPORTED_OPERATION');
  const id=body?.entityId,raw=body?.payload||{};
  let path,output;
  if(op==='product.create'){path='products';output=productPayload(raw,true);}
  else if(op==='product.update'){path='products/'+safeId(id,'معرف المنتج');output=productPayload(raw,false);}
  else if(op==='product.stock'){path='products/sku/'+safeId(id,'SKU')+'/quantity';output={quantity:integer(raw.quantity,'الكمية')};}
  else if(op==='variant.stock'){path='products/variants/'+safeId(raw.productTaagerCode,'كود المنتج')+'/'+safeId(id,'كود المتغير')+'/quantity';output={quantity:integer(raw.quantity,'الكمية')};}
  else if(op==='category.create'){path='categories';output=categoryPayload(raw,true);}
  else if(op==='category.update'){path='categories/'+safeId(id,'معرف التصنيف');output=categoryPayload(raw,false);}
  else if(op==='order.status'){path='orders/'+safeId(id,'معرف الطلب')+'/status';const status=clean(raw.status);if(!STATUSES.has(status))throw problem('حالة الطلب غير معتمدة',400,'INVALID_STATUS');output={status};}
  else if(op==='order.note'){path='order-notes';const storeId=safeId(raw.store_id,'معرف متجر Easy Orders');output={order_id:decodeURIComponent(safeId(id,'معرف الطلب')),store_id:decodeURIComponent(storeId),note:text(raw.note,'الملاحظة',2000),type:raw.type==='public'?'public':'private'};}
  else if(op==='shipping.update'){path='shipping';output=shippingPayload(raw);}
  return {operation:op,scope:rule.scope,method:rule.method,path,payload:output};
}
function checkProviderStore(data,externalStoreId){
  if(!externalStoreId)return;
  const values=[];
  const inspect=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.slice(0,150).forEach(inspect);return;}if(v.store_id||v.storeId)values.push(clean(v.store_id||v.storeId));};
  inspect(data);inspect(data?.data);inspect(data?.products);inspect(data?.categories);inspect(data?.order);
  if(values.some(v=>v!==externalStoreId))throw problem('الرد لا يطابق متجر Easy Orders المرتبط',409,'EXTERNAL_STORE_MISMATCH');
}
async function apiCall(fetcher,key,path,{method='GET',body,externalStoreId}={}){
  const headers={'Api-Key':key,'Accept':'application/json'};
  if(body)headers['Content-Type']='application/json';
  let response;
  try{response=await fetcher(BASE+'/'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});}
  catch(e){throw problem('تعذر الاتصال بـ Easy Orders، حاول لاحقًا',502,'EASYORDERS_UNREACHABLE');}
  const d=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===429)throw problem('وصل المتجر لحد طلبات Easy Orders؛ حاول بعد قليل',429,'EASYORDERS_RATE_LIMIT');
    if(response.status===403||response.status===401)throw problem('مفتاح Easy Orders لا يملك صلاحية العملية أو انتهت صلاحيته',403,'EASYORDERS_PERMISSION');
    throw problem('رفض Easy Orders العملية (HTTP '+response.status+')',response.status>=500?502:422,'EASYORDERS_REJECTED');
  }
  checkProviderStore(d,externalStoreId);
  return d;
}
function configOf(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {}};}
export async function findBoundEasyOrdersConnection(env,{clientId,storeId,connectionId}){
  if(!storeId)throw problem('اختار المتجر من شريط كن أونلاين أولًا',400,'STORE_REQUIRED');
  const {results=[]}=await env.DB.prepare("SELECT id,client_id,provider,status,config_json,external_store_id,updated_at FROM store_connections WHERE client_id=? AND provider='easyorders' AND status='connected' ORDER BY updated_at DESC").bind(clientId).all();
  const matched=results.filter(row=>{const c=configOf(row);return clean(c.kunStoreId||c.storeId)===storeId;});
  if(!matched.length)throw problem('اربط Easy Orders بهذا المتجر من مركز التكاملات أولًا؛ الربط العام لا يسمح بالكتابة',409,'EASYORDERS_EXPLICIT_STORE_BINDING_REQUIRED');
  let chosen=matched;
  if(connectionId)chosen=matched.filter(x=>x.id===connectionId);
  if(chosen.length!==1)throw problem(chosen.length?'حدد ربط Easy Orders المقصود':'هذا الربط غير تابع للمتجر المحدد',409,'EASYORDERS_CONNECTION_SELECTION_REQUIRED');
  const row=chosen[0],config=configOf(row);
  return {row,externalStoreId:clean(row.external_store_id||config.easyOrdersStoreId||''),name:clean(config.storeName||'Easy Orders')};
}
async function writeAudit(env,{clientId,storeId,actor,operation,entityId,metadata}){
  await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind('AUD-'+crypto.randomUUID().slice(0,12).toUpperCase(),clientId,storeId,actor?.uid||null,actor?.email||actor?.role||'user',operation,'easyorders_store',entityId||null,JSON.stringify(metadata),new Date().toISOString()).run();
}
async function fromRemote(fetcher,key,resource,id,externalStoreId){
  const source=resource==='products'?'products':resource==='categories'?'categories':resource==='product'?'products/'+safeId(id,'معرف المنتج'):resource==='category'?'categories/'+safeId(id,'معرف التصنيف'):resource==='order'?'orders/'+safeId(id,'معرف الطلب'):null;
  if(!source)throw problem('هذا القسم غير متاح عبر API الرسمي',501,'EASYORDERS_UNSUPPORTED');
  return apiCall(fetcher,key,source,{externalStoreId});
}
const lastWrite=new Map();
export async function runEasyOrdersStoreControl({request,env,delegate,ctx,fetcher=fetch,secretReader=readConnectionSecrets}){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/integrations/easyorders/store-control'))return null;
  const method=request.method.toUpperCase();
  try{
    if(!['GET','POST'].includes(method))return json({error:'Method not allowed',code:'METHOD_NOT_ALLOWED'},405);
    const meUrl=new URL(url);meUrl.pathname='/api/me';meUrl.search='';
    const auth=await delegate.fetch(new Request(meUrl,{method:'GET',headers:request.headers}),env,ctx);
    const me=await auth.json().catch(()=>({}));
    if(!auth.ok||!me.role)throw problem('يجب تسجيل الدخول',401,'AUTH_REQUIRED');
    const raw=method==='POST'?await request.text():'';if(raw.length>64000)throw problem('حجم الطلب يتجاوز الحد المسموح',413,'REQUEST_TOO_LARGE');
    let body={};if(raw){try{body=JSON.parse(raw)}catch{throw problem('JSON غير صالح',400,'INVALID_JSON');}}
    const clientId=resolveTenant(me,body.clientId||url.searchParams.get('clientId')||me.clientId);
    const storeId=clean(body.storeId||url.searchParams.get('storeId'));
    requirePermission(me,'integrations',method==='GET'?'read':'write');
    const scope=await resolveStoreScope(env,me,clientId,storeId,{write:method==='POST'});
    if(!scope.storeId||scope.storeId!==storeId)throw problem('يجب اختيار متجر محدد لإدارة Easy Orders',400,'STORE_REQUIRED');
    const resource=clean(url.searchParams.get('resource')||'capabilities');
    if(method==='GET'&&resource==='capabilities'){
      const result={ok:true,capabilities:PROFILES,operations:Object.keys(OP),documentation:'https://public-api-docs.easy-orders.net/',connected:false,connection:null,writeRequiresOwner:true};
      try{const found=await findBoundEasyOrdersConnection(env,{clientId,storeId});result.connected=true;result.connection={id:found.row.id,name:found.name,externalStoreId:found.externalStoreId||null,writeReady:Boolean(found.externalStoreId),lastUpdated:found.row.updated_at||null};}
      catch(e){result.connectionError={code:e.code||'NOT_CONNECTED',message:e.message};}
      return json(result);
    }
    const found=await findBoundEasyOrdersConnection(env,{clientId,storeId,connectionId:body.connectionId||url.searchParams.get('connectionId')});
    const secrets=await secretReader(env,clientId,found.row.id);
    const key=clean(secrets.api_key);
    if(!key)throw problem('مفتاح API غير متاح لهذا الربط',409,'EASYORDERS_API_KEY_MISSING');
    if(method==='GET'){
      const id=clean(url.searchParams.get('entityId'));const data=await fromRemote(fetcher,key,resource,id,found.externalStoreId);
      return json({ok:true,resource,data,connectionId:found.row.id,externalStoreId:found.externalStoreId||null});
    }
    if(!['admin','client'].includes(me.role))throw problem('نشر التعديلات يتطلب حساب مالك المتجر أو الإدارة',403,'EASYORDERS_OWNER_REQUIRED');
    if(request.headers.get('X-Kun-Store-Action')!=='confirmed')throw problem('التأكيد من لوحة كن أونلاين مطلوب',403,'CONFIRM_HEADER_REQUIRED');
    const origin=request.headers.get('Origin');if(origin&&new URL(origin).origin!==url.origin)throw problem('المصدر غير موثوق',403,'ORIGIN_MISMATCH');
    if(body.confirm!=='CONFIRM_PUBLISH_EASYORDERS')throw problem('يجب معاينة العملية وتأكيدها قبل النشر',409,'CONFIRMATION_REQUIRED');
    if(!found.externalStoreId)throw problem('لا يمكن تعديل متجر لم يتم تأكيد Easy Orders Store ID له',409,'EASYORDERS_STORE_ID_REQUIRED');
    const action=buildEasyOrdersAction(body);
    if(action.operation==='shipping.update'&&body.confirmShippingReplace!==true)throw problem('يجب تأكيد استبدال إعدادات مناطق الشحن بالكامل',409,'SHIPPING_REPLACEMENT_CONFIRMATION_REQUIRED');
    // Verify remote ownership before editing a known entity. We never fabricate IDs or routes.
    if(['product.update','order.status','order.note','category.update'].includes(action.operation)){
      const readType=action.scope==='products'?'product':action.scope==='categories'?'category':'order';
      await fromRemote(fetcher,key,readType,body.entityId,found.externalStoreId);
    }
    if(action.operation==='order.note'&&action.payload.store_id!==found.externalStoreId)throw problem('الملاحظة تخص متجرًا مختلفًا',403,'EXTERNAL_STORE_MISMATCH');
    const throttleKey=clientId+':'+storeId+':'+found.row.id,now=Date.now();
    if(now-(lastWrite.get(throttleKey)||0)<2500)throw problem('انتظر لحظات قبل تنفيذ العملية التالية',429,'EASYORDERS_WRITE_COOLDOWN');
    lastWrite.set(throttleKey,now);
    try{await writeAudit(env,{clientId,storeId,actor:me,operation:'easyorders.intent.'+action.operation,entityId:clean(body.entityId),metadata:{connectionId:found.row.id,payload:action.payload}});}
    catch{throw problem('تعذر تسجيل العملية في سجل التدقيق؛ لم نرسل أي تعديل',503,'AUDIT_UNAVAILABLE');}
    const result=await apiCall(fetcher,key,action.path,{method:action.method,body:action.payload,externalStoreId:found.externalStoreId});
    let audited=true;
    try{await writeAudit(env,{clientId,storeId,actor:me,operation:'easyorders.success.'+action.operation,entityId:clean(body.entityId),metadata:{connectionId:found.row.id}});}
    catch{audited=false;}
    return json({ok:true,operation:action.operation,published:true,audited,connectionId:found.row.id,data:result,message:'قبل Easy Orders التعديل. راجع صفحة المتجر للتأكد من ظهور النتيجة.'});
  }catch(error){return json({ok:false,error:error?.message||'تعذر تنفيذ العملية',code:error?.code||'EASYORDERS_CONTROL_ERROR'},error?.status||500);}
}
export const EASYORDERS_CONTROL_CAPABILITIES=PROFILES;
