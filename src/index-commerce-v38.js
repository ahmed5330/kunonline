import commerceV37 from './index-commerce-v37.js';
import {requirePermission} from './access-control.js';
import {listMyStores} from './store-scope.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const parseArray=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const PRINT_ROLES=new Set(['admin','client','ops','support']);

async function currentUser(request,env,ctx){const url=new URL(request.url);url.pathname='/api/me';url.search='';const response=await commerceV37.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),data=await response.json().catch(()=>({}));if(!response.ok||!data?.role){const status=!response.ok&&response.status>=400?response.status:401;throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status,code:'AUTH_REQUIRED'});}return data;}
function clientIdFor(me,request,body={}){const url=new URL(request.url),requested=clean(body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId,160);if(me.role==='client'){if(requested&&String(requested)!==String(me.clientId))throw Object.assign(new Error('مش مسموح الوصول لبيانات متجر آخر'),{status:403});return clean(me.clientId,160);}if(!requested)throw Object.assign(new Error('محتاج clientId'),{status:400});return requested;}
async function connectionFor(env,clientId){const row=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider='jt' ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'configured' THEN 1 ELSE 2 END,updated_at DESC,created_at DESC LIMIT 1").bind(clientId).first();if(!row)throw Object.assign(new Error('لا يوجد ربط J&T لهذا العميل'),{status:404});return {row,secrets:await readConnectionSecrets(env,clientId,row.id)};}
function authFailure(text=''){return /(auth|credential|customer\s*code|customer\s*password|customer\s*pwd|digest|signature|sign|account|password|unauthor|forbidden|permission|权限|密钥|签名|密码|客户)/i.test(text);}
async function attemptPath(path,label,payload,secrets){try{const result=await __jtApiInternals.signedPost(path,payload,secrets,{fetcher:fetch}),text=`${result.code} ${result.message}`;return {label,httpStatus:result.response.status,code:result.code||null,message:result.message||null,success:__jtApiInternals.success(result),credentialLikelyAccepted:__jtApiInternals.success(result)||(result.response.ok&&!authFailure(text))};}catch(error){return {label,httpStatus:error?.status||0,code:error?.code||null,message:clean(error?.message,600),success:false,credentialLikelyAccepted:false};}}
async function diagnose(request,env,ctx){if(env.APP_ENV!=='preview')return json({error:'Not found'},404);const me=await currentUser(request,env,ctx);requirePermission(me,'integrations','read');const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body),{row,secrets}=await connectionFor(env,clientId),{fields}=jtCredentials(secrets),serial=`KUN-AUTH-PROBE-${Date.now()}`,legacy=clean(secrets.api_key,500),createMode=body.mode==='create-auth';
  const base=createMode?{sourceCode:fields.sourceCode,orderType:'2',operateType:1}:{sourceCode:fields.sourceCode,command:1,serialNumber:[serial]};
  const variants=[{label:'developer-info-only',payload:base}];
  if(fields.customerCode&&fields.customerPassword)variants.push({label:'saved-business-info',payload:{...base,customerCode:fields.customerCode,digest:__jtApiInternals.businessDigest(fields.customerCode,fields.customerPassword,fields.privateKey)}});
  if(legacy){variants.push({label:'legacy-api-key-as-business-digest',payload:{...base,customerCode:fields.sourceCode,digest:legacy}});variants.push({label:'source-code-plus-legacy-api-key-password',payload:{...base,customerCode:fields.sourceCode,digest:__jtApiInternals.businessDigest(fields.sourceCode,legacy,fields.privateKey)}});variants.push({label:'api-account-plus-legacy-api-key-password',payload:{...base,customerCode:fields.apiAccount,digest:__jtApiInternals.businessDigest(fields.apiAccount,legacy,fields.privateKey)}});}
  const path=createMode?__jtApiInternals.ADD_ORDER_PATH:__jtApiInternals.GET_ORDERS_PATH,attempts=[];for(const variant of variants)attempts.push(await attemptPath(path,variant.label,variant.payload,secrets));return json({ok:true,mode:createMode?'create-auth-safe-invalid-payload':'get-orders',clientId,connectionId:row.id,connectionStatus:row.status,has:{apiAccount:Boolean(fields.apiAccount),privateKey:Boolean(fields.privateKey),sourceCode:Boolean(fields.sourceCode),customerCode:Boolean(fields.customerCode),customerPassword:Boolean(fields.customerPassword),legacyApiKey:Boolean(legacy)},attempts});}

