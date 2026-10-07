export async function isSerializedProduct(env,clientId,productId){
  try{return !!await env.DB.prepare("SELECT 1 n FROM inventory_serialization_snapshots WHERE client_id=? AND product_id=? AND tracking_mode='SERIALIZED' LIMIT 1").bind(clientId,productId).first();}
  catch(e){if(/no such table.*inventory_serialization_snapshots/i.test(String(e.message)))return false;throw e;}
}
export function rejectQuantityMutation(){throw Object.assign(new Error('المنتج مرقم؛ استخدم استلام القطع أو حركة وحدات معتمدة بدل تعديل الكمية'),{status:409,code:'SERIALIZED_MANUAL_STOCK_EDIT_BLOCKED'});}
