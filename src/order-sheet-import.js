import {billOrder} from './wallet-billing.js';
import {reconcileManagementFeeForOrder} from './accounting.js';
import {syncImportedOrderItems,reconcileImportedOrderInventory} from './order-import-reconciliation.js';

const text=v=>String(v??'').trim(),now=()=>new Date().toISOString(),r2=v=>Math.round((Number(v)||0)*100)/100;
const SOURCES=new Set(['easyorders','woocommerce','shopify','salla','zid','custom']);
const STATUS={
  pending:'pending',new:'pending',on_hold:'pending','on-hold':'pending',awaiting:'pending',
  confirmed:'confirmed',accepted:'confirmed',paid:'confirmed',
  processing:'preparing',preparing:'preparing',packing:'preparing',
  shipped:'shipped',shipping:'shipped','out for delivery':'shipped','out_for_delivery':'shipped',
  delivered:'signed',completed:'signed',fulfilled:'signed',signed:'signed',
  collected:'collected',settled:'collected',
  returned:'returned',refunded:'returned',return:'returned',
  cancelled:'cancelled',canceled:'cancelled',failed:'cancelled',rejected:'cancelled',
  'جديد':'pending','قيد الانتظار':'pending','في انتظار التأكيد':'pending','جاري التأكيد':'pending','قيد التأكيد':'pending',
  'مؤكد':'confirmed','تم التأكيد':'confirmed','تم تأكيد الطلب':'confirmed',
  'جاري التجهيز':'preparing','التجهيز والتغليف':'preparing','قيد التجهيز':'preparing',
  'تم الشحن':'shipped','جاري الشحن':'shipped','قيد الشحن':'shipped',
  'تم التسليم':'signed','تم التوصيل':'signed','تم التحصيل':'collected',
  'مرتجع':'returned','تم الارتجاع':'returned','مسترجع':'returned',
  'ملغي':'cancelled','ملغى':'cancelled','تم إلغاء الطلب':'cancelled','تم الغاء الطلب':'cancelled'
};
const CHECKPOINT={pending:'جاري التأكيد',confirmed:'تم تأكيد الطلب',preparing:'جاري الشحن',shipped:'تم الشحن',signed:'تم التسليم — تحصيل منتظر',collected:'تم التحصيل',returned:'مرتجع',cancelled:'تم إلغاء الطلب'};
const OPTIONAL_PLACEHOLDER=v=>text(v)==='35'?'':text(v);
const safeSource=value=>{const v=text(value).toLowerCase();if(!SOURCES.has(v))throw Object.assign(new Error('مصدر الشيت غير مدعوم'),{status:400,code:'ORDER_IMPORT_SOURCE_INVALID'});return v;};
export function normalizeImportedState(value){
  const raw=text(value),v=raw.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();if(STATUS[v])return STATUS[v];if(STATUS[raw])return STATUS[raw];
  if(/مرتجع|استرجاع|refund|return/.test(v))return 'returned';
  if(/ملغ|الغاء|إلغاء|cancel|reject|fail/.test(v))return 'cancelled';
  if(/تحصيل|collect|settle/.test(v))return 'collected';
  if(/تسليم|توصيل|deliver|fulfill|signed/.test(v))return 'signed';
  if(/شحن|shipping|shipped|out for delivery/.test(v))return 'shipped';
  if(/تجهيز|تحضير|processing|prepar|pack/.test(v))return 'preparing';
  if(/مؤكد|تأكيد الطلب|confirm|accept|paid/.test(v))return 'confirmed';
  return 'pending';
}
const stateOf=normalizeImportedState;
const num=v=>{if(v===null||v===undefined||text(v)==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;};
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(text(v).slice(0,10))?text(v).slice(0,10):now().slice(0,10);
const createdStamp=(value,date)=>{const v=text(value),d=new Date(v);return v&&!Number.isNaN(d.getTime())?d.toISOString():`${date}T00:00:00.000Z`;};
function phone(raw){let d=text(raw).replace(/[^\d]/g,'');if(d.startsWith('0020'))d='0'+d.slice(4);else if(d.startsWith('20')&&d.length===12)d='0'+d.slice(2);else if(d.startsWith('00966'))d='0'+d.slice(5);else if(d.startsWith('966')&&d.length===12)d='0'+d.slice(3);return d||text(raw);}
function importRef(source,row,index){const external=OPTIONAL_PLACEHOLDER(row.externalId)||OPTIONAL_PLACEHOLDER(row.orderId)||OPTIONAL_PLACEHOLDER(row.externalOrderId)||OPTIONAL_PLACEHOLDER(row.platformId)||OPTIONAL_PLACEHOLDER(row.id);return external?`sheet:${source}:${external}`:`sheet:${source}:row-${index+1}-${crypto.randomUUID().slice(0,8)}`;}
function cleanNote(row,source){
  const note=text(row.note),meta=[];
  const add=(label,value)=>{const v=OPTIONAL_PLACEHOLDER(value);if(v)meta.push(`${label}: ${v}`);};
  add('رقم الشيت',row.platformId);add('هاتف بديل',row.altPhone);add('UTM Source',row.utmSource);add('UTM Campaign',row.utmCampaign);add('طريقة الدفع',row.paymentMethod);add('حالة الدفع',row.paymentStatus);add('Funnel ID',row.funnelId);add('Referral Code',row.referralCode);add('External Order ID',row.externalOrderId);add('Ref',row.originalRef);add('Extra Data',row.extraData);add('Extra Data 2',row.extraData2);
  const subtotal=num(row.platformProductSubtotal);if(subtotal!==null)meta.push(`قيمة المنتجات في ${source}: ${r2(subtotal)}`);
  return [note,meta.length?`[بيانات الاستيراد] ${meta.join(' | ')}`:''].filter(Boolean).join('\n').slice(0,4000);
}
async function findOrCreateCustomer(env,{clientId,storeId,name,rawPhone,gov,address}){
  const p=phone(rawPhone);if(!p)return null;
  const existing=await env.DB.prepare('SELECT id,name,gov,address FROM customers WHERE client_id=? AND store_id IS ? AND phone=? LIMIT 1').bind(clientId,storeId,p).first();
  if(existing){if((!existing.name&&name)||(!existing.gov&&gov)||(!existing.address&&address))await env.DB.prepare('UPDATE customers SET name=?,gov=?,address=? WHERE id=?').bind(existing.name||name||'',existing.gov||gov||'',existing.address||address||'',existing.id).run();return existing.id;}
  const id=`CUS-${crypto.randomUUID().slice(0,8).toUpperCase()}`;await env.DB.prepare('INSERT INTO customers (id,client_id,store_id,name,phone,gov,address,tags,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,clientId,storeId,name||'',p,gov||'',address||'','[]','',now()).run();return id;
}
async function catalogMap(env,clientId,storeId){
  const [products,variants]=await Promise.all([
    env.DB.prepare('SELECT id,name,sku,cost FROM products WHERE client_id=? AND (store_id=? OR store_id IS NULL)').bind(clientId,storeId).all(),
    env.DB.prepare(`SELECT v.id,v.product_id,v.name,v.sku,p.name product_name,p.cost FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.client_id=? AND (v.store_id=? OR v.store_id IS NULL) AND (p.store_id=? OR p.store_id IS NULL)`).bind(clientId,storeId,storeId).all()
  ]),map={productSku:new Map(),productName:new Map(),variantSku:new Map(),variantName:new Map()};
  for(const p of products.results||[]){if(text(p.sku))map.productSku.set(text(p.sku).toLowerCase(),p);if(text(p.name))map.productName.set(text(p.name).toLowerCase(),p);}
  for(const v of variants.results||[]){if(text(v.sku))map.variantSku.set(text(v.sku).toLowerCase(),v);if(text(v.product_name)&&text(v.name))map.variantName.set(`${text(v.product_name).toLowerCase()}::${text(v.name).toLowerCase()}`,v);}
  return map;
}
function rawItems(row){
  const source=Array.isArray(row.items)&&row.items.length?row.items:[{lineKey:row.lineKey,product:row.product,variant:row.productNote,qty:row.qty,sku:row.sku,unitPrice:row.unitPrice,lineTotal:row.lineTotal}];
  const merged=new Map();for(let i=0;i<source.length;i++){const x=source[i]||{},product=OPTIONAL_PLACEHOLDER(x.product||x.productName),variant=OPTIONAL_PLACEHOLDER(x.variant||x.variantLabel||x.productNote),sku=OPTIONAL_PLACEHOLDER(x.sku).split(',')[0].trim(),qty=Math.max(1,Number(x.qty)||1),unitPrice=num(x.unitPrice)||0;if(!product&&!sku)continue;const base=text(x.lineKey)||`${sku.toLowerCase()}::${product.toLowerCase()}::${variant.toLowerCase()}`,key=base||`line-${i+1}`,old=merged.get(key);if(old){old.qty+=qty;old.lineTotal=r2(old.lineTotal+(num(x.lineTotal)||unitPrice*qty));}else merged.set(key,{lineKey:key,product,variantLabel:variant,sku,qty,unitPrice,lineTotal:r2(num(x.lineTotal)||unitPrice*qty)});}return [...merged.values()];
}
function catalogMatch(catalog,item){
  const sku=text(item.sku).toLowerCase();if(sku&&catalog.variantSku.has(sku)){const v=catalog.variantSku.get(sku);return {productId:v.product_id,variantId:v.id,productName:v.product_name,variantLabel:item.variantLabel||v.name,cost:Number(v.cost)||0};}
  if(sku&&catalog.productSku.has(sku)){const p=catalog.productSku.get(sku);return {productId:p.id,variantId:null,productName:p.name,variantLabel:item.variantLabel||'',cost:Number(p.cost)||0};}
  const product=text(item.product).toLowerCase(),variant=text(item.variantLabel).toLowerCase();if(product&&variant&&catalog.variantName.has(`${product}::${variant}`)){const v=catalog.variantName.get(`${product}::${variant}`);return {productId:v.product_id,variantId:v.id,productName:v.product_name,variantLabel:item.variantLabel||v.name,cost:Number(v.cost)||0};}
  if(product&&catalog.productName.has(product)){const p=catalog.productName.get(product);return {productId:p.id,variantId:null,productName:p.name,variantLabel:item.variantLabel||'',cost:Number(p.cost)||0};}
  return null;
}
function resolveItems(catalog,row){return rawItems(row).map(item=>{const match=catalogMatch(catalog,item);return {...item,productId:match?.productId||null,variantId:match?.variantId||null,productName:match?.productName||item.product,variantLabel:match?.variantLabel||item.variantLabel,cost:match?.cost||0};});}
async function existingOrder(env,{clientId,storeId,source,row,ref}){
  const candidates=[ref];
  if(source==='easyorders'){
    for(const v of [row.externalId,row.orderId,row.externalOrderId,row.platformId,row.id]){const x=OPTIONAL_PLACEHOLDER(v);if(x){candidates.push(`easyorders:${x}`);candidates.push(`sheet:easyorders:${x}`);}}
  }
  const uniq=[...new Set(candidates.filter(Boolean))];
  if(uniq.length){const placeholders=uniq.map(()=>'?').join(','),found=await env.DB.prepare(`SELECT id,ref,state,history FROM orders WHERE client_id=? AND store_id IS ? AND ref IN (${placeholders}) LIMIT 1`).bind(clientId,storeId,...uniq).first();if(found)return found;}
  for(const v of source==='easyorders'?[row.externalId,row.orderId,row.platformId]:[]){const id=OPTIONAL_PLACEHOLDER(v);if(!id)continue;const found=await env.DB.prepare('SELECT id,ref,state,history FROM orders WHERE id=? AND client_id=? AND store_id IS ? LIMIT 1').bind(id,clientId,storeId).first();if(found)return found;}
  return null;
}
function historyOf(value){try{const x=JSON.parse(value||'[]');return Array.isArray(x)?x:[]}catch{return []}}
async function audit(env,{clientId,storeId,actor,source,result}){try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,storeId,actor?.uid||null,actor?.email||actor?.role||'user','orders.sheet_import','order_import',null,JSON.stringify({source,...result}),now()).run();}catch{}}

