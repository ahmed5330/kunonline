import {listMyStores} from './store-scope.js';

const STATES=['shipped','signed','collected'];
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const parseArray=value=>{try{const data=JSON.parse(value||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
const fail=(message,status=400,code='POST_SHIPPING_ERROR')=>{throw Object.assign(new Error(message),{status,code});};
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const stamp=()=>new Date().toISOString();

async function access(env,me,clientId){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[];
  if(!context.allStores&&!stores.length)fail('لا توجد متاجر مخصصة لهذا المستخدم',403,'POST_SHIPPING_STORE_ACCESS_REQUIRED');
  return {allStores:Boolean(context.allStores),stores,ids:stores.map(row=>String(row.id))};
}
function canWriteStore(context,storeId){if(context.allStores)return true;const row=context.stores.find(item=>String(item.id)===String(storeId||''));return Boolean(row&&row.role!=='viewer');}
function mapOrder(row){return {id:row.id,clientId:row.client_id,storeId:row.store_id||null,storeName:row.store_name||'بدون متجر',ref:row.ref||null,date:row.date||row.created_at||null,name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',product:row.product||'',productNote:row.product_note||'',qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),awb:row.awb||'',state:row.state,checkpoint:row.checkpoint||'',source:row.source||'',collectedAmount:row.collected_amount===null?null:Number(row.collected_amount),collectedAt:row.collected_at||null,history:parseArray(row.history)};}
export async function postShippingBoard(env,{clientId,me,selectedStoreId=''}){
  const context=await access(env,me,clientId),selected=clean(selectedStoreId,120);
  if(selected&&!context.allStores&&!context.ids.includes(selected))fail('المتجر غير مسموح لهذا المستخدم',403,'STORE_ISOLATION');
  if(selected&&context.allStores&&!context.ids.includes(selected))fail('المتجر غير موجود أو غير نشط',404,'STORE_NOT_FOUND');
  const binds=[clientId,...STATES];let where=`o.client_id=? AND o.state IN (${STATES.map(()=>'?').join(',')})`;
  if(selected){where+=' AND o.store_id=?';binds.push(selected);}else if(!context.allStores){where+=` AND o.store_id IN (${context.ids.map(()=>'?').join(',')})`;binds.push(...context.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE ${where} ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC`).bind(...binds).all();
  return {ok:true,clientId,allStores:context.allStores,stores:context.stores.map(row=>({id:row.id,name:row.name,code:row.code||'',role:row.role||'owner'})),selectedStoreId:selected||null,stages:[{id:'shipped',label:'جاري الشحن'},{id:'signed',label:'تم الشحن'},{id:'collected',label:'تم التحصيل'}],orders:results.map(mapOrder)};
}
async function orderForWrite(env,{clientId,orderId,me}){
  const context=await access(env,me,clientId),row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');if(!context.allStores&&!context.ids.includes(String(row.store_id||'')))fail('الأوردر خارج المتاجر المسموح بها',403,'STORE_ISOLATION');if(!canWriteStore(context,row.store_id))fail('صلاحية هذا المتجر للعرض فقط',403,'STORE_READ_ONLY');return row;
}
async function audit(env,{row,me,action,before,after,metadata}){try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,row.client_id,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user',action,'order',row.id,JSON.stringify(before),JSON.stringify(after),JSON.stringify(metadata||{}),stamp()).run();}catch{}}
export async function markPostShippingDelivered(env,{clientId,orderId,me}){
  const row=await orderForWrite(env,{clientId,orderId,me});if(row.state!=='shipped')fail('يمكن نقل الطلب من «جاري الشحن» فقط',409,'POST_SHIPPING_STATE_INVALID');
  const at=stamp(),history=parseArray(row.history),entry={type:'post_shipping_delivered',state:'signed',note:'تم الشحن — في انتظار التحصيل من شركة الشحن',at,...actor(me)};history.push(entry);
  await env.DB.prepare("UPDATE orders SET state='signed',checkpoint=?,signed_at=?,history=? WHERE id=? AND client_id=?").bind('تم الشحن — تحصيل منتظر',at.slice(0,10),JSON.stringify(history),orderId,clientId).run();await audit(env,{row,me,action:'order.post_shipping_delivered',before:{state:row.state},after:{state:'signed'},metadata:{source:'post_shipping'}});return {ok:true,id:orderId,state:'signed',history};
}
export async function collectPostShippingOrder(env,{clientId,orderId,amount,me}){
  const row=await orderForWrite(env,{clientId,orderId,me});if(row.state!=='signed')fail('التحصيل متاح للطلبات الموجودة في «تم الشحن» فقط',409,'POST_SHIPPING_COLLECTION_STATE_INVALID');
  const value=Number(amount);if(!Number.isFinite(value)||value<0)fail('اكتب المبلغ المستلم من شركة الشحن بشكل صحيح',400,'COLLECTED_AMOUNT_INVALID');
  const at=stamp(),history=parseArray(row.history),entry={type:'cod_collection',state:'collected',amount:Number(value.toFixed(2)),note:`تم استلام ${Number(value.toFixed(2))} جنيه من شركة الشحن`,at,...actor(me)};history.push(entry);
  await env.DB.prepare("UPDATE orders SET state='collected',checkpoint=?,collected_amount=?,collected_at=?,history=? WHERE id=? AND client_id=?").bind('تم التحصيل',entry.amount,at.slice(0,10),JSON.stringify(history),orderId,clientId).run();await audit(env,{row,me,action:'order.cod_collection',before:{state:row.state,collectedAmount:row.collected_amount},after:{state:'collected',collectedAmount:entry.amount},metadata:{source:'post_shipping',manual:true}});return {ok:true,id:orderId,state:'collected',collectedAmount:entry.amount,collectedAt:at,history};
}
