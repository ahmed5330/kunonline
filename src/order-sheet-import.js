import {billOrder} from './wallet-billing.js';

const text=v=>String(v??'').trim(),now=()=>new Date().toISOString(),r2=v=>Math.round((Number(v)||0)*100)/100;
const SOURCES=new Set(['easyorders','woocommerce','shopify','salla','zid','custom']);
const STATUS={
  pending:'pending',new:'pending',on_hold:'pending','on-hold':'pending',
  confirmed:'confirmed',paid:'confirmed',processing:'preparing',preparing:'preparing',
  shipped:'shipped',shipping:'shipped',delivered:'signed',completed:'signed',fulfilled:'signed',
  collected:'collected',returned:'returned',refunded:'returned',cancelled:'cancelled',canceled:'cancelled',failed:'cancelled',rejected:'cancelled',
  'جديد':'pending','قيد الانتظار':'pending','مؤكد':'confirmed','تم التأكيد':'confirmed','جاري التجهيز':'preparing','تم الشحن':'shipped','تم التسليم':'signed','تم التحصيل':'collected','مرتجع':'returned','ملغي':'cancelled'
};
const CHECKPOINT={pending:'جاري التأكيد',confirmed:'تم تأكيد الطلب',preparing:'جاري الشحن',shipped:'تم الشحن',signed:'تم التسليم — تحصيل منتظر',collected:'تم التحصيل',returned:'مرتجع',cancelled:'تم إلغاء الطلب'};
const OPTIONAL_PLACEHOLDER=v=>text(v)==='35'?'':text(v);
const safeSource=value=>{const v=text(value).toLowerCase();if(!SOURCES.has(v))throw Object.assign(new Error('مصدر الشيت غير مدعوم'),{status:400,code:'ORDER_IMPORT_SOURCE_INVALID'});return v;};
const stateOf=value=>STATUS[text(value).toLowerCase()]||STATUS[text(value)]||'pending';
const num=v=>{if(v===null||v===undefined||text(v)==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;};
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(text(v).slice(0,10))?text(v).slice(0,10):now().slice(0,10);
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
  const {results=[]}=await env.DB.prepare('SELECT id,name,sku,cost FROM products WHERE client_id=? AND (store_id=? OR store_id IS NULL)').bind(clientId,storeId).all(),map=new Map();
  for(const p of results){if(text(p.sku))map.set(`sku:${text(p.sku).toLowerCase()}`,p);if(text(p.name))map.set(`name:${text(p.name).toLowerCase()}`,p);}return map;
}
function catalogMatch(map,row){const sku=OPTIONAL_PLACEHOLDER(row.sku).split(',')[0].trim().toLowerCase();if(sku&&map.has(`sku:${sku}`))return map.get(`sku:${sku}`);const name=text(row.product).split(' — ')[0].split(' + ')[0].trim().toLowerCase();return name?map.get(`name:${name}`)||null:null;}
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
  const products=await catalogMap(env,clientId,storeId),result={created:0,updated:0,skipped:0,costed:0,noCost:0,billingPending:0,errors:[]};
  for(let index=0;index<rows.length;index++){
    const r=rows[index]||{},name=text(r.name),rawPhone=text(r.phone),externalId=OPTIONAL_PLACEHOLDER(r.externalId)||OPTIONAL_PLACEHOLDER(r.orderId)||OPTIONAL_PLACEHOLDER(r.platformId);
    if(!name||!rawPhone){result.skipped++;if(result.errors.length<20)result.errors.push({row:index+2,error:!name?'اسم العميل مفقود':'رقم الهاتف مفقود'});continue;}
    try{
      const ref=importRef(source,r,index),old=await existingOrder(env,{clientId,storeId,source,row:r,ref}),state=stateOf(r.state||r.status),qty=Math.max(1,Number(r.qty)||1),match=catalogMatch(products,r),productCost=match?r2((Number(match.cost)||0)*qty):0,customerId=await findOrCreateCustomer(env,{clientId,storeId,name,rawPhone,gov:text(r.gov),address:text(r.address)}),history=historyOf(old?.history);
      if(!history.length)history.push({state,at:text(r.createdAt)||now(),source:`sheet:${source}`});else if(old?.state!==state)history.push({state,at:now(),source:`sheet:${source}`,note:'تحديث حالة من استيراد الشيت'});
      const values={name,phone:phone(rawPhone),gov:text(r.gov),address:text(r.address),product:text(r.product),productId:match?.id||null,productNote:OPTIONAL_PLACEHOLDER(r.productNote),unitPrice:num(r.unitPrice)||0,qty,total:num(r.total)||0,productCost,shippingCost:num(r.shippingCost),otherCost:num(r.otherCost),note:cleanNote(r,source),awb:OPTIONAL_PLACEHOLDER(r.awb),date:day(r.date),state,checkpoint:CHECKPOINT[state]||state,customerId,history:JSON.stringify(history),ref,externalId};
      if(old){
        await env.DB.prepare(`UPDATE orders SET customer_id=?,date=?,name=?,phone=?,gov=?,address=?,product=?,product_id=COALESCE(?,product_id),product_note=?,unit_price=?,qty=?,total=?,product_cost=CASE WHEN ?>0 THEN ? ELSE product_cost END,shipping_cost=?,other_cost=?,source=?,note=?,awb=COALESCE(?,awb),state=?,checkpoint=?,history=? WHERE id=? AND client_id=? AND store_id IS ?`).bind(values.customerId,values.date,values.name,values.phone,values.gov,values.address,values.product,values.productId,values.productNote,values.unitPrice,values.qty,values.total,values.productCost,values.productCost,values.shippingCost,values.otherCost,`شيت ${source}`,values.note,values.awb||null,values.state,values.checkpoint,values.history,old.id,clientId,storeId).run();result.updated++;
      }else{
        const id=`IMP-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
        await env.DB.prepare(`INSERT INTO orders (id,client_id,store_id,ref,customer_id,date,name,phone,gov,address,product,product_id,variant_id,product_note,unit_price,qty,total,discount_amount,coupon_code,product_cost,shipping_cost,other_cost,source,note,awb,state,checkpoint,signed_at,collected_at,defer_until,refund_amount,return_type,restocked,contact_log,history,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,storeId,values.ref,values.customerId,values.date,values.name,values.phone,values.gov,values.address,values.product,values.productId,null,values.productNote,values.unitPrice,values.qty,values.total,0,null,values.productCost,values.shippingCost,values.otherCost,`شيت ${source}`,values.note,values.awb||null,values.state,values.checkpoint,['signed','collected'].includes(values.state)?values.date:null,values.state==='collected'?values.date:null,null,null,null,0,'[]',values.history,text(r.createdAt)||now()).run();
        result.created++;try{const billed=await billOrder(env,id);if(billed?.ok===false)result.billingPending++;}catch{result.billingPending++;}
      }
      if(productCost>0)result.costed++;else result.noCost++;
    }catch(error){result.skipped++;if(result.errors.length<20)result.errors.push({row:index+2,externalId,error:text(error?.message||error).slice(0,220)});}
  }
  await audit(env,{clientId,storeId,actor,source,result});return {ok:true,source,rows:rows.length,...result};
}
