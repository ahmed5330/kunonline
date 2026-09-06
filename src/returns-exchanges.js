import {listMyStores} from './store-scope.js';

const clean=(value,max=1200)=>String(value??'').trim().slice(0,max);
const parseArray=value=>{try{const data=JSON.parse(value||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
const stamp=()=>new Date().toISOString();
const actor=me=>({by:me?.email||me?.name||me?.role||'user',byName:me?.name||me?.email||me?.role||'user',byUserId:me?.uid||me?.id||null});
const fail=(message,status=400,code='RETURNS_EXCHANGES_ERROR')=>{throw Object.assign(new Error(message),{status,code});};

async function access(env,me,clientId){
  const context=await listMyStores(env,me,clientId),stores=context.stores||[];
  if(!context.allStores&&!stores.length)fail('لا توجد متاجر مخصصة لهذا المستخدم',403,'RETURNS_STORE_ACCESS_REQUIRED');
  return {allStores:Boolean(context.allStores),stores,ids:stores.map(row=>String(row.id))};
}
function canWriteStore(context,storeId){if(context.allStores)return true;const row=context.stores.find(item=>String(item.id)===String(storeId||''));return Boolean(row&&row.role!=='viewer');}
function outcomeMeta(row){
  const history=parseArray(row.history),state=row.state||'',returnType=clean(row.return_type)||([...history].reverse().find(item=>item?.state==='returned'&&item?.returnType)?.returnType)||'full';
  const reasonEvent=[...history].reverse().find(item=>item?.type==='outcome_reason'&&(item?.outcomeState===state||item?.state===state));
  const stateEvent=[...history].reverse().find(item=>item?.state===state&&(item?.outcomeReason||item?.reason));
  const event=reasonEvent||stateEvent||null,reason=clean(event?.outcomeReason||event?.reason),sourceSection=clean(event?.sourceSection)||'';
  const classification=state==='cancelled'?'cancelled':returnType==='exchange'?'exchange':'returned';
  return {history,returnType,classification,reason,reasonMissing:!reason,sourceSection};
}
function mapOrder(row){
  const meta=outcomeMeta(row);
  return {id:row.id,clientId:row.client_id,storeId:row.store_id||null,storeName:row.store_name||'بدون متجر',ref:row.ref||null,date:row.date||row.created_at||null,createdAt:row.created_at||null,name:row.name||'',phone:row.phone||'',gov:row.gov||'',address:row.address||'',product:row.product||'',productNote:row.product_note||'',qty:Number(row.qty||1),unitPrice:Number(row.unit_price||0),total:Number(row.total||0),awb:row.awb||'',state:row.state,checkpoint:row.checkpoint||'',source:row.source||'',returnType:meta.returnType,classification:meta.classification,reason:meta.reason,reasonMissing:meta.reasonMissing,sourceSection:meta.sourceSection,refundAmount:row.refund_amount===null?null:Number(row.refund_amount),history:meta.history};
}

export async function returnsExchangesBoard(env,{clientId,me,selectedStoreId=''}){
  const context=await access(env,me,clientId),selected=clean(selectedStoreId,120);
  if(selected&&!context.allStores&&!context.ids.includes(selected))fail('المتجر غير مسموح لهذا المستخدم',403,'STORE_ISOLATION');
  if(selected&&context.allStores&&!context.ids.includes(selected))fail('المتجر غير موجود أو غير نشط',404,'STORE_NOT_FOUND');
  const binds=[clientId];let where="o.client_id=? AND o.state IN ('returned','cancelled') AND NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)";
  if(selected){where+=' AND o.store_id=?';binds.push(selected);}else if(!context.allStores){where+=` AND o.store_id IN (${context.ids.map(()=>'?').join(',')})`;binds.push(...context.ids);}
  const {results=[]}=await env.DB.prepare(`SELECT o.*,s.name store_name FROM orders o LEFT JOIN stores s ON s.id=o.store_id AND s.client_id=o.client_id WHERE ${where} ORDER BY COALESCE(o.date,o.created_at) DESC,o.created_at DESC`).bind(...binds).all();
  const orders=results.map(mapOrder),counts={returned:0,exchange:0,cancelled:0,missingReason:0};
  for(const order of orders){counts[order.classification]=(counts[order.classification]||0)+1;if(order.reasonMissing)counts.missingReason++;}
  return {ok:true,clientId,allStores:context.allStores,stores:context.stores.map(row=>({id:row.id,name:row.name,code:row.code||'',role:row.role||'owner'})),selectedStoreId:selected||null,counts,orders};
}

export async function saveOutcomeReason(env,{clientId,orderId,reason,me}){
  const context=await access(env,me,clientId),row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();
  if(!row)fail('الأوردر غير موجود',404,'ORDER_NOT_FOUND');
  if(!context.allStores&&!context.ids.includes(String(row.store_id||'')))fail('الأوردر خارج المتاجر المسموح بها',403,'STORE_ISOLATION');
  if(!canWriteStore(context,row.store_id))fail('صلاحية هذا المتجر للعرض فقط',403,'STORE_READ_ONLY');
  if(!['returned','cancelled'].includes(row.state))fail('يمكن تسجيل سبب فقط للأوردرات المرتجعة أو الملغية',409,'OUTCOME_REASON_STATE_INVALID');
  const value=clean(reason,1000);if(value.length<2)fail('اكتب سبب واضح للمرتجع أو الاستبدال أو الإلغاء',400,'ORDER_OUTCOME_REASON_REQUIRED');
  const history=parseArray(row.history),returnType=clean(row.return_type)||'full',classification=row.state==='cancelled'?'cancelled':returnType==='exchange'?'exchange':'returned',at=stamp(),entry={type:'outcome_reason',state:row.state,outcomeState:row.state,classification,returnType,reason:value,outcomeReason:value,note:`${classification==='exchange'?'سبب الاستبدال':classification==='returned'?'سبب المرتجع':'سبب الإلغاء'}: ${value}`,sourceSection:'returns-exchanges',at,...actor(me)};
  history.push(entry);await env.DB.prepare('UPDATE orders SET history=? WHERE id=? AND client_id=?').bind(JSON.stringify(history),orderId,clientId).run();
  try{await env.DB.prepare('INSERT INTO audit_log (id,client_id,store_id,actor_user_id,actor_email,action,entity_type,entity_id,before_json,after_json,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(`AUD-${crypto.randomUUID().slice(0,10).toUpperCase()}`,clientId,row.store_id||null,me?.uid||me?.id||null,me?.email||me?.name||me?.role||'user','order.outcome_reason','order',orderId,JSON.stringify({reason:outcomeMeta(row).reason||null}),JSON.stringify({reason:value}),JSON.stringify({classification,returnType,source:'returns-exchanges'}),at).run();}catch{}
  return {ok:true,id:orderId,state:row.state,classification,returnType,reason:value,history};
}
