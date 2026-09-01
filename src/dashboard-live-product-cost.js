const num=value=>Number(value)||0;
const round=value=>Math.round(num(value)*100)/100;
const clean=value=>String(value??'').trim();
const excludedStates=new Set(['cancelled','returned']);

function itemQty(value){const qty=Number(value);return Number.isFinite(qty)&&qty>0?qty:1;}
function costKey(value){return clean(value);}
function dateKey(value){return clean(value).slice(0,10);}
function bucketFor(date,granularity){
  if(granularity==='month')return String(date).slice(0,7);
  if(granularity==='week'){
    const d=new Date(`${date}T00:00:00Z`),day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);
  }
  return String(date).slice(0,10);
}

function buildCatalogCosts(products,variants){
  const productCosts=new Map((products||[]).map(row=>[costKey(row.id),num(row.cost)]));
  const variantCosts=new Map();
  for(const row of variants||[]){
    const own=row.cost===null||row.cost===undefined?null:Number(row.cost);
    variantCosts.set(costKey(row.id),Number.isFinite(own)?own:num(productCosts.get(costKey(row.product_id))));
  }
  return {productCosts,variantCosts};
}
function currentLineCost(line,{productCosts,variantCosts}){
  const variantId=costKey(line.variant_id),productId=costKey(line.product_id),qty=itemQty(line.qty);
  if(variantId&&variantCosts.has(variantId))return round(num(variantCosts.get(variantId))*qty);
  if(productId&&productCosts.has(productId))return round(num(productCosts.get(productId))*qty);
  return null;
}
function currentOrderCost(order,items,catalog){
  const orderItems=items.get(costKey(order.id))||[];
  if(orderItems.length){
    let total=0,matched=false;
    for(const item of orderItems){const line=currentLineCost(item,catalog);if(line!==null){total+=line;matched=true;}}
    if(matched)return round(total);
  }
  const direct=currentLineCost(order,catalog);
  if(direct!==null)return direct;
  return round(num(order.product_cost));
}
function updateMarginDetails(snapshot,productCost,netProfit,profitMargin){
  const details=snapshot?.overview?.details?.margin;if(!Array.isArray(details))return;
  for(const row of details){
    if(row?.label==='تكلفة المنتج')row.value=productCost;
    else if(row?.label==='صافي الربح')row.value=netProfit;
    else if(row?.label==='هامش الربح')row.value=profitMargin;
  }
}

export async function applyCurrentInventoryCosts(env,{snapshot,clientId,storeId=null}){
  if(!snapshot?.ok||!clientId)return snapshot;
  const from=clean(snapshot.from),to=clean(snapshot.to);if(!from||!to)return snapshot;
  const storeOrders=storeId?' AND store_id=?':'',storeItems=storeId?' AND store_id=?':'',storeCatalog=storeId?' AND store_id=?':'';
  const orderBinds=storeId?[clientId,storeId,from,to]:[clientId,from,to],scopeBinds=storeId?[clientId,storeId]:[clientId];
  const [orderResult,itemResult,productResult,variantResult]=await Promise.all([
    env.DB.prepare(`SELECT id,date,created_at,state,product_id,variant_id,qty,product_cost FROM orders WHERE client_id=?${storeOrders} AND date(COALESCE(date,created_at)) BETWEEN date(?) AND date(?)`).bind(...orderBinds).all(),
    env.DB.prepare(`SELECT oi.order_id,oi.product_id,oi.variant_id,oi.qty FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.client_id=oi.client_id WHERE oi.client_id=?${storeItems?' AND oi.store_id=?':''} AND date(COALESCE(o.date,o.created_at)) BETWEEN date(?) AND date(?)`).bind(...orderBinds).all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT id,cost FROM products WHERE client_id=?${storeCatalog}`).bind(...scopeBinds).all(),
    env.DB.prepare(`SELECT id,product_id,cost FROM product_variants WHERE client_id=?${storeCatalog}`).bind(...scopeBinds).all()
  ]);
  const orders=orderResult.results||[],itemsByOrder=new Map();
  for(const item of itemResult.results||[]){const id=costKey(item.order_id);if(!itemsByOrder.has(id))itemsByOrder.set(id,[]);itemsByOrder.get(id).push(item);}
  const catalog=buildCatalogCosts(productResult.results||[],variantResult.results||[]),costByOrder=new Map();
  for(const order of orders)costByOrder.set(costKey(order.id),currentOrderCost(order,itemsByOrder,catalog));

  const eligible=orders.filter(order=>!excludedStates.has(clean(order.state))),productCost=round(eligible.reduce((sum,order)=>sum+num(costByOrder.get(costKey(order.id))),0));
  const revenue=num(snapshot.finance?.revenue??snapshot.overview?.expectedRevenue),expenses=num(snapshot.finance?.expenses),grossProfit=round(revenue-productCost),netProfit=round(grossProfit-expenses),profitMargin=revenue?round(netProfit/revenue*100):0;
  snapshot.finance={...(snapshot.finance||{}),productCost,grossProfit,netProfit};
  snapshot.overview={...(snapshot.overview||{}),netProfit,profitMargin,productCostSource:'current_inventory'};
  updateMarginDetails(snapshot,productCost,netProfit,profitMargin);

  if(Array.isArray(snapshot.trend?.points)){
    const granularity=snapshot.trend.granularity||'day',costByBucket=new Map();
    for(const order of eligible){const key=bucketFor(dateKey(order.date||order.created_at),granularity);costByBucket.set(key,round(num(costByBucket.get(key))+num(costByOrder.get(costKey(order.id)))));}
    snapshot.trend.points=snapshot.trend.points.map(point=>{
      const productCostPoint=round(num(costByBucket.get(clean(point.key)))),revenuePoint=num(point.revenue),operating=num(point.adSpend)+num(point.otherExpenses)+num(point.shipping)+num(point.orderOther)+num(point.adminFees),gross=round(revenuePoint-productCostPoint);
      return {...point,productCost:productCostPoint,grossProfit:gross,netProfit:round(gross-operating)};
    });
  }
  snapshot.costing={source:'current_inventory',variantFirst:true,historicalFallback:true,updatedAt:new Date().toISOString()};
  return snapshot;
}
