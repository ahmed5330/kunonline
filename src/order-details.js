import {readConnectionSecrets} from './integration-provider-validation.js';

const text=v=>String(v??'').trim();
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const list=v=>Array.isArray(v)?v:[];
const parseArr=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
const parseObj=v=>{try{const x=JSON.parse(v||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
const first=(...values)=>values.find(v=>v!==undefined&&v!==null&&v!=='');
const cleanPhone=v=>text(v).replace(/[^\d+]/g,'');

const OPTION_LABELS={
  color:'اللون',colour:'اللون','لون':'اللون',
  size:'المقاس','مقاس':'المقاس',
  material:'الخامة','خامة':'الخامة',
  style:'الستايل','ستايل':'الستايل'
};

function optionLabel(value){const raw=text(value),key=raw.toLowerCase();return OPTION_LABELS[key]||raw||'اختيار';}
function normalizeOptions(input=[]){
  return list(input).map(item=>({
    name:optionLabel(first(item?.variation,item?.name,item?.key,item?.label)),
    value:text(first(item?.variation_prop,item?.value,item?.option,item?.title))
  })).filter(x=>x.name&&x.value);
}
function optionsFromNote(note){
  const value=text(note);if(!value)return [];
  return value.split(/[،,|]/).map(part=>{
    const pair=part.split(/[:：]/);if(pair.length<2)return null;
    return {name:optionLabel(pair.shift()),value:text(pair.join(':'))};
  }).filter(Boolean).filter(x=>x.name&&x.value);
}
function firstImage(...candidates){
  for(const candidate of candidates){
    if(!candidate)continue;
    if(typeof candidate==='string'&&/^https?:\/\//i.test(candidate))return candidate;
    if(Array.isArray(candidate)){
      const found=firstImage(...candidate);if(found)return found;
      continue;
    }
    if(typeof candidate==='object'){
      const found=firstImage(candidate.src,candidate.url,candidate.image_url,candidate.imageUrl);if(found)return found;
    }
  }
  return null;
}
function unwrapProviderOrder(input){
  const root=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const candidates=[root.data?.order,root.order,root.data?.data,root.data,root.payload?.order,root.payload,root];
  return candidates.find(x=>x&&typeof x==='object'&&!Array.isArray(x))||{};
}
function normalizeProviderItem(item,index){
  const product=item?.product||{},variant=item?.variant||{},options=normalizeOptions(first(variant?.variation_props,variant?.variationProps,item?.variation_props,item?.options,[]));
  const quantity=Math.max(1,num(first(item?.quantity,item?.qty,1))),price=num(first(item?.price,item?.unit_price,product?.price,variant?.sale_price,variant?.price));
  return {
    id:text(first(item?.id,`${index+1}`)),
    productId:text(first(item?.product_id,item?.productId,product?.id))||null,
    variantId:text(first(item?.variant_id,item?.variantId,variant?.id))||null,
    name:text(first(product?.name,item?.product_name,item?.name,'منتج')),
    sku:text(first(product?.sku,product?.code,product?.taager_code,item?.sku))||null,
    variantSku:text(first(variant?.sku,variant?.code,variant?.taager_code))||null,
    quantity,
    price,
    lineTotal:price*quantity,
    image:firstImage(item?.image,item?.images,product?.image,product?.images,variant?.image,variant?.images),
    options,
    note:text(first(item?.note,item?.notes))||null
  };
}
function providerAddress(p={}){
  return {
    government:text(first(p.government,p.governorate,p.gov)),
    city:text(first(p.city,p.city_name,p.cityName)),
    area:text(first(p.area,p.district,p.zone,p.neighborhood,p.region)),
    street:text(first(p.street,p.street_name,p.streetName)),
    address:text(first(p.address,p.full_address,p.fullAddress)),
    building:text(first(p.building,p.building_no,p.buildingNo)),
    floor:text(first(p.floor,p.floor_no,p.floorNo)),
    apartment:text(first(p.apartment,p.apartment_no,p.apartmentNo)),
    landmark:text(first(p.landmark,p.nearby_landmark,p.nearbyLandmark)),
    postalCode:text(first(p.postal_code,p.postalCode,p.zip,p.zip_code))
  };
}
function providerCustomer(p={}){
  return {
    name:text(first(p.full_name,p.fullName,p.customer?.name,p.name)),
    phone:text(first(p.phone,p.customer?.phone)),
    alternatePhone:text(first(p.phone2,p.phone_2,p.alternate_phone,p.alternatePhone,p.customer?.alternate_phone)),
    email:text(first(p.email,p.customer?.email))
  };
}
function providerSummary(p={},items=[]){
  const subtotal=items.reduce((sum,item)=>sum+num(item.lineTotal),0);
  return {
    paymentMethod:text(first(p.payment_method,p.paymentMethod)),
    subtotal,
    shippingCost:num(first(p.shipping_cost,p.shippingCost)),
    discountAmount:num(first(p.discount_amount,p.discountAmount,p.discount)),
    total:num(first(p.total_cost,p.totalCost,p.total)),
    status:text(first(p.status,p.order_status,p.orderStatus))
  };
}
function normalizeProviderOrder(payload){
  const p=unwrapProviderOrder(payload),items=list(first(p.cart_items,p.cartItems,p.items)).map(normalizeProviderItem);
  return {rawId:text(first(p.id,p.order_id,p.orderId)),items,address:providerAddress(p),customer:providerCustomer(p),summary:providerSummary(p,items)};
}
function parseConfig(row){try{return JSON.parse(row?.config_json||'{}')}catch{return {};}}
function easyOrderId(order){const ref=text(order?.ref);if(/^easyorders:/i.test(ref))return ref.split(':').slice(1).join(':')||text(order?.id);return text(order?.id);}
function isEasyOrder(order){return /^easyorders:/i.test(text(order?.ref))||/easy\s*orders|easyorders|إيزي\s*أوردرز/i.test(text(order?.source));}

async function easyConnectionForOrder(env,order){
  const {results=[]}=await env.DB.prepare("SELECT * FROM store_connections WHERE client_id=? AND provider='easyorders' AND status='connected' ORDER BY updated_at DESC").bind(order.client_id).all();
  if(!results.length)return null;
  const exact=results.find(row=>{
    const config=parseConfig(row),bound=text(first(config.kunStoreId,config.storeId));
    return bound&&String(bound)===String(order.store_id||'');
  });
  return exact||results[0];
}
async function fetchEasyOrder(env,order,fetcher=fetch){
  const connection=await easyConnectionForOrder(env,order);if(!connection)return {data:null,warning:'ربط Easy Orders غير متاح حاليًا'};
  const secrets=await readConnectionSecrets(env,order.client_id,connection.id).catch(()=>({})),key=text(secrets.api_key);if(!key)return {data:null,warning:'مفتاح Easy Orders غير متاح لجلب التفاصيل الكاملة'};
  const id=encodeURIComponent(easyOrderId(order)),profiles=[
    {url:`https://api.easy-orders.net/api/v1/external-apps/orders/${id}`,headers:{'Api-Key':key}},
    {url:`https://api.easy-orders.net/v1/orders/${id}`,headers:{Authorization:`Bearer ${key}`}}
  ],errors=[];
  for(const profile of profiles){
    try{
      const response=await fetcher(profile.url,{method:'GET',headers:{Accept:'application/json',...profile.headers}}),payload=await response.json().catch(()=>null);
      if(response.ok&&payload)return {data:normalizeProviderOrder(payload),warning:null};
      errors.push(`HTTP ${response.status}`);
    }catch(error){errors.push(error?.message||String(error));}
  }
  return {data:null,warning:`تعذر تحديث تفاصيل Easy Orders الآن (${errors[0]||'provider unavailable'})`};
}

async function customerRecord(env,order){
  if(order.customer_id){
    const found=await env.DB.prepare('SELECT * FROM customers WHERE id=? AND client_id=?').bind(order.customer_id,order.client_id).first();if(found)return found;
  }
  if(order.phone){
    const found=await env.DB.prepare('SELECT * FROM customers WHERE client_id=? AND phone=? ORDER BY created_at LIMIT 1').bind(order.client_id,order.phone).first();if(found)return found;
  }
  return null;
}
async function customerStats(env,order,customer){
  const where=['client_id=?'],binds=[order.client_id];
  if(customer?.id){where.push('(customer_id=? OR (customer_id IS NULL AND phone=?))');binds.push(customer.id,order.phone||customer.phone||'');}
  else {where.push('phone=?');binds.push(order.phone||'');}
  if(order.store_id){where.push('store_id=?');binds.push(order.store_id);}
  const row=await env.DB.prepare(`SELECT COUNT(*) total_orders,
    SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered_orders,
    SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned_orders,
    SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled_orders,
    SUM(CASE WHEN state NOT IN ('cancelled','returned') THEN COALESCE(total,0) ELSE 0 END) total_spent,
    MIN(COALESCE(date,created_at)) first_order,MAX(COALESCE(date,created_at)) last_order
    FROM orders WHERE ${where.join(' AND ')}`).bind(...binds).first();
  return {
    totalOrders:Number(row?.total_orders||0),deliveredOrders:Number(row?.delivered_orders||0),returnedOrders:Number(row?.returned_orders||0),cancelledOrders:Number(row?.cancelled_orders||0),totalSpent:Number(row?.total_spent||0),firstOrder:row?.first_order||null,lastOrder:row?.last_order||null
  };
}
async function fallbackCatalogItem(env,order){
  let product=null,variant=null;
  if(order.product_id)product=await env.DB.prepare('SELECT id,name,sku,price FROM products WHERE id=? AND client_id=?').bind(order.product_id,order.client_id).first().catch(()=>null);
  if(order.variant_id)variant=await env.DB.prepare('SELECT id,name,sku,price FROM product_variants WHERE id=? AND client_id=?').bind(order.variant_id,order.client_id).first().catch(()=>null);
  const options=optionsFromNote(order.product_note),quantity=Math.max(1,num(order.qty||1)),price=num(first(order.unit_price,variant?.price,product?.price,quantity?num(order.total)/quantity:0));
  return {
    id:'1',productId:order.product_id||product?.id||null,variantId:order.variant_id||variant?.id||null,
    name:text(first(order.product,product?.name,'منتج')),
    sku:text(product?.sku)||null,variantSku:text(variant?.sku)||null,quantity,price,lineTotal:price*quantity,image:null,options,
    note:text(order.product_note)||null,variantName:text(variant?.name)||null
  };
}
function mergeAddress(provider,order,customer){
  return {
    government:text(first(provider?.government,order.gov,customer?.gov)),
    city:text(provider?.city),area:text(provider?.area),street:text(provider?.street),
    address:text(first(provider?.address,order.address,customer?.address)),
    building:text(provider?.building),floor:text(provider?.floor),apartment:text(provider?.apartment),landmark:text(provider?.landmark),postalCode:text(provider?.postalCode)
  };
}
function cleanTags(value){try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.map(text).filter(Boolean):[];}catch{return [];}}

export async function loadOrderDetails(env,{clientId,orderId,fetcher=fetch}){
  const order=await env.DB.prepare(`SELECT o.*,s.name store_name,s.code store_code FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE o.id=? AND o.client_id=?`).bind(orderId,clientId).first();
  if(!order)throw Object.assign(new Error('الأوردر غير موجود'),{status:404,code:'ORDER_NOT_FOUND'});
  const customer=await customerRecord(env,order),stats=await customerStats(env,order,customer),providerResult=isEasyOrder(order)?await fetchEasyOrder(env,order,fetcher):{data:null,warning:null},provider=providerResult.data;
  const items=provider?.items?.length?provider.items:[await fallbackCatalogItem(env,order)],customerBase=provider?.customer||{},summaryProvider=provider?.summary||{};
  const subtotal=items.reduce((sum,item)=>sum+num(item.lineTotal),0),shippingCost=num(first(summaryProvider.shippingCost,order.shipping_cost)),discountAmount=num(first(summaryProvider.discountAmount,order.discount_amount)),total=num(first(summaryProvider.total,order.total));
  return {
    ok:true,
    order:{
      id:order.id,ref:order.ref||null,date:order.date||order.created_at||null,createdAt:order.created_at||null,state:order.state||'pending',checkpoint:order.checkpoint||'',source:order.source||'',storeId:order.store_id||null,storeName:order.store_name||'',storeCode:order.store_code||'',awb:order.awb||'',couponCode:order.coupon_code||'',customerNote:order.note||'',productNote:order.product_note||''
    },
    items,
    customer:{
      id:customer?.id||order.customer_id||null,name:text(first(customerBase.name,order.name,customer?.name)),phone:cleanPhone(first(customerBase.phone,order.phone,customer?.phone)),alternatePhone:cleanPhone(customerBase.alternatePhone),email:text(customerBase.email),government:text(first(provider?.address?.government,order.gov,customer?.gov)),address:text(first(provider?.address?.address,order.address,customer?.address)),tags:cleanTags(customer?.tags),note:text(customer?.note),createdAt:customer?.created_at||stats.firstOrder||null,...stats
    },
    address:mergeAddress(provider?.address,order,customer),
    summary:{paymentMethod:text(summaryProvider.paymentMethod),subtotal:subtotal||Math.max(0,total-shippingCost+discountAmount),shippingCost,discountAmount,total,quantity:items.reduce((sum,item)=>sum+Math.max(1,num(item.quantity)),0)},
    history:parseArr(order.history),contactLog:parseArr(order.contact_log),
    provider:{id:isEasyOrder(order)?'easyorders':null,enriched:Boolean(provider),warning:providerResult.warning||null}
  };
}
