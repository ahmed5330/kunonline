import {readConnectionSecrets} from './integration-provider-validation.js';
import {jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';
import {listMyStores} from './store-scope.js';
import {requirePermission} from './access-control.js';

const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const parseArray=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const MAX_PAGE=50;
const JT_BATCH=20;
const FINAL_STATES=new Set(['signed','collected','cancelled','returned']);

function chunk(values,size){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function scalar(object,keys,max=500){for(const key of keys){const value=object?.[key];if(value!==undefined&&value!==null&&typeof value!=='object'&&clean(value))return clean(value,max);}return '';}
function numeric(object,keys){for(const key of keys){const value=object?.[key];if(value===undefined||value===null||value==='')continue;const number=Number(String(value).replace(/,/g,''));if(Number.isFinite(number))return number;}return null;}
function firstObject(object,keys){for(const key of keys){const value=object?.[key];if(value&&typeof value==='object'&&!Array.isArray(value))return value;}return null;}
function firstArray(object,keys){for(const key of keys){const value=object?.[key];if(Array.isArray(value))return value;}return [];}

function normalizeJtOrder(object){
  if(!object||typeof object!=='object'||Array.isArray(object))return null;
  const txlogisticId=scalar(object,['txlogisticId','txLogisticId','serialNumber','customerOrderNo','orderNo','orderNoCustomer'],180);
  const awb=scalar(object,['billCode','bill_code','waybillCode','waybillNo','waybillNumber','trackingNumber','logisticsNo','mailNo','awb','awbNo','awb_no'],180);
  if(!txlogisticId||!awb)return null;
  const receiver=firstObject(object,['receiver','receiverInfo','receiverAddress','consignee'])||{};
  const items=firstArray(object,['items','itemList','details','goodsList']),item=items.find(value=>value&&typeof value==='object')||{};
  const province=scalar(receiver,['prov','province','state','provinceName'],180);
  const city=scalar(receiver,['city','cityName','district'],180);
  const area=scalar(receiver,['area','areaName','town'],220);
  const street=scalar(receiver,['street','address','detailAddress','addressDetail'],900);
  return {
    txlogisticId,
    awb,
    sortingCode:scalar(object,['sortingCode','sortCode','sorting_code','shortAddress'],180),
    name:scalar(receiver,['name','receiverName','contactName'],220),
    phone:scalar(receiver,['mobile','phone','phone1','tel'],100),
    gov:province,
    address:[city,area,street].filter(Boolean).join(' — '),
    product:scalar(item,['itemName','name','goodsName','productName'],500),
    qty:numeric(object,['totalQuantity','quantity','qty'])??numeric(item,['number','quantity','qty']),
    total:numeric(object,['itemsValue','codAmount','amount','collectAmount','totalAmount']),
    rawStatus:scalar(object,['status','orderStatus','state'],120)
  };
}

function collectJtOrders(payload){
  const out=[],seen=new Set(),visited=new Set();
  function walk(node,depth=0){
    if(depth>8||node==null)return;
    if(Array.isArray(node)){for(const item of node)walk(item,depth+1);return;}
    if(typeof node!=='object'||visited.has(node))return;
    visited.add(node);
    const normalized=normalizeJtOrder(node);
    if(normalized){const key=`${normalized.txlogisticId}|${normalized.awb}`;if(!seen.has(key)){seen.add(key);out.push(normalized);}}
    for(const value of Object.values(node))if(value&&typeof value==='object')walk(value,depth+1);
  }
  walk(payload);
  return out;
}

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.status||401,code:'AUTH_REQUIRED'});
  return data;
}
function clientIdFor(me,request,body={}){
  const url=new URL(request.url),requested=clean(body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId,160);
  if(me.role==='client'){
    if(requested&&requested!==String(me.clientId||''))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403,code:'TENANT_ISOLATION'});
    return clean(me.clientId,160);
  }
  if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400,code:'CLIENT_ID_REQUIRED'});
  return requested;
}
async function connectionFor(env,clientId){
  const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider='jt' ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'configured' THEN 1 ELSE 2 END,updated_at DESC,created_at DESC LIMIT 1").bind(clientId).first();
  if(!row)throw Object.assign(new Error('اربط J&T Express من مركز التكاملات أولًا'),{status:409,code:'JT_CONNECTION_REQUIRED'});
  const secrets=await readConnectionSecrets(env,clientId,row.id),cred=jtCredentials(secrets);
  if(cred.missing.length)throw Object.assign(new Error('بيانات J&T ناقصة: API Account + Private Key + Source Code مطلوبة'),{status:409,code:'JT_CREDENTIALS_MISSING'});
  return {row,secrets,cred};
}

