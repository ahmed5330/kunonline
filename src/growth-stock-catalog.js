// Read-only store-scoped stock catalogue for growth planning.
// Does not mutate legacy Easy Orders imports or existing bundle mappings.
const toNum=v=>Number.isFinite(Number(v))?Number(v):0;
const clean=v=>String(v??'').trim();
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
export async function growthStockCatalog(env,{clientId,storeId,limit=100}={}){
  if(!clientId||!storeId)fail('GROWTH_STORE_REQUIRED','اختار متجرًا لعرض مكونات المخزون في محاكي التوسع.');
  const max=Math.min(150,Math.max(1,Math.floor(Number(limit)||100)));
  const {results:products=[]}=await env.DB.prepare(
    'SELECT id,name,sku,stock,low_stock_threshold FROM products WHERE client_id=? AND store_id=? AND active=1 ORDER BY name,id LIMIT ?'
  ).bind(clientId,storeId,max).all();
  let mappings=[],mappingStatus='not_available';
  try{
    const m=await env.DB.prepare(
      "SELECT external_id,product_id,components_json FROM commerce_bundle_mappings WHERE client_id=? AND store_id=? AND provider='easyorders'"
    ).bind(clientId,storeId).all();
    mappings=m.results||[];mappingStatus='loaded';
  }catch(error){
    // The optional bundle mapping table may not yet be deployed for the tenant.
    // Do not CREATE tables from a read-only request.
    if(/no such table/i.test(String(error?.message||'')))mappingStatus='not_installed';
    else throw error;
  }
  const visibleProducts=products.map(p=>({id:p.id,name:p.name||'',sku:p.sku||p.id,
    availableUnits:toNum(p.stock),lowStockThreshold:toNum(p.low_stock_threshold)}));
  const allowedIds=new Set(visibleProducts.map(p=>String(p.id)));
  const bundles=[];
  for(const b of mappings){
    let raw;try{raw=JSON.parse(b.components_json||'[]');}catch{continue;}
    if(!Array.isArray(raw)||!raw.length)continue;
    const visible=raw.filter(item=>allowedIds.has(String(item?.productId)));
    bundles.push({externalId:clean(b.external_id),parentProductId:clean(b.product_id),
      components:visible.map(item=>({productId:item.productId,quantity:toNum(item.quantity)})),
      coverage:visible.length===raw.length?'visible':'partial_inventory_page'});
  }
  return {storeId,items:visibleProducts,bundles,mappingStatus,pagination:{limit:max,truncated:visibleProducts.length===max},
    source:'recorded_product_stock',note:'الكميات المسجلة قد تختلف عن المتاح الفعلي بعد الحجز. تحتاج مراجعة الباندل وSKU والفترات قبل قرار الزيادة.'};
}

export async function resolveForecastStock(env,{clientId,storeId,items}={}){
  if(!clientId||!storeId)fail('GROWTH_STORE_REQUIRED','اختار المتجر قبل المحاكاة.');
  if(!Array.isArray(items)||items.length>40)fail('GROWTH_STOCK_ITEMS_INVALID','قائمة المنتجات المختارة غير صالحة.');
  if(!items.length)return [];
  const ids=items.map(item=>clean(item?.productId));
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)fail('GROWTH_STOCK_ITEMS_INVALID','اختار منتجات صالحة بدون تكرار.');
  const placeholders=ids.map(()=>'?').join(',');
  const {results=[]}=await env.DB.prepare(
    `SELECT id,name,sku,stock FROM products WHERE client_id=? AND store_id=? AND active=1 AND id IN (${placeholders})`
  ).bind(clientId,storeId,...ids).all();
  const byId=new Map(results.map(item=>[String(item.id),item]));
  if(ids.some(id=>!byId.has(id)))fail('GROWTH_STOCK_SCOPE','منتج مختار غير موجود في مخزون المتجر.',403);
  return items.map((row,i)=>({sku:clean(byId.get(ids[i]).sku)||ids[i],productId:ids[i],
    availableUnits:Math.max(0,toNum(byId.get(ids[i]).stock)),
    unitsPerOrder:row.unitsPerOrder,orderShare:row.orderShare,
    supplierLeadDays:row.supplierLeadDays,safetyDays:row.safetyDays}));
}
