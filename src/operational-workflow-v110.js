import {requirePermission,resolveTenant} from './access-control.js';
import {listMyStores} from './store-scope.js';
import {handleOperationalWorkflowV105} from './operational-workflow-v105.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const rid=prefix=>`${prefix}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}
function actorId(me){return clean(me?.uid||me?.id||me?.email||`${me?.role||'user'}:${me?.clientId||''}`,200);}
async function assertStoreAccess(env,me,clientId,storeId){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[];
  if(context.allStores)return;
  const row=stores.find(item=>String(item.id)===String(storeId||''));
  if(!row)throw Object.assign(new Error('الأوردر خارج المتاجر المسموح بها'),{status:403,code:'STORE_ISOLATION'});
  if(row.role==='viewer')throw Object.assign(new Error('صلاحية هذا المتجر للعرض فقط'),{status:403,code:'STORE_READ_ONLY'});
}
async function releaseContact({request,env,ctx,delegate,orderId,url}){
  const body=await request.clone().json().catch(()=>({})),me=await currentUser(request,env,ctx,delegate);
  requirePermission(me,'orders','update');
  const clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')||me?.clientId||null),mine=actorId(me);
  const row=await env.DB.prepare('SELECT id,client_id,store_id,state,contact_claim_user_id,contact_claim_name,contact_claimed_at FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  await assertStoreAccess(env,me,clientId,row.store_id||'');
  const owner=clean(row.contact_claim_user_id,200);
  if(!owner)return json({ok:true,orderId,state:row.state,released:false,alreadyReleased:true});
  if(owner!==mine)throw Object.assign(new Error(`الأوردر جاري التواصل عليه بواسطة ${row.contact_claim_name||'عضو آخر من الفريق'}`),{status:409,code:'ORDER_CONTACT_RELEASE_FORBIDDEN',claim:{userId:owner,name:row.contact_claim_name||'',claimedAt:row.contact_claimed_at||null}});
  const result=await env.DB.prepare("UPDATE orders SET state='pending',contact_claim_user_id=NULL,contact_claim_name=NULL,contact_claimed_at=NULL WHERE id=? AND client_id=? AND contact_claim_user_id=?").bind(orderId,clientId,mine).run();
  const released=Number(result?.meta?.changes||0)>0,at=new Date().toISOString();
  if(released){
    const metadata=JSON.stringify({previousState:row.state||'pending',returnState:'pending',contactedBy:row.contact_claim_name||''});
    try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(rid('AUD'),clientId,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.role||null,'order.contact_release','order',orderId,metadata,at).run();}catch{}
    try{await env.DB.prepare('INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(rid('OEV'),clientId,row.store_id||null,orderId,'contact_released',me?.uid||me?.id||null,me?.email||me?.role||null,'customer-service',metadata,at).run();}catch{}
  }
  return json({ok:true,orderId,state:'pending',previousState:row.state||'pending',released,returnedToPending:true});
}

export async function handleOperationalWorkflowV110(args){
  const {request}=args,url=new URL(request.url),match=url.pathname.match(/^\/api\/customer-service\/orders\/([^/]+)\/release-contact$/);
  if(match&&request.method.toUpperCase()==='POST'){
    try{return await releaseContact({...args,orderId:decodeURIComponent(match[1]),url});}
    catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'CONTACT_RELEASE_ERROR',...(error?.claim?{claim:error.claim}:{})},error?.status||500);}
  }
  return handleOperationalWorkflowV105(args);
}
