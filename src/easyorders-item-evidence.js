// Structured order-line evidence captured only from trusted Easy Orders ingestion.
// Stored inside the existing order history; no D1 migration or inventory write.
const clean=v=>String(v??'').trim();
const clip=(v,n=180)=>clean(v).slice(0,n);
const optionName=value=>({color:'اللون',colour:'اللون',size:'المقاس',model:'الموديل',type:'النوع',material:'الخامة',style:'النوع'}[clean(value).toLowerCase()]||clip(value,70));
const count=v=>{const n=Number(v);return Number.isFinite(n)?Math.min(9999,Math.max(1,Math.floor(n))):1;};
const money=v=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:0;};
const normalizeDate=v=>{const s=clean(v);if(!/^\d{4}-\d{2}-\d{2}[T ]/.test(s))return '';const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toISOString():'';};
const entries=history=>{try{const r=typeof history==='string'?JSON.parse(history):history;return Array.isArray(r)?r:[];}catch{return [];}};
const lineLimit=50;
export async function easyOrdersItemsSnapshot(order){
  const raw=Array.isArray(order?.cart_items)?order.cart_items:[];
  if(!raw.length)return null;
  const items=raw.slice(0,lineLimit).map(entry=>{
    const product=entry?.product||{},variant=entry?.variant||{};
    const optionList=Array.isArray(variant.variation_props)?variant.variation_props:[];
    const options=optionList.slice(0,20).map(option=>({
      name:optionName(option?.variation||option?.name),
      value:clip(option?.variation_prop||option?.value,140)
    })).filter(option=>option.name&&option.value);
    const variantLabel=clip(variant.name||variant.title||options.map(o=>o.name+': '+o.value).join('، '),300);
    const name=clip(product.name||entry?.product_name||entry?.name,200);
    const quantity=count(entry?.quantity??entry?.qty);
    return {
      name,productName:name,variantName:variantLabel,
      options,quantity,qty:quantity,
      sku:clip(variant.sku||entry?.sku||product.sku,100),
      price:money(entry?.price??entry?.unit_price),unitPrice:money(entry?.price??entry?.unit_price)
    };
  }).filter(item=>item.name||item.variantName||item.options.length);
  if(!items.length)return null;
  const canonical=JSON.stringify({items,truncated:raw.length>lineLimit});
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  const fingerprint=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  return {type:'easyorders_items_snapshot',source:'easyorders-webhook',fingerprint,
    providerAt:normalizeDate(order?.updated_at),items,truncated:raw.length>lineLimit,
    at:new Date().toISOString()};
}
export function easyOrdersItemsFromHistory(history){
  return entries(history).filter(e=>
    e?.type==='easyorders_items_snapshot'&&e?.source==='easyorders-webhook'&&
    Array.isArray(e.items)&&e.items.length>0&&e.items.length<=lineLimit
  ).at(-1)?.items||[];
}
export async function appendEasyOrdersItemsSnapshot(db,{orderId,clientId,snapshot}){
  if(!orderId||!clientId||!snapshot?.fingerprint||!Array.isArray(snapshot.items))return false;
  const h="CASE WHEN json_valid(history) AND json_type(history)='array' THEN history ELSE '[]' END";
  const ev=`SELECT json_extract(e.value,'$.fingerprint') fingerprint,
    COALESCE(json_extract(e.value,'$.providerAt'),'') provider_at
    FROM json_each(${h}) e
    WHERE json_extract(e.value,'$.type')='easyorders_items_snapshot'
      AND json_extract(e.value,'$.source')='easyorders-webhook'
    ORDER BY CAST(e.key AS INTEGER) DESC LIMIT 1`;
  // A stale or undated replay cannot overwrite newer provider line quantities;
  // a duplicate revision is a no-op inside the same atomic UPDATE.
  const sql=`UPDATE orders SET history=json_insert(${h},'$[#]',json(?))
    WHERE id=? AND client_id=?
    AND COALESCE((SELECT fingerprint FROM (${ev})),'')<>?
    AND (NOT EXISTS (SELECT 1 FROM (${ev}))
      OR (?<>'' AND ? > COALESCE((SELECT provider_at FROM (${ev})),'')))`;
  const result=await db.prepare(sql).bind(JSON.stringify(snapshot),orderId,clientId,
    snapshot.fingerprint,snapshot.providerAt,snapshot.providerAt).run();
  if(result?.success===false)throw Error('Easy Orders item evidence update failed');
  return Number(result?.meta?.changes||0)>0;
}
