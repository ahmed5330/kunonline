export const ORDER_STAGE_MAP={
  pending:{key:'customer_service',label:'خدمة العملاء / التأكيد'},
  confirmed:{key:'fulfillment',label:'التنفيذ والتجهيز'},
  preparing:{key:'warehouse',label:'المخزن والتعبئة'},
  shipped:{key:'shipping',label:'الشحن والمتابعة'},
  signed:{key:'cod_followup',label:'التسليم / متابعة التحصيل'},
  collected:{key:'finance',label:'المالية / تم التحصيل'},
  returned:{key:'returns',label:'المرتجعات وما بعد البيع'},
  cancelled:{key:'closed',label:'مغلق / ملغي'},
  deferred:{key:'customer_service',label:'خدمة العملاء / مؤجل'}
};
export const stageForState=state=>ORDER_STAGE_MAP[state]||{key:'operations',label:'التشغيل'};
export async function stageBoard(env,{clientId,storeId=null}){
  const {results=[]}=await env.DB.prepare(`SELECT id,store_id,name,phone,product,total,state,date,awb,source FROM orders WHERE client_id=? ${storeId?'AND store_id=?':''} ORDER BY COALESCE(created_at,date) DESC LIMIT 1000`).bind(...(storeId?[clientId,storeId]:[clientId])).all();
  const stages={};for(const o of results){const stage=stageForState(o.state);if(!stages[stage.key])stages[stage.key]={key:stage.key,label:stage.label,count:0,orders:[]};stages[stage.key].count++;stages[stage.key].orders.push(o)}
  return Object.values(stages);
}
