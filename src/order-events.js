import {stageForState} from './order-routing.js';
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const safeParse=(v,fallback)=>{try{return JSON.parse(v||'')}catch{return fallback}};

export async function orderById(env,clientId,orderId,storeId=null){
  const sql=`SELECT * FROM orders WHERE id=? AND client_id=? ${storeId?'AND store_id=?':''}`;
  return env.DB.prepare(sql).bind(...(storeId?[orderId,clientId,storeId]:[orderId,clientId])).first();
}

export async function recordOrderEvent(env,{clientId,storeId=null,orderId,eventType,fromState=null,toState=null,actor=null,source='ui',metadata={}}){
  const id=rid('OEV'),ts=now();
  await env.DB.prepare(`INSERT INTO order_events
    (id,client_id,store_id,order_id,event_type,from_state,to_state,actor_user_id,actor_email,source,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,storeId,orderId,eventType,fromState,toState,actor?.uid||null,actor?.email||actor?.role||null,source,JSON.stringify(metadata||{}),ts).run();
  return {id,createdAt:ts};
}

export async function recordOrderMutation(env,before,after,actor,source='ui'){
  if(!before||!after)return null;
  const changed={};
  const fields=['state','awb','address','gov','name','phone','note','shipping_cost','other_cost','refund_amount','return_type','defer_until'];
  for(const field of fields){if(String(before[field]??'')!==String(after[field]??''))changed[field]={from:before[field]??null,to:after[field]??null};}
  if(!Object.keys(changed).length)return null;
  return recordOrderEvent(env,{clientId:after.client_id,storeId:after.store_id||null,orderId:after.id,eventType:before.state!==after.state?'status_changed':'order_updated',fromState:before.state||null,toState:after.state||null,actor,source,metadata:{changed,route:{from:stageForState(before.state),to:stageForState(after.state)}}});
}

export async function addOrderNote(env,{clientId,storeId=null,orderId,body,actor}){
  const text=String(body?.body??body??'').trim();if(!text)throw Object.assign(new Error('الملاحظة فارغة'),{status:400});if(text.length>4000)throw Object.assign(new Error('الملاحظة طويلة جدًا'),{status:400});
  const order=await orderById(env,clientId,orderId,storeId);if(!order)throw Object.assign(new Error('الطلب غير موجود'),{status:404});
  const id=rid('ON'),ts=now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO order_notes (id,client_id,store_id,order_id,body,created_by,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,clientId,order.store_id||storeId||null,orderId,text,actor?.email||actor?.uid||actor?.role||'',ts),
    env.DB.prepare(`INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('OEV'),clientId,order.store_id||storeId||null,orderId,'note_added',actor?.uid||null,actor?.email||actor?.role||null,'ui',JSON.stringify({noteId:id,body:text}),ts)
  ]);
  return {ok:true,id,createdAt:ts};
}

export async function logContact(env,{clientId,storeId=null,orderId,kind=null,message='',body=null,actor}){
  kind=String(kind||body?.kind||body?.channel||'').toLowerCase();message=String(message||body?.message||'');
  if(!['whatsapp','phone','messenger','instagram','tiktok'].includes(kind))throw Object.assign(new Error('قناة التواصل غير مدعومة'),{status:400});
  const order=await orderById(env,clientId,orderId,storeId);if(!order)throw Object.assign(new Error('الطلب غير موجود'),{status:404});
  const ts=now(),meta={kind,message:String(message||'').slice(0,3000),phone:order.phone||''};
  const statements=[env.DB.prepare(`INSERT INTO order_events (id,client_id,store_id,order_id,event_type,actor_user_id,actor_email,source,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(rid('OEV'),clientId,order.store_id||storeId||null,orderId,`contact_${kind}`,actor?.uid||null,actor?.email||actor?.role||null,'ui',JSON.stringify(meta),ts)];
  if(kind==='whatsapp'&&String(message||'').trim()){
    statements.push(env.DB.prepare(`INSERT INTO whatsapp_outbox (id,client_id,store_id,order_id,phone,message,kind,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(rid('WA'),clientId,order.store_id||storeId||null,orderId,order.phone||'',String(message).trim(),'manual','pending',ts));
  }
  await env.DB.batch(statements);
  return {ok:true,kind,queued:kind==='whatsapp'&&!!String(message||'').trim(),phone:order.phone||'',createdAt:ts};
}

export async function timeline(env,{clientId,storeId=null,orderId}){
  const order=await orderById(env,clientId,orderId,storeId);if(!order)throw Object.assign(new Error('الطلب غير موجود'),{status:404});
  const [{results:events=[]},{results:notes=[]},{results:audit=[]}]=await Promise.all([
    env.DB.prepare(`SELECT id,event_type,from_state,to_state,actor_user_id,actor_email,source,metadata_json,created_at FROM order_events WHERE client_id=? AND order_id=? ${storeId?'AND store_id=?':''} ORDER BY created_at DESC LIMIT 300`).bind(...(storeId?[clientId,orderId,storeId]:[clientId,orderId])).all(),
    env.DB.prepare(`SELECT id,body,created_by,created_at FROM order_notes WHERE client_id=? AND order_id=? ${storeId?'AND store_id=?':''} ORDER BY created_at DESC LIMIT 100`).bind(...(storeId?[clientId,orderId,storeId]:[clientId,orderId])).all(),
    env.DB.prepare(`SELECT id,actor_user_id,actor_email,action,before_json,after_json,metadata_json,created_at FROM audit_log WHERE client_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 200`).bind(clientId,orderId).all()
  ]);
  const items=[];
  for(const e of events)items.push({id:e.id,type:e.event_type,at:e.created_at,actor:e.actor_email||e.actor_user_id||'system',source:e.source,fromState:e.from_state,toState:e.to_state,metadata:safeParse(e.metadata_json,{})});
  // Legacy history/contact logs are retained so old events are not lost during v27 rollout.
  for(const h of safeParse(order.history,[])){if(h.eventId)continue;items.push({id:`legacy-history:${h.at||h.state}`,type:h.type==='internal_note'?'note_added':h.type==='contact'?`contact_${h.channel||'phone'}`:'legacy_status',at:h.at||order.created_at||order.date,actor:h.byName||h.by||'غير مسجل (Legacy)',source:'legacy',toState:h.state,metadata:{...h,...(h.type==='internal_note'?{body:h.note}:{})}});}
  for(const c of safeParse(order.contact_log,[])){if(c.eventId)continue;items.push({id:`legacy-contact:${c.at||Math.random()}`,type:'legacy_contact',at:c.at||c.createdAt||order.created_at||order.date,actor:c.by||'غير مسجل (Legacy)',source:'legacy',metadata:c});}
  for(const a of audit)items.push({id:`audit:${a.id}`,type:'audit',at:a.created_at,actor:a.actor_email||a.actor_user_id||'system',source:'audit',metadata:{action:a.action,before:safeParse(a.before_json,null),after:safeParse(a.after_json,null),...safeParse(a.metadata_json,{})}});
  items.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  return {order:{id:order.id,name:order.name,phone:order.phone,state:order.state,stage:stageForState(order.state),awb:order.awb,total:order.total,source:order.source,storeId:order.store_id||null},notes,events:items.slice(0,400)};
}
