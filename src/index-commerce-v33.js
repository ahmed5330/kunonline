import commerceV32 from './index-commerce-v32.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {editCustomerServiceOrder} from './order-edit.js';
import {loadEditableOrderDetails} from './order-edit-details.js';
import {listDetailedProducts,loadDetailedProduct,saveDetailedProduct} from './product-management.js';
import {postShippingBoard,markPostShippingDelivered,collectPostShippingOrder} from './post-shipping.js';
import {reconcileManagementFeeForOrder} from './accounting.js';

const BUILD='preview-v33-2026-08-30-order-edit-detailed-products';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Kun-Build':BUILD,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
async function currentUser(request,env,ctx){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await commerceV32.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx),me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:(response.status||401),code:'AUTH_REQUIRED'});return me;
}
async function productScope(request,env,me,clientId,{write=false,body=null}={}){
  return resolveStoreScope(env,me,clientId,requestedStoreId(request,body),{write});
}
async function scopedProduct(env,me,clientId,productId,{write=false}={}){
  const row=await env.DB.prepare('SELECT store_id FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
  if(!row)throw Object.assign(new Error('المنتج غير موجود'),{status:404,code:'PRODUCT_NOT_FOUND'});
  const scope=await resolveStoreScope(env,me,clientId,row.store_id||null,{write});return {row,scope};
}

async function fetchV33(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v33.js'});
    if(path==='/api/post-shipping'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','read');const clientId=resolveTenant(me,url.searchParams.get('clientId'));return json(await postShippingBoard(env,{clientId,me,selectedStoreId:url.searchParams.get('storeId')||''}));
    }
    const postShippingAction=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/(delivered|collect)$/);
    if(postShippingAction&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),orderId=decodeURIComponent(postShippingAction[1]);let result;
      if(postShippingAction[2]==='delivered')result=await markPostShippingDelivered(env,{clientId,orderId,me});else {result=await collectPostShippingOrder(env,{clientId,orderId,amount:body.amount,me});await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});}return json(result);
    }
    const detailsMatch=path.match(/^\/api\/orders\/([^/]+)\/details$/);
    if(detailsMatch&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),orderId=decodeURIComponent(detailsMatch[1]);
      const row=await env.DB.prepare('SELECT store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
      await resolveStoreScope(env,me,clientId,row.store_id||null,{write:false});return json(await loadEditableOrderDetails(env,{clientId,orderId}));
    }
    const editMatch=path.match(/^\/api\/customer-service\/orders\/([^/]+)\/edit$/);
    if(editMatch&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),orderId=decodeURIComponent(editMatch[1]);
      const row=await env.DB.prepare('SELECT store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!row)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
      const scope=await resolveStoreScope(env,me,clientId,row.store_id||null,{write:true});return json(await editCustomerServiceOrder(env,{clientId,orderId,body,me,storeId:scope.storeId||null}));
    }
    if(path==='/api/catalog/products'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),scope=await productScope(request,env,me,clientId);
      return json({ok:true,products:await listDetailedProducts(env,{clientId,storeId:scope.storeId||null})});
    }
    const productDetails=path.match(/^\/api\/products\/([^/]+)\/details$/);
    if(productDetails&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),productId=decodeURIComponent(productDetails[1]);await scopedProduct(env,me,clientId,productId);return json({ok:true,product:await loadDetailedProduct(env,{clientId,productId})});
    }
    if(path==='/api/products'&&method==='POST'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','create');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),scope=await productScope(request,env,me,clientId,{write:true,body});
      return json({ok:true,product:await saveDetailedProduct(env,{clientId,storeId:scope.storeId||null,body,me})},201);
    }
    const productEdit=path.match(/^\/api\/products\/([^/]+)$/);
    if(productEdit&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),productId=decodeURIComponent(productEdit[1]),{scope}=await scopedProduct(env,me,clientId,productId,{write:true});
      return json({ok:true,product:await saveDetailedProduct(env,{clientId,storeId:scope.storeId||null,productId,body,me})});
    }
    return commerceV32.fetch(request,env,ctx);
  }catch(error){return json({error:error?.message||'حدث خطأ',code:error?.code||'COMMERCE_V33_ERROR',path,method},error?.status||500);}
}

export default {fetch:fetchV33,scheduled(controller,env,ctx){return commerceV32.scheduled?.(controller,env,ctx);}};