async function queryJtOrders(serialNumbers,secrets,cred){
  const base={sourceCode:cred.fields.sourceCode,command:1,serialNumber:serialNumbers};
  let result;
  if(cred.enterpriseReady){
    result=await __jtApiInternals.signedPost(__jtApiInternals.GET_ORDERS_PATH,__jtApiInternals.withEnterprise(base,cred.fields),secrets,{fetcher:fetch});
    if(!__jtApiInternals.success(result)&&!__jtApiInternals.enterpriseCredentialHint(result))result=await __jtApiInternals.signedPost(__jtApiInternals.GET_ORDERS_PATH,base,secrets,{fetcher:fetch});
  }else result=await __jtApiInternals.signedPost(__jtApiInternals.GET_ORDERS_PATH,base,secrets,{fetcher:fetch});
  if(!__jtApiInternals.success(result))throw Object.assign(new Error(`J&T رفضت استعلام الأوردرات السابقة${result.code?` (${result.code})`:''}: ${result.message||`HTTP ${result.response.status}`}`),{status:result.response.status>=500?502:422,code:'JT_HISTORY_LOOKUP_REJECTED',jtCode:result.code});
  return collectJtOrders(result.data);
}

function identifiersFor(row){
  const values=[clean(row.ref,180),clean(row.id,180)];
  const history=parseArray(row.history);
  for(const event of history){if(event?.provider==='jt'||String(event?.type||'').startsWith('jt_'))values.push(clean(event?.txlogisticId,180));}
  return [...new Set(values.filter(Boolean))];
}
function eventAlready(history,awb,txlogisticId){return history.some(event=>event?.type==='jt_history_reconciled'&&clean(event?.awb,180)===awb&&clean(event?.txlogisticId,180)===txlogisticId);}

async function appendEventRecord(env,row,event){
  try{await env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(`OEV-${crypto.randomUUID()}`,row.client_id,row.store_id||null,row.id,'jt_history_reconciled',null,null,'jt-history',JSON.stringify(event),event.at).run();}catch{}
}

async function applyMatch(env,row,jt,actor){
  const currentAwb=clean(row.awb,180),awb=clean(jt.awb,180),txlogisticId=clean(jt.txlogisticId,180);
  if(currentAwb&&currentAwb!==awb)return {kind:'conflict',orderId:row.id,currentAwb,jtAwb:awb};
  const history=parseArray(row.history),already=eventAlready(history,awb,txlogisticId),at=now(),moveToShipped=!FINAL_STATES.has(clean(row.state,80))&&clean(row.state,80)!=='shipped';
  if(!already)history.push({type:'jt_history_reconciled',provider:'jt',source:'jt-history',awb,txlogisticId,sortingCode:jt.sortingCode||'',rawStatus:jt.rawStatus||'',state:moveToShipped?'shipped':row.state,note:'تمت مطابقة الأوردر مع شحنة سابقة موجودة على J&T',system:true,by:actor,byName:actor,at});
  const name=clean(row.name,220)||jt.name||'',phone=clean(row.phone,100)||jt.phone||'',gov=clean(row.gov,180)||jt.gov||'',address=clean(row.address,900)||jt.address||'',product=clean(row.product,500)||jt.product||'',qty=Number(row.qty)||Number(jt.qty)||1,total=Number(row.total)||Number(jt.total)||0;
  const nextState=moveToShipped?'shipped':row.state,nextCheckpoint=moveToShipped?'تمت مطابقة شحنة J&T سابقة — جاري الشحن':row.checkpoint;
  const changed=!already||!currentAwb||moveToShipped||(!clean(row.name)&&name)||(!clean(row.phone)&&phone)||(!clean(row.gov)&&gov)||(!clean(row.address)&&address)||(!clean(row.product)&&product);
  if(changed){
    await env.DB.prepare('UPDATE orders SET awb=?,state=?,checkpoint=?,name=?,phone=?,gov=?,address=?,product=?,qty=?,total=?,history=? WHERE id=? AND client_id=?').bind(awb,nextState,nextCheckpoint,name,phone,gov,address,product,qty,total,JSON.stringify(history),row.id,row.client_id).run();
    if(!already)await appendEventRecord(env,row,history[history.length-1]);
  }
  return {kind:changed?'updated':'unchanged',orderId:row.id,awb,movedToShipped:moveToShipped,enriched:Boolean((!clean(row.name)&&jt.name)||(!clean(row.phone)&&jt.phone)||(!clean(row.gov)&&jt.gov)||(!clean(row.address)&&jt.address)||(!clean(row.product)&&jt.product))};
}

async function resolveStoreScope(env,me,clientId,requestedStoreId){
  const scope=await listMyStores(env,me,clientId),storeId=clean(requestedStoreId,160);
  if(storeId){
    const allowed=scope.allStores||(scope.stores||[]).some(store=>String(store.id)===storeId&&store.role!=='viewer');
    if(!allowed)throw Object.assign(new Error('المتجر خارج الصلاحيات أو للعرض فقط'),{status:403,code:'STORE_ISOLATION'});
    return {where:' AND store_id=?',binds:[storeId],storeId};
  }
  if(scope.allStores)return {where:'',binds:[],storeId:null};
  const writable=(scope.stores||[]).filter(store=>store.role!=='viewer').map(store=>String(store.id));
  if(!writable.length)throw Object.assign(new Error('لا توجد متاجر بصلاحية تعديل لهذا الحساب'),{status:403,code:'STORE_WRITE_REQUIRED'});
  return {where:` AND store_id IN (${writable.map(()=>'?').join(',')})`,binds:writable,storeId:null};
}