function labelPrintStatus(row){
  const history=parseArray(row?.history),awb=clean(row?.awb,160);let shipmentIndex=-1,printedIndex=-1,printedEvent=null;
  history.forEach((event,index)=>{
    const type=clean(event?.type,120),eventAwb=clean(event?.awb,160);
    if(type==='jt_shipment_created'&&(!awb||!eventAwb||eventAwb===awb))shipmentIndex=index;
    if(type==='jt_label_printed'&&awb&&eventAwb===awb){printedIndex=index;printedEvent=event;}
  });
  const printed=Boolean(awb&&printedIndex>=0&&printedIndex>shipmentIndex);
  return {printed,status:printed?'printed':'unprinted',awb,printedAt:printed?printedEvent?.at||null:null,printedBy:printed?(printedEvent?.byName||printedEvent?.by||null):null};
}
async function printOrderForAccess(env,me,clientId,orderId,{write=false,storeId=''}={}){
  if(!PRINT_ROLES.has(me?.role))throw Object.assign(new Error('قسم الطباعة غير متاح لهذا الدور'),{status:403,code:'PRINT_ROLE_DENIED'});
  requirePermission(me,'orders',write?'update':'read');
  const row=await env.DB.prepare('SELECT id,client_id,store_id,state,awb,history FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  if(storeId&&String(storeId)!==String(row.store_id||''))throw Object.assign(new Error('المتجر لا يطابق متجر الأوردر'),{status:409,code:'STORE_MISMATCH'});
  const access=await listMyStores(env,me,clientId),stores=access.stores||[],ids=stores.map(store=>String(store.id));
  if(!access.allStores&&!ids.includes(String(row.store_id||'')))throw Object.assign(new Error('الأوردر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
  if(write&&!access.allStores){const store=stores.find(item=>String(item.id)===String(row.store_id||''));if(!store||store.role==='viewer')throw Object.assign(new Error('صلاحية هذا المتجر للعرض فقط'),{status:403,code:'STORE_READ_ONLY'});}
  return row;
}
async function labelPrintStatusRoute(request,env,me,orderId){
  const clientId=clientIdFor(me,request),storeId=clean(new URL(request.url).searchParams.get('storeId'),160),row=await printOrderForAccess(env,me,clientId,orderId,{write:false,storeId});
  return json({ok:true,orderId:row.id,...labelPrintStatus(row)});
}
async function markLabelPrintedRoute(request,env,me,orderId){
  const body=await request.clone().json().catch(()=>({})),clientId=clientIdFor(me,request,body),storeId=clean(body.storeId||body.store_id||new URL(request.url).searchParams.get('storeId'),160),row=await printOrderForAccess(env,me,clientId,orderId,{write:true,storeId}),awb=clean(row.awb,160);
  if(!awb)throw Object.assign(new Error('لا يمكن تأكيد الطباعة قبل وجود رقم بوليصة AWB'),{status:409,code:'PRINT_AWB_REQUIRED'});
  const requestedAwb=clean(body.awb,160);if(requestedAwb&&requestedAwb!==awb)throw Object.assign(new Error('رقم البوليصة تغيّر. حدّث قسم الطباعة واطبع البوليصة الجديدة أولًا.'),{status:409,code:'PRINT_AWB_CHANGED'});
  const current=labelPrintStatus(row);if(current.printed)return json({ok:true,idempotent:true,orderId:row.id,...current,message:'البوليصة مسجلة كمطبوعة بالفعل.'});
  const at=new Date().toISOString(),by=me?.email||me?.name||me?.role||'user',byName=me?.name||me?.email||me?.role||'user',byUserId=me?.uid||me?.id||null,entry={type:'jt_label_printed',at,provider:'jt',awb,by,byName,byUserId,confirmed:true,note:'تم تأكيد خروج البوليصة فعليًا من الطابعة'},eventId=`OEV-${crypto.randomUUID()}`;
  const array=`CASE WHEN json_valid(history) AND json_type(history)='array' THEN history ELSE '[]' END`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET history=json_insert(${array},'$[#]',json(?)) WHERE id=? AND client_id=?`).bind(JSON.stringify(entry),row.id,clientId),
    env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(eventId,clientId,row.store_id||null,row.id,'jt_label_printed',byUserId,by,'printing',JSON.stringify({awb,confirmed:true,note:entry.note}),at)
  ]);
  return json({ok:true,orderId:row.id,status:'printed',printed:true,awb,printedAt:at,printedBy:byName,message:'تم تسجيل البوليصة كمطبوعة ونقل الأوردر إلى Printed.'});
}

function jtErrorResponse(error){const raw=Number(error?.status),status=Number.isInteger(raw)&&raw>=400&&raw<=599?raw:500;return json({error:error?.message||'حدث خطأ في تكامل J&T',code:error?.code||'JT_ERROR',jtCode:error?.jtCode||null,enterpriseCredentialsRequired:Boolean(error?.enterpriseCredentialsRequired),missingSenderFields:Array.isArray(error?.missingSenderFields)?error.missingSenderFields:undefined,missingBusinessFields:Array.isArray(error?.missingBusinessFields)?error.missingBusinessFields:undefined},status);}
async function fetchV38(request,env,ctx){
  const url=new URL(request.url),isJtApi=url.pathname.startsWith('/api/jt/'),isJtWebhook=url.pathname.startsWith('/api/webhooks/jt/'),isJt=isJtApi||isJtWebhook;
  try{
    let me=null;if(isJtApi)me=await currentUser(request,env,ctx);
    if(url.pathname==='/api/jt/diagnostic'&&request.method==='POST')return await diagnose(request,env,ctx);
    const printed=url.pathname.match(/^\/api\/jt\/shipments\/([^/]+)\/printed$/);
    if(printed&&request.method==='GET')return await labelPrintStatusRoute(request,env,me,decodeURIComponent(printed[1]));
    if(printed&&request.method==='POST')return await markLabelPrintedRoute(request,env,me,decodeURIComponent(printed[1]));
    const response=await commerceV37.fetch(request,env,ctx);
    if(isJt&&response.status===200){const data=await response.clone().json().catch(()=>null);if(data?.code==='AUTH_REQUIRED')return json(data,401);}
    return response;
  }catch(error){if(isJt)return jtErrorResponse(error);throw error;}
}
export {SyncEntrypoint} from './index-commerce-v37.js';
export default {fetch:fetchV38,scheduled(controller,env,ctx){return commerceV37.scheduled?.(controller,env,ctx);}};
