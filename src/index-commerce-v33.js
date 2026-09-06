import commerceV32 from './index-commerce-v32.js';
import {requirePermission,resolveTenant} from './access-control.js';
import {resolveStoreScope,requestedStoreId} from './store-scope.js';
import {editCustomerServiceOrder} from './order-edit.js';
import {loadEditableOrderDetails} from './order-edit-details.js';
import {listDetailedProducts,loadDetailedProduct,saveDetailedProduct} from './product-management.js';
import {postShippingBoardV47,markPostShippingDeliveredV47,startPostShippingCollectionV47,collectPostShippingOrderV47} from './post-shipping-v47.js';
import {collectedProfitOverview} from './collected-profit.js';
import {reconcileManagementFeeForOrder} from './accounting.js';

const BUILD='preview-v33-2026-09-01-inventory-price-cost-edit';
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
async function updateInventorySellingPrice(env,{clientId,storeId=null,productId,variantId=null,price,me}){
  const value=Number(price);if(!Number.isFinite(value)||value<0)throw Object.assign(new Error('اكتب سعر بيع صحيح أكبر من أو يساوي صفر'),{status:400,code:'PRODUCT_PRICE_INVALID'});
  productId=String(productId||'').trim();variantId=String(variantId||'').trim()||null;if(!productId)throw Object.assign(new Error('حدد المنتج أولًا'),{status:400,code:'PRODUCT_ID_REQUIRED'});
  const product=await env.DB.prepare('SELECT id,store_id,name,price,compare_at_price FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();if(!product)throw Object.assign(new Error('المنتج غير موجود'),{status:404,code:'PRODUCT_NOT_FOUND'});
  if(storeId&&String(product.store_id||'')!==String(storeId))throw Object.assign(new Error('المنتج خارج المتجر المحدد'),{status:403,code:'PRODUCT_STORE_ISOLATION'});
  await resolveStoreScope(env,me,clientId,product.store_id||null,{write:true});
  const ts=new Date().toISOString();let previousPrice,compareAtPrice,entityId=productId,entityType='product';
  if(variantId){
    const variant=await env.DB.prepare('SELECT id,price,compare_at_price FROM product_variants WHERE id=? AND product_id=? AND client_id=? AND store_id IS ?').bind(variantId,productId,clientId,product.store_id||null).first();if(!variant)throw Object.assign(new Error('المتغير غير موجود أو لا يتبع هذا المنتج'),{status:404,code:'PRODUCT_VARIANT_NOT_FOUND'});
    previousPrice=variant.price===null?null:Number(variant.price);compareAtPrice=variant.compare_at_price===null?null:Number(variant.compare_at_price);const nextCompare=compareAtPrice!==null&&compareAtPrice>value?compareAtPrice:null;
    await env.DB.prepare('UPDATE product_variants SET price=?,compare_at_price=?,updated_at=? WHERE id=? AND product_id=? AND client_id=?').bind(value,nextCompare,ts,variantId,productId,clientId).run();compareAtPrice=nextCompare;entityId=variantId;entityType='product_variant';
  }else{
    previousPrice=Number(product.price||0);compareAtPrice=product.compare_at_price===null?null:Number(product.compare_at_price);const nextCompare=compareAtPrice!==null&&compareAtPrice>value?compareAtPrice:null;
    await env.DB.prepare('UPDATE products SET price=?,compare_at_price=?,updated_at=? WHERE id=? AND client_id=?').bind(value,nextCompare,ts,productId,clientId).run();compareAtPrice=nextCompare;
  }
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,product.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user','inventory.price_edit',entityType,entityId,JSON.stringify({price:previousPrice}),JSON.stringify({price:value,compareAtPrice}),JSON.stringify({productId,variantId,source:'inventory'}),ts).run();}catch{}
  return {ok:true,productId,variantId,price:value,previousPrice,compareAtPrice,source:'manual-inventory'};
}
async function updateInventoryUnitCost(env,{clientId,storeId=null,productId,variantId=null,cost,me}){
  const value=Number(cost);if(!Number.isFinite(value)||value<0)throw Object.assign(new Error('اكتب تكلفة صحيحة أكبر من أو تساوي صفر'),{status:400,code:'PRODUCT_COST_INVALID'});
  productId=String(productId||'').trim();variantId=String(variantId||'').trim()||null;if(!productId)throw Object.assign(new Error('حدد المنتج أولًا'),{status:400,code:'PRODUCT_ID_REQUIRED'});
  const product=await env.DB.prepare('SELECT id,store_id,name,cost FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();if(!product)throw Object.assign(new Error('المنتج غير موجود'),{status:404,code:'PRODUCT_NOT_FOUND'});
  if(storeId&&String(product.store_id||'')!==String(storeId))throw Object.assign(new Error('المنتج خارج المتجر المحدد'),{status:403,code:'PRODUCT_STORE_ISOLATION'});
  await resolveStoreScope(env,me,clientId,product.store_id||null,{write:true});
  const ts=new Date().toISOString();let previousCost,entityId=productId,entityType='product';
  if(variantId){
    const variant=await env.DB.prepare('SELECT id,cost FROM product_variants WHERE id=? AND product_id=? AND client_id=? AND store_id IS ?').bind(variantId,productId,clientId,product.store_id||null).first();if(!variant)throw Object.assign(new Error('المتغير غير موجود أو لا يتبع هذا المنتج'),{status:404,code:'PRODUCT_VARIANT_NOT_FOUND'});
    previousCost=variant.cost===null?null:Number(variant.cost);await env.DB.prepare('UPDATE product_variants SET cost=?,updated_at=? WHERE id=? AND product_id=? AND client_id=?').bind(value,ts,variantId,productId,clientId).run();entityId=variantId;entityType='product_variant';
  }else{
    previousCost=Number(product.cost||0);await env.DB.prepare('UPDATE products SET cost=?,updated_at=? WHERE id=? AND client_id=?').bind(value,ts,productId,clientId).run();
  }
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,product.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user','inventory.cost_edit',entityType,entityId,JSON.stringify({cost:previousCost}),JSON.stringify({cost:value}),JSON.stringify({productId,variantId,source:'inventory-products'}),ts).run();}catch{}
  return {ok:true,productId,variantId,cost:value,previousCost,source:'manual-cost-edit'};
}

async function fetchV33(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/preview/version'&&method==='GET')return json({ok:true,build:BUILD,environment:env.APP_ENV||'unknown',entrypoint:'index-commerce-v33.js'});
    if(path==='/api/post-shipping'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','read');const clientId=resolveTenant(me,url.searchParams.get('clientId'));return json(await postShippingBoardV47(env,{clientId,me,selectedStoreId:url.searchParams.get('storeId')||''}));
    }
    const postShippingAction=path.match(/^\/api\/post-shipping\/orders\/([^/]+)\/(delivered|collecting|collect)$/);
    if(postShippingAction&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'orders','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId')),orderId=decodeURIComponent(postShippingAction[1]);let result;
      if(postShippingAction[2]==='delivered')result=await markPostShippingDeliveredV47(env,{clientId,orderId,me});
      else if(postShippingAction[2]==='collecting')result=await startPostShippingCollectionV47(env,{clientId,orderId,me});
      else {result=await collectPostShippingOrderV47(env,{clientId,orderId,amount:body.amount,me});await reconcileManagementFeeForOrder(env,orderId).catch(()=>{});}return json(result);
    }
    if(path==='/api/accounting/collected-profit'&&method==='GET'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'analytics','read');const clientId=resolveTenant(me,url.searchParams.get('clientId')),scope=await resolveStoreScope(env,me,clientId,url.searchParams.get('storeId')||null,{write:false});
      return json(await collectedProfitOverview(env,{clientId,storeId:scope.storeId||null,from:url.searchParams.get('from'),to:url.searchParams.get('to'),includeDetails:url.searchParams.get('details')==='1'}));
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
    if(path==='/api/inventory/price'&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId'));
      return json(await updateInventorySellingPrice(env,{clientId,storeId:body.storeId||body.store_id||url.searchParams.get('storeId')||null,productId:body.productId||body.product_id,variantId:body.variantId||body.variant_id||null,price:body.price,me}));
    }
    if(path==='/api/inventory/cost'&&method==='PATCH'){
      const me=await currentUser(request,env,ctx);requirePermission(me,'products','update');const body=await request.clone().json().catch(()=>({})),clientId=resolveTenant(me,body.clientId||body.client_id||url.searchParams.get('clientId'));
      return json(await updateInventoryUnitCost(env,{clientId,storeId:body.storeId||body.store_id||url.searchParams.get('storeId')||null,productId:body.productId||body.product_id,variantId:body.variantId||body.variant_id||null,cost:body.cost,me}));
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