async function reconcileRoute(request,env,ctx,delegate){
  const me=await currentUser(request,env,ctx,delegate);
  if(!['admin','client'].includes(me.role))throw Object.assign(new Error('استيراد سجل J&T السابق متاح لمالك الحساب أو إدارة Kun Online فقط'),{status:403,code:'JT_HISTORY_ROLE_DENIED'});
  requirePermission(me,'orders','update');
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body),offset=Math.max(0,Math.floor(Number(body.cursor)||0)),limit=Math.min(MAX_PAGE,Math.max(1,Math.floor(Number(body.limit)||MAX_PAGE))),scope=await resolveStoreScope(env,me,clientId,body.storeId||body.store_id),{row:connection,secrets,cred}=await connectionFor(env,clientId);
  const countRow=await env.DB.prepare(`SELECT COUNT(*) total FROM orders WHERE client_id=?${scope.where}`).bind(clientId,...scope.binds).first(),total=Number(countRow?.total)||0;
  const {results=[]}=await env.DB.prepare(`SELECT id,client_id,store_id,ref,state,checkpoint,awb,name,phone,gov,address,product,qty,total,history,created_at,date FROM orders WHERE client_id=?${scope.where} ORDER BY COALESCE(created_at,date,'') ASC,id ASC LIMIT ? OFFSET ?`).bind(clientId,...scope.binds,limit,offset).all();
  if(!results.length)return json({ok:true,done:true,cursor:null,total,scanned:0,matched:0,updated:0,movedToShipped:0,conflicts:[],notFound:0,message:'تم فحص كل أوردرات Kun Online المتاحة لهذا الحساب.'});

  const serialOwners=new Map();
  for(const order of results)for(const serial of identifiersFor(order)){if(!serialOwners.has(serial))serialOwners.set(serial,[]);serialOwners.get(serial).push(order);}
  const jtOrders=[];
  for(const serials of chunk([...serialOwners.keys()],JT_BATCH))jtOrders.push(...await queryJtOrders(serials,secrets,cred));
  const bySerial=new Map();for(const item of jtOrders){if(!bySerial.has(item.txlogisticId))bySerial.set(item.txlogisticId,item);}

  let matched=0,updated=0,movedToShipped=0,enriched=0,notFound=0,unchanged=0;
  const conflicts=[],matchedOrderIds=new Set(),actor=clean(me.email||me.name||me.role,200)||'system';
  for(const [serial,owners] of serialOwners){
    const jt=bySerial.get(serial);if(!jt)continue;
    if(owners.length!==1){conflicts.push({type:'duplicate-local-reference',serial,orderIds:owners.map(order=>order.id).slice(0,6)});continue;}
    const order=owners[0];if(matchedOrderIds.has(order.id))continue;matchedOrderIds.add(order.id);matched++;
    const result=await applyMatch(env,order,jt,actor);
    if(result.kind==='conflict'){conflicts.push(result);continue;}
    if(result.kind==='updated')updated++;else unchanged++;
    if(result.movedToShipped)movedToShipped++;
    if(result.enriched)enriched++;
  }
  notFound=results.filter(order=>!matchedOrderIds.has(order.id)).length;
  const nextOffset=offset+results.length,done=nextOffset>=total;
  await env.DB.prepare("UPDATE store_connections SET last_sync_at=?,last_error=NULL,updated_at=? WHERE id=? AND client_id=?").bind(now(),now(),connection.id,clientId).run().catch(()=>{});
  return json({ok:true,done,cursor:done?null:nextOffset,total,scanned:results.length,matched,updated,unchanged,movedToShipped,enriched,notFound,conflicts:conflicts.slice(0,20),provider:'jt',lookupMode:'known-order-references',message:done?'اكتملت مطابقة سجل J&T مع كل الأوردرات الموجودة في Kun Online.':'تمت معالجة دفعة من سجل J&T؛ تابع بالـcursor التالي لإكمال الباقي.'});
}

export async function handleJtHistoryReconcile({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(url.pathname!=='/api/jt/history/reconcile'||request.method!=='POST')return null;
  try{return await reconcileRoute(request,env,ctx,delegate);}catch(error){const raw=Number(error?.status),status=Number.isInteger(raw)&&raw>=400&&raw<=599?raw:500;return json({error:error?.message||'تعذر استيراد سجل J&T السابق',code:error?.code||'JT_HISTORY_RECONCILE_ERROR',jtCode:error?.jtCode||null},status);}
}

export const __jtHistoryReconcileInternals={collectJtOrders,normalizeJtOrder,identifiersFor,MAX_PAGE,JT_BATCH};