export function orderSheetSources(){return [
  {id:'easyorders',label:'Easy Orders'},{id:'woocommerce',label:'WooCommerce'},{id:'shopify',label:'Shopify'},{id:'salla',label:'سلة'},{id:'zid',label:'زد'},{id:'custom',label:'شيت مخصص'}
];}

export async function importOrderSheet(env,{clientId,storeId,source,rows,actor}){
  source=safeSource(source);if(!storeId)throw Object.assign(new Error('حدد المتجر/الفرع الذي يخصه الشيت قبل الاستيراد'),{status:400,code:'ORDER_IMPORT_STORE_REQUIRED'});
  rows=Array.isArray(rows)?rows.slice(0,2000):[];if(!rows.length)throw Object.assign(new Error('الملف فاضي'),{status:400,code:'ORDER_IMPORT_EMPTY'});
  const catalog=await catalogMap(env,clientId,storeId),result={created:0,updated:0,skipped:0,costed:0,noCost:0,billingPending:0,lineItems:0,managementReconciled:0,stockAllocated:0,stockRestored:0,stockShortageOrders:0,stockShortages:[],errors:[]};
  for(let index=0;index<rows.length;index++){
    const r=rows[index]||{},name=text(r.name),rawPhone=text(r.phone),externalId=OPTIONAL_PLACEHOLDER(r.externalId)||OPTIONAL_PLACEHOLDER(r.orderId)||OPTIONAL_PLACEHOLDER(r.platformId);
    if(!name||!rawPhone){result.skipped++;if(result.errors.length<20)result.errors.push({row:index+2,error:!name?'اسم العميل مفقود':'رقم الهاتف مفقود'});continue;}
    try{
      const ref=importRef(source,r,index),old=await existingOrder(env,{clientId,storeId,source,row:r,ref}),state=stateOf(r.state||r.status),date=day(r.date),stamp=createdStamp(r.createdAt,date),items=resolveItems(catalog,r),qty=Math.max(1,items.reduce((s,x)=>s+Number(x.qty||0),0)||Number(r.qty)||1),productCost=r2(items.reduce((s,x)=>s+(Number(x.cost)||0)*Math.max(1,Number(x.qty)||1),0)),single=items.length===1?items[0]:null,customerId=await findOrCreateCustomer(env,{clientId,storeId,name,rawPhone,gov:text(r.gov),address:text(r.address)}),history=historyOf(old?.history),coupon=OPTIONAL_PLACEHOLDER(r.coupon),couponDiscount=coupon?(num(r.couponDiscount)||0):0;
      if(!history.length)history.push({state,at:stamp,source:`sheet:${source}`});else if(old?.state!==state)history.push({state,at:now(),source:`sheet:${source}`,note:'تحديث حالة من استيراد الشيت'});
      const values={name,phone:phone(rawPhone),gov:text(r.gov),address:text(r.address),product:items.map(x=>x.productName+(x.variantLabel?` — ${x.variantLabel}`:'')).join(' + ')||text(r.product),productId:single?.productId||null,variantId:single?.variantId||null,productNote:items.map(x=>x.variantLabel).filter(Boolean).join(' | ')||OPTIONAL_PLACEHOLDER(r.productNote),unitPrice:single?.unitPrice||num(r.unitPrice)||0,qty,total:num(r.total)||0,coupon,couponDiscount,productCost,shippingCost:num(r.shippingCost),otherCost:num(r.otherCost),note:cleanNote(r,source),awb:OPTIONAL_PLACEHOLDER(r.awb),date,state,checkpoint:CHECKPOINT[state]||state,customerId,history:JSON.stringify(history),ref,externalId};
      let orderId;
      if(old){
        orderId=old.id;await env.DB.prepare(`UPDATE orders SET customer_id=?,date=?,name=?,phone=?,gov=?,address=?,product=?,product_id=?,variant_id=?,product_note=?,unit_price=?,qty=?,total=?,discount_amount=?,coupon_code=?,product_cost=?,shipping_cost=?,other_cost=?,source=?,note=?,awb=COALESCE(?,awb),state=?,checkpoint=?,signed_at=CASE WHEN ? IN ('signed','collected') THEN COALESCE(signed_at,?) ELSE signed_at END,collected_at=CASE WHEN ?='collected' THEN COALESCE(collected_at,?) ELSE collected_at END,history=? WHERE id=? AND client_id=? AND store_id IS ?`).bind(values.customerId,values.date,values.name,values.phone,values.gov,values.address,values.product,values.productId,values.variantId,values.productNote,values.unitPrice,values.qty,values.total,values.couponDiscount,values.coupon||null,values.productCost,values.shippingCost,values.otherCost,`شيت ${source}`,values.note,values.awb||null,values.state,values.checkpoint,values.state,values.date,values.state,values.date,values.history,old.id,clientId,storeId).run();result.updated++;
      }else{
        orderId=`IMP-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
        await env.DB.prepare(`INSERT INTO orders (id,client_id,store_id,ref,customer_id,date,name,phone,gov,address,product,product_id,variant_id,product_note,unit_price,qty,total,discount_amount,coupon_code,product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,defer_until,refund_amount,return_type,restocked,contact_log,history,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderId,clientId,storeId,values.ref,values.customerId,values.date,values.name,values.phone,values.gov,values.address,values.product,values.productId,values.variantId,values.productNote,values.unitPrice,values.qty,values.total,values.couponDiscount,values.coupon||null,values.productCost,values.shippingCost,values.otherCost,`شيت ${source}`,values.note,values.awb||null,values.state,values.checkpoint,['signed','collected'].includes(values.state)?values.date:null,values.state==='collected'?values.date:null,null,null,null,0,'[]',values.history,stamp).run();
        result.created++;try{const billed=await billOrder(env,orderId);if(billed?.ok===false)result.billingPending++;}catch{result.billingPending++;}
      }
      const persisted=await syncImportedOrderItems(env,{orderId,clientId,storeId,items});result.lineItems+=persisted.filter(x=>Number(x.qty)>0).length;
      try{await reconcileManagementFeeForOrder(env,orderId);result.managementReconciled++;}catch(error){if(result.errors.length<20)result.errors.push({row:index+2,externalId,error:`الحسابات: ${text(error?.message||error)}`});}
      try{const stock=await reconcileImportedOrderInventory(env,{orderId,clientId,source:`شيت ${source}`,actor});result.stockAllocated+=Number(stock.allocated)||0;result.stockRestored+=Number(stock.restored)||0;if(stock.shortages?.length){result.stockShortageOrders++;for(const shortage of stock.shortages){if(result.stockShortages.length<20)result.stockShortages.push({row:index+2,externalId,...shortage});}}}catch(error){result.stockShortageOrders++;if(result.stockShortages.length<20)result.stockShortages.push({row:index+2,externalId,reason:text(error?.message||error)});}
      if(productCost>0)result.costed++;else result.noCost++;
    }catch(error){result.skipped++;if(result.errors.length<20)result.errors.push({row:index+2,externalId,error:text(error?.message||error).slice(0,220)});}
  }
  await audit(env,{clientId,storeId,actor,source,result});return {ok:true,source,rows:rows.length,...result};
}
