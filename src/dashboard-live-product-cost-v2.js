const num=value=>Number(value)||0;
const round=value=>Math.round(num(value)*100)/100;
const clean=value=>String(value??'').trim();
const norm=value=>clean(value).toLowerCase().replace(/\s+/g,' ');
const excludedStates=new Set(['cancelled','returned']);
const confirmedStates=new Set(['confirmed','preparing','shipped','signed','collected']);
const deliveredStates=new Set(['signed','collected']);
const shippedStates=new Set(['shipped','signed','collected','returned']);

const itemQty=value=>{const qty=Number(value);return Number.isFinite(qty)&&qty>0?qty:1;};
const dateKey=value=>clean(value).slice(0,10);
const percent=(a,b)=>b?round(num(a)/num(b)*100):0;
function daysBetween(from,to){const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(1,Math.floor((b-a)/86400000)+1):1;}
function bucketFor(date,granularity){if(granularity==='month')return String(date).slice(0,7);if(granularity==='week'){const d=new Date(`${date}T00:00:00Z`),day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);}return String(date).slice(0,10);}

function addUnique(map,key,value){key=norm(key);if(!key)return;const old=map.get(key);if(old===undefined)map.set(key,value);else if(old!==value)map.set(key,null);}
function buildCatalog(products=[],variants=[]){
  const productById=new Map(),variantById=new Map(),productBySku=new Map(),variantBySku=new Map(),productByName=new Map();
  for(const p of products){const row={...p,cost:num(p.cost)};productById.set(clean(p.id),row);addUnique(productBySku,p.sku,row);addUnique(productByName,p.name,row);}
  for(const v of variants){const product=productById.get(clean(v.product_id));const own=v.cost===null||v.cost===undefined?null:Number(v.cost),row={...v,cost:Number.isFinite(own)?own:num(product?.cost)};variantById.set(clean(v.id),row);addUnique(variantBySku,v.sku,row);}
  return {productById,variantById,productBySku,variantBySku,productByName};
}
function resolveUnitCost(line,catalog){
  const variantId=clean(line.variant_id),productId=clean(line.product_id),sku=norm(line.sku),name=norm(line.product_name||line.product);
  if(variantId&&catalog.variantById.has(variantId))return {cost:num(catalog.variantById.get(variantId)?.cost),source:'variant_id'};
  if(productId&&catalog.productById.has(productId))return {cost:num(catalog.productById.get(productId)?.cost),source:'product_id'};
  const variantSku=sku?catalog.variantBySku.get(sku):null;if(variantSku)return {cost:num(variantSku.cost),source:'variant_sku'};
  const productSku=sku?catalog.productBySku.get(sku):null;if(productSku)return {cost:num(productSku.cost),source:'product_sku'};
  const productName=name?catalog.productByName.get(name):null;if(productName)return {cost:num(productName.cost),source:'product_name'};
  return null;
}
function orderCost(order,lines,catalog){
  const orderLines=lines.get(clean(order.id))||[];
  if(!orderLines.length){const resolved=resolveUnitCost(order,catalog);return {cost:resolved?round(resolved.cost*itemQty(order.qty)):round(num(order.product_cost)),liveLines:resolved?1:0,fallbackLines:resolved?0:1};}
  const totalQty=orderLines.reduce((sum,line)=>sum+itemQty(line.qty),0)||1,historicalUnit=num(order.product_cost)/totalQty;
  let cost=0,liveLines=0,fallbackLines=0;
  for(const line of orderLines){const qty=itemQty(line.qty),resolved=resolveUnitCost(line,catalog);if(resolved){cost+=resolved.cost*qty;liveLines++;}else{cost+=historicalUnit*qty;fallbackLines++;}}
  return {cost:round(cost),liveLines,fallbackLines};
}
function selectedRateSummary(rows,from,to){const set=rows||[],total=set.length,confirmed=set.filter(row=>confirmedStates.has(clean(row.state))).length,delivered=set.filter(row=>deliveredStates.has(clean(row.state))).length,returned=set.filter(row=>clean(row.state)==='returned').length,shippingOutcomes=delivered+returned,shippedPopulation=set.filter(row=>shippedStates.has(clean(row.state))).length;return {days:daysBetween(from,to),from,to,total,confirmed,confirmationRate:percent(confirmed,total),delivered,returned,deliveryRate:percent(delivered,shippingOutcomes),returnRate:percent(returned,shippingOutcomes),returnOfShippedRate:percent(returned,shippedPopulation)};}
function updateMarginDetails(snapshot,productCost,netProfit,profitMargin){const details=snapshot?.overview?.details?.margin;if(!Array.isArray(details))return;for(const row of details){if(row?.label==='تكلفة المنتج')row.value=productCost;else if(row?.label==='صافي الربح')row.value=netProfit;else if(row?.label==='هامش الربح')row.value=profitMargin;}}

