const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const pct=(a,b)=>b?r2(a/b*100):0;

export function dateRange(url){
  const to=url.searchParams.get('to')||new Date().toISOString().slice(0,10);
  const from=url.searchParams.get('from')||new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  return {from,to};
}

export async function campaignPerformance(env,{clientId,storeId=null,from,to,platform=null}){
  let campaignWhere='c.client_id=?',campaignBinds=[from,to,clientId];
  if(storeId){campaignWhere+=' AND c.store_id=?';campaignBinds.push(storeId)}
  if(platform){campaignWhere+=' AND c.platform=?';campaignBinds.push(platform)}
  const {results:campaigns=[]}=await env.DB.prepare(`
    SELECT c.id,c.store_id,c.platform,c.external_campaign_id,c.name,c.objective,c.status,c.currency,c.budget,
      COALESCE(SUM(m.spend),0) spend,COALESCE(SUM(m.impressions),0) impressions,
      COALESCE(SUM(m.reach),0) reach,COALESCE(SUM(m.clicks),0) clicks,COALESCE(SUM(m.leads),0) leads,
      CASE WHEN COALESCE(SUM(m.platform_purchases),0)>0 THEN SUM(m.platform_purchases) ELSE COALESCE(SUM(m.conversions),0) END platform_purchases,
      CASE WHEN COALESCE(SUM(m.platform_purchase_value),0)>0 THEN SUM(m.platform_purchase_value) ELSE COALESCE(SUM(m.revenue),0) END platform_purchase_value
    FROM marketing_campaigns c
    LEFT JOIN campaign_daily_metrics m ON m.client_id=c.client_id AND m.campaign_id=c.id
      AND m.store_id IS c.store_id AND m.metric_date BETWEEN ? AND ?
    WHERE ${campaignWhere}
    GROUP BY c.id ORDER BY c.updated_at DESC`).bind(...campaignBinds).all();

  // One aggregate attribution query for the entire selected period. The previous
  // implementation executed one D1 query per campaign, which could become slow
  // enough to surface as a 500 on 7/30-day dashboard ranges for stores with many campaigns.
  const attributionBinds=storeId?[clientId,from,to,storeId]:[clientId,from,to];
  const {results:attributionRows=[]}=await env.DB.prepare(`
    SELECT x.campaign_id,
      COUNT(*) real_orders,
      SUM(CASE WHEN o.state IN ('confirmed','preparing','shipped','signed','collected') THEN 1 ELSE 0 END) confirmed_orders,
      SUM(CASE WHEN o.state IN ('signed','collected') THEN 1 ELSE 0 END) delivered_orders,
      SUM(CASE WHEN o.state='cancelled' THEN 1 ELSE 0 END) cancelled_orders,
      SUM(CASE WHEN o.state='returned' THEN 1 ELSE 0 END) returned_orders,
      COALESCE(SUM(CASE WHEN o.state IN ('signed','collected') THEN o.total ELSE 0 END),0) delivered_revenue,
      COUNT(DISTINCT CASE WHEN o.customer_id IS NOT NULL AND date(o.date)=(
        SELECT MIN(date(o2.date)) FROM orders o2
        WHERE o2.client_id=o.client_id AND o2.customer_id=o.customer_id
      ) THEN o.customer_id END) new_customers
    FROM order_attribution x
    JOIN orders o ON o.id=x.order_id AND o.client_id=x.client_id
    WHERE x.client_id=? AND date(o.date) BETWEEN date(?) AND date(?) ${storeId?'AND o.store_id=?':''}
    GROUP BY x.campaign_id`).bind(...attributionBinds).all();
  const attribution=new Map(attributionRows.map(row=>[String(row.campaign_id),row]));

  const out=[];
  for(const c of campaigns){
    const a=attribution.get(String(c.id))||{};
    const spend=n(c.spend),impressions=n(c.impressions),reach=n(c.reach),clicks=n(c.clicks),real=n(a.real_orders),confirmed=n(a.confirmed_orders),delivered=n(a.delivered_orders),deliveredRevenue=n(a.delivered_revenue),platformPurchases=n(c.platform_purchases),platformPurchaseValue=n(c.platform_purchase_value),newCustomers=n(a.new_customers);
    out.push({...c,
      spend:r2(spend),impressions,clicks,reach,frequency:reach?r2(impressions/reach):0,leads:n(c.leads),platformPurchases,platformPurchaseValue:r2(platformPurchaseValue),
      ctr:pct(clicks,impressions),cpc:clicks?r2(spend/clicks):0,cpm:impressions?r2(spend/impressions*1000):0,platformRoas:spend?r2(platformPurchaseValue/spend):0,
      realOrders:real,confirmedOrders:confirmed,deliveredOrders:delivered,cancelledOrders:n(a.cancelled_orders),returnedOrders:n(a.returned_orders),
      platformCpp:platformPurchases?r2(spend/platformPurchases):0,realOrderCost:real?r2(spend/real):0,
      confirmedOrderCost:confirmed?r2(spend/confirmed):0,deliveredOrderCost:delivered?r2(spend/delivered):0,
      newCustomers,cac:newCustomers?r2(spend/newCustomers):0,deliveredRevenue:r2(deliveredRevenue),realRoas:spend?r2(deliveredRevenue/spend):0,
      cancellationRate:pct(n(a.cancelled_orders),real),returnRate:pct(n(a.returned_orders),Math.max(1,delivered+n(a.returned_orders)))
    });
  }
  const total=out.reduce((a,c)=>{for(const k of ['spend','impressions','clicks','reach','leads','platformPurchases','platformPurchaseValue','realOrders','confirmedOrders','deliveredOrders','cancelledOrders','returnedOrders','newCustomers','deliveredRevenue'])a[k]=(a[k]||0)+n(c[k]);return a;},{});
  const attributedOrders=total.realOrders||0;
  const overall=await env.DB.prepare(`SELECT COUNT(*) real_orders,
    SUM(CASE WHEN state IN ('confirmed','preparing','shipped','signed','collected') THEN 1 ELSE 0 END) confirmed_orders,
    SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered_orders,
    SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled_orders,
    SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned_orders,
    COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue,
    COUNT(DISTINCT customer_id) customers
    FROM orders WHERE client_id=? ${storeId?'AND store_id=?':''} AND date(date) BETWEEN date(?) AND date(?)`)
    .bind(...(storeId?[clientId,storeId,from,to]:[clientId,from,to])).first();
  total.attributedOrders=attributedOrders;total.realOrders=n(overall?.real_orders);total.unattributedOrders=Math.max(0,total.realOrders-attributedOrders);total.confirmedOrders=n(overall?.confirmed_orders);total.deliveredOrders=n(overall?.delivered_orders);total.cancelledOrders=n(overall?.cancelled_orders);total.returnedOrders=n(overall?.returned_orders);total.deliveredRevenue=r2(overall?.delivered_revenue);total.customers=n(overall?.customers);
  total.ctr=pct(total.clicks,total.impressions);total.cpc=total.clicks?r2(total.spend/total.clicks):0;total.cpm=total.impressions?r2(total.spend/total.impressions*1000):0;total.frequency=total.reach?r2(total.impressions/total.reach):0;total.platformCpp=total.platformPurchases?r2(total.spend/total.platformPurchases):0;total.platformRoas=total.spend?r2(total.platformPurchaseValue/total.spend):0;total.realOrderCost=total.realOrders?r2(total.spend/total.realOrders):0;total.confirmedOrderCost=total.confirmedOrders?r2(total.spend/total.confirmedOrders):0;total.deliveredOrderCost=total.deliveredOrders?r2(total.spend/total.deliveredOrders):0;total.cac=total.customers?r2(total.spend/total.customers):0;total.realRoas=total.spend?r2(total.deliveredRevenue/total.spend):0;
  return {from,to,platform:platform||null,total,campaigns:out};
}
