const EDITABLE_STATES=new Set(['pending','confirmed','preparing','deferred']);
const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
const parseArray=value=>{try{const data=JSON.parse(value||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
const stamp=()=>new Date().toISOString();
const fail=(message,status=400,code='ORDER_EDIT_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});

function productStoreAllowed(row,storeId){
  return !row?.store_id||String(row.store_id)===String(storeId||'');
}
function optionLabel(value){
  try{
    const parsed=JSON.parse(value||'{}');
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return Object.entries(parsed).map(([name,val])=>`${name}: ${val}`).join(' — ');
  }catch{}
  return '';
}
async function normalizeItems(env,{clientId,storeId,items}){
  if(!Array.isArray(items)||!items.length)fail('أضف منتجًا واحدًا على الأقل للطلب',400,'ORDER_ITEMS_REQUIRED');
  if(items.length>25)fail('الطلب لا يمكن أن يحتوي على أكثر من 25 بندًا',400,'ORDER_ITEMS_LIMIT');
  const normalized=[];
  for(let index=0;index<items.length;index++){
    const input=items[index]||{};let product=null,variant=null;
    let productId=clean(input.productId||input.product_id,120)||null,variantId=clean(input.variantId||input.variant_id,120)||null;
    if(variantId){
      variant=await env.DB.prepare(`SELECT v.*,p.name product_name,p.sku product_sku,p.store_id product_store_id FROM product_variants v JOIN products p ON p.id=v.product_id AND p.client_id=v.client_id WHERE v.id=? AND v.client_id=?`).bind(variantId,clientId).first();
      if(!variant||!productStoreAllowed(variant,storeId)||!productStoreAllowed({store_id:variant.product_store_id},storeId))fail('أحد اختيارات المنتج غير موجود في متجر الطلب',400,'ORDER_VARIANT_INVALID');
      productId=variant.product_id;
    }
    if(productId){
      product=await env.DB.prepare('SELECT * FROM products WHERE id=? AND client_id=?').bind(productId,clientId).first();
      if(!product||!productStoreAllowed(product,storeId))fail('أحد المنتجات غير موجود في متجر الطلب',400,'ORDER_PRODUCT_INVALID');
    }
    const productName=clean(input.productName||input.product_name||product?.name||variant?.product_name,300);
    if(!productName)fail(`اكتب اسم المنتج في البند ${index+1}`,400,'ORDER_ITEM_NAME_REQUIRED');
    const qty=Math.max(1,Math.floor(number(input.qty||input.quantity||1))),unitPrice=Math.max(0,number(input.unitPrice??input.unit_price??variant?.price??product?.price));
    const variantLabel=clean(input.variantLabel||input.variant_label||variant?.name||optionLabel(variant?.option_values_json),500);
    normalized.push({
      id:`OI-${crypto.randomUUID().slice(0,12).toUpperCase()}`,lineKey:`edited:${index+1}`,
      productId,variantId,sku:clean(input.sku||variant?.sku||product?.sku,160)||null,productName,variantLabel:variantLabel||null,
      qty,unitPrice,lineTotal:Number((qty*unitPrice).toFixed(2))
    });
  }
  return normalized;
}
function snapshot(row,items){
  return {name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',items,total:Number(row.total||0),couponCode:row.coupon_code||'',customerNote:row.note||''};
}
function changedFields(before,after){
  const labels={name:'اسم العميل',phone:'رقم الهاتف',gov:'المحافظة',address:'العنوان',items:'منتجات الطلب',total:'إجمالي الطلب',couponCode:'كود الخصم',customerNote:'ملاحظة العميل'};
  return Object.keys(labels).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])).map(key=>({key,label:labels[key]}));
}
async function existingItems(env,row){
  const {results=[]}=await env.DB.prepare('SELECT product_id,variant_id,sku,product_name,variant_label,qty,unit_price,line_total FROM order_items WHERE order_id=? AND client_id=? ORDER BY created_at,id').bind(row.id,row.client_id).all().catch(()=>({results:[]}));
  if(results.length)return results.map(x=>({productId:x.product_id||null,variantId:x.variant_id||null,sku:x.sku||null,productName:x.product_name||'',variantLabel:x.variant_label||null,qty:Number(x.qty||1),unitPrice:Number(x.unit_price||0),lineTotal:Number(x.line_total||0)}));
  return [{productId:row.product_id||null,variantId:row.variant_id||null,sku:null,productName:row.product||'',variantLabel:row.product_note||null,qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),lineTotal:Number(row.total||0)}];
}

export async function editCustomerServiceOrder(env,{clientId,orderId,body={},me,storeId=null}){
  const row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(!EDITABLE_STATES.has(row.state))fail('لا يمكن تعديل محتوى الطلب بعد خروجه للشحن. ارجعه لمرحلة ما قبل الشحن أولًا إذا كان ذلك صحيحًا تشغيليًا.',409,'ORDER_EDIT_STATE_LOCKED');
  const [legacyAllocation,itemAllocation]=await Promise.all([
    env.DB.prepare("SELECT order_id FROM order_stock_allocations WHERE order_id=? AND client_id=? AND status='allocated'").bind(orderId,clientId).first().catch(()=>null),
    env.DB.prepare("SELECT id FROM order_item_stock_allocations WHERE order_id=? AND client_id=? AND status='allocated' LIMIT 1").bind(orderId,clientId).first().catch(()=>null)
  ]);
  if(legacyAllocation||itemAllocation)fail('تعذر تعديل منتجات الطلب لأن مخزونًا خُصص له بالفعل',409,'ORDER_EDIT_STOCK_ALLOCATED');
  const items=await normalizeItems(env,{clientId,storeId:row.store_id||storeId,items:body.items});
  const before=snapshot(row,await existingItems(env,row));
  const name=clean(body.name,220),phone=clean(body.phone,80),gov=clean(body.gov,160),address=clean(body.address,1000);
  if(!name)fail('اسم العميل مطلوب',400,'ORDER_CUSTOMER_NAME_REQUIRED');
  if(!phone)fail('رقم هاتف العميل مطلوب',400,'ORDER_CUSTOMER_PHONE_REQUIRED');
  const subtotal=items.reduce((sum,item)=>sum+item.lineTotal,0),total=body.total===undefined?subtotal:Math.max(0,number(body.total));
  const first=items[0],after={name,phone,gov,address,items:items.map(({id,lineKey,...item})=>item),total,couponCode:clean(body.couponCode||body.coupon_code,100),customerNote:clean(body.customerNote??body.note,2000)};
  const fields=changedFields(before,after);if(!fields.length)fail('لم يتم تغيير أي بيانات في الطلب',400,'ORDER_EDIT_NO_CHANGES');
  const history=parseArray(row.history),at=stamp(),a=actor(me),event={type:'order_edit',fields,at,...a,note:`تم تعديل الطلب: ${fields.map(x=>x.label).join('، ')}`,before,after};history.push(event);
  const statements=[
    env.DB.prepare(`UPDATE orders SET name=?,phone=?,gov=?,address=?,product=?,product_id=?,variant_id=?,product_note=?,qty=?,unit_price=?,total=?,coupon_code=?,note=?,history=? WHERE id=? AND client_id=?`).bind(name,phone,gov||null,address||null,first.productName,first.productId,first.variantId,first.variantLabel,items.reduce((sum,item)=>sum+item.qty,0),first.unitPrice,total,after.couponCode||null,after.customerNote||null,JSON.stringify(history),orderId,clientId),
    env.DB.prepare('DELETE FROM order_items WHERE order_id=? AND client_id=?').bind(orderId,clientId)
  ];
  for(const item of items)statements.push(env.DB.prepare(`INSERT INTO order_items (id,order_id,client_id,store_id,line_key,product_id,variant_id,sku,product_name,variant_label,qty,unit_price,line_total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id,orderId,clientId,row.store_id||storeId||null,item.lineKey,item.productId,item.variantId,item.sku,item.productName,item.variantLabel,item.qty,item.unitPrice,item.lineTotal,at,at));
  await env.DB.batch(statements);
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,row.store_id||storeId||null,a.byUserId,a.by,'order.edit','order',orderId,JSON.stringify(before),JSON.stringify(after),JSON.stringify({source:'customer_service',fields:fields.map(x=>x.key)}),at).run();}catch{}
  return {ok:true,id:orderId,edited:true,editedAt:at,fields,history,total,items:after.items};
}

export const editableOrderStates=[...EDITABLE_STATES];
