const now=()=>new Date().toISOString();

export async function saveAttribution(env,{clientId,storeId=null,orderId,platform=null,campaignId=null,adsetId=null,adId=null,sourceKind='manual',clickId=null,metadata={}}){
  const order=await env.DB.prepare('SELECT id,client_id,store_id FROM orders WHERE id=? AND client_id=?').bind(orderId,clientId).first();if(!order)throw Object.assign(new Error('الطلب غير موجود'),{status:404});
  if(storeId&&String(order.store_id)!==String(storeId))throw Object.assign(new Error('الطلب لا يتبع هذا الفرع'),{status:403,code:'STORE_ISOLATION'});
  await env.DB.prepare(`INSERT INTO order_attribution (order_id,client_id,store_id,platform,campaign_id,adset_id,ad_id,source_kind,external_click_id,metadata_json,attributed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET platform=excluded.platform,campaign_id=excluded.campaign_id,adset_id=excluded.adset_id,ad_id=excluded.ad_id,source_kind=excluded.source_kind,external_click_id=excluded.external_click_id,metadata_json=excluded.metadata_json,attributed_at=excluded.attributed_at`)
    .bind(orderId,clientId,order.store_id||storeId||null,platform,campaignId,adsetId,adId,sourceKind,clickId,JSON.stringify(metadata||{}),now()).run();
  return {ok:true,orderId,campaignId};
}

