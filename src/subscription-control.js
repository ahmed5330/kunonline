import {
  subscriptionAccess,configureSubscription,startFreeTrial,endFreeTrial,listSubscriptionsAdmin,reconcileMonthlySubscriptions
} from './subscription-billing.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const text=v=>String(v??'').trim();

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}),env,ctx),data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:response.status||401,code:'AUTH_REQUIRED'});
  return data;
}
const requireAdmin=me=>{if(me?.role!=='admin')throw Object.assign(new Error('المسار متاح لإدارة Kun Online فقط'),{status:403,code:'ADMIN_ONLY'});};
const bodyOf=async request=>['POST','PUT','PATCH','DELETE'].includes(request.method.toUpperCase())?request.clone().json().catch(()=>({})):({});

function allowedWhileLocked(path,method){
  if(['/api/me','/api/logout','/api/navigation-access','/api/subscription/access','/api/tenant/features'].includes(path))return true;
  if(path==='/api/dashboard'||path.startsWith('/api/system/dashboard/')||path==='/api/accounting/collected-profit')return method==='GET';
  if(path==='/api/stores'||path==='/api/store-access')return method==='GET';
  if(path==='/api/integrations/meta-ads/expert-analysis')return method==='GET';
  if(path==='/api/wallet'||path==='/api/wallet/log')return method==='GET';
  if(path==='/api/wallet/topups')return method==='GET'||method==='POST';
  return false;
}

export async function handleSubscriptionControl({request,env,ctx,delegate}){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  if(!path.startsWith('/api/'))return null;
  if(['/api/login','/api/setup','/api/preview-admin-recovery'].includes(path))return null;
  try{
    const me=await currentUser(request,env,ctx,delegate);
    if(path==='/api/admin/subscriptions'&&method==='GET'){
      requireAdmin(me);return json({ok:true,clients:await listSubscriptionsAdmin(env,{limit:url.searchParams.get('limit')||500})});
    }
    let match=path.match(/^\/api\/admin\/subscriptions\/([^/]+)$/);
    if(match&&method==='PATCH'){
      requireAdmin(me);const clientId=decodeURIComponent(match[1]),body=await bodyOf(request);
      return json({ok:true,access:await configureSubscription(env,clientId,body,me.email||me.uid||'admin')});
    }
    match=path.match(/^\/api\/admin\/subscriptions\/([^/]+)\/(start-trial|end-trial|reconcile)$/);
    if(match&&method==='POST'){
      requireAdmin(me);const clientId=decodeURIComponent(match[1]),action=match[2],actor=me.email||me.uid||'admin';
      if(action==='start-trial')return json({ok:true,access:await startFreeTrial(env,clientId,{days:30,actor})});
      if(action==='end-trial')return json({ok:true,access:await endFreeTrial(env,clientId,{actor})});
      return json({ok:true,access:await subscriptionAccess(env,clientId,{applyMonthly:true})});
    }
    if(path==='/api/admin/subscriptions/reconcile'&&method==='POST'){
      requireAdmin(me);return json({ok:true,results:await reconcileMonthlySubscriptions(env,{limit:1000})});
    }
    if(me.role==='admin')return null;
    const clientId=text(me.clientId||me.client_id);if(!clientId)return null;
    const access=await subscriptionAccess(env,clientId,{applyMonthly:true});
    if(path==='/api/subscription/access'&&method==='GET')return json({ok:true,...access});
    if(access.locked&&!allowedWhileLocked(path,method)){
      return json({
        error:'الرصيد غير كافٍ لتشغيل هذا القسم. يمكنك فتح الداشبورد ورفع إثبات شحن الرصيد.',
        code:'SUBSCRIPTION_BALANCE_REQUIRED',
        access
      },402);
    }
    return null;
  }catch(error){
    if(path.startsWith('/api/admin/subscriptions')||path==='/api/subscription/access'){
      return json({error:error?.message||'تعذر تحميل حالة الاشتراك',code:error?.code||'SUBSCRIPTION_ERROR'},error?.status||500);
    }
    if(error?.code==='AUTH_REQUIRED')return null;
    throw error;
  }
}