export function resolveCurrentInventoryOrderCost({order,orderItems=[],products=[],variants=[]}){const lines=new Map([[clean(order?.id),orderItems||[]]]);return orderCost(order||{},lines,buildCatalog(products,variants));}

export async function applyCurrentInventoryCostsV2(env,{snapshot,clientId,storeId=null}){
  if(!snapshot?.ok||!clientId)return snapshot;
  const from=clean(snapshot.from),to=clean(snapshot.to);if(!from||!to)return snapshot;
  const orderStore=storeId?' AND store_id=?':'',itemStore=storeId?' AND o.store_id=?':'',catalogStore=storeId?' AND store_id=?':'';
  const rangeBinds=storeId?[clientId,storeId,from,to]:[clientId,from,to],scopeBinds=storeId?[clientId,storeId]:[clientId];
  const [orderResult,itemResult,productResult,variantResult]=await Promise.all([
    env.DB.prepare(`SELECT id,date,created_at,state,product_id,variant_id,product,qty,product_cost FROM orders WHERE client_id=?${orderStore} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`).bind(...rangeBinds).all(),
    env.DB.prepare(`SELECT oi.order_id,oi.product_id,oi.variant_id,oi.sku,oi.product_name,oi.qty FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.client_id=oi.client_id WHERE oi.client_id=?${itemStore} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...rangeBinds).all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT id,name,sku,cost FROM products WHERE client_id=?${catalogStore}`).bind(...scopeBinds).all(),
    env.DB.prepare(`SELECT id,product_id,name,sku,cost FROM product_variants WHERE client_id=?${catalogStore}`).bind(...scopeBinds).all()
  ]);
  const orders=orderResult.results||[],itemsByOrder=new Map();for(const item of itemResult.results||[]){const id=clean(item.order_id);if(!itemsByOrder.has(id))itemsByOrder.set(id,[]);itemsByOrder.get(id).push(item);}
  const catalog=buildCatalog(productResult.results||[],variantResult.results||[]),costByOrder=new Map();let liveLines=0,fallbackLines=0;
  for(const order of orders){const resolved=orderCost(order,itemsByOrder,catalog);costByOrder.set(clean(order.id),resolved.cost);liveLines+=resolved.liveLines;fallbackLines+=resolved.fallbackLines;}
  const eligible=orders.filter(order=>!excludedStates.has(clean(order.state))),productCost=round(eligible.reduce((sum,order)=>sum+num(costByOrder.get(clean(order.id))),0));
  const revenue=num(snapshot.finance?.revenue??snapshot.overview?.expectedRevenue),expenses=num(snapshot.finance?.expenses),grossProfit=round(revenue-productCost),netProfit=round(grossProfit-expenses),profitMargin=revenue?round(netProfit/revenue*100):0;
  snapshot.finance={...(snapshot.finance||{}),productCost,grossProfit,netProfit};
  snapshot.overview={...(snapshot.overview||{}),netProfit,profitMargin,productCostSource:'current_inventory_resolved'};
  snapshot.rates={...(snapshot.rates||{}),selected:selectedRateSummary(orders,from,to)};updateMarginDetails(snapshot,productCost,netProfit,profitMargin);
  if(Array.isArray(snapshot.trend?.points)){const granularity=snapshot.trend.granularity||'day',costByBucket=new Map();for(const order of eligible){const key=bucketFor(dateKey(order.date||order.created_at),granularity);costByBucket.set(key,round(num(costByBucket.get(key))+num(costByOrder.get(clean(order.id)))));}snapshot.trend.points=snapshot.trend.points.map(point=>{const currentProductCost=round(num(costByBucket.get(clean(point.key)))),pointRevenue=num(point.revenue),operating=num(point.adSpend)+num(point.otherExpenses)+num(point.shipping)+num(point.orderOther)+num(point.adminFees),gross=round(pointRevenue-currentProductCost);return {...point,productCost:currentProductCost,grossProfit:gross,netProfit:round(gross-operating)};});}
  snapshot.costing={source:'current_inventory_resolved',variantFirst:true,skuFallback:true,nameFallback:true,lineLevelHistoricalFallback:true,liveLines,fallbackLines,updatedAt:new Date().toISOString()};
  return snapshot;
}