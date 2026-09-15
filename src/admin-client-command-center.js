import {listAdminClients,clientOverview,requireAdmin} from './admin-control.js';
import {businessBrief} from './business-intelligence.js';

const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const clean=v=>String(v??'').trim();
const pct=(a,b)=>b?r2(n(a)/n(b)*100):0;
const PRESETS=new Set(['today','yesterday','7d','30d','mtd','custom']);

function cairoParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=t=>parts.find(x=>x.type===t)?.value||'';
  return {year:Number(get('year')),month:Number(get('month')),day:Number(get('day')),ymd:`${get('year')}-${get('month')}-${get('day')}`};
}
function utcDay(ymd){const [y,m,d]=String(ymd).split('-').map(Number);return new Date(Date.UTC(y,m-1,d));}
function ymd(date){return date.toISOString().slice(0,10);}
function shift(ymdValue,days){const d=utcDay(ymdValue);d.setUTCDate(d.getUTCDate()+Number(days||0));return ymd(d);}
function validYmd(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!Number.isNaN(utcDay(value).getTime());}
function daysInclusive(from,to){return Math.floor((utcDay(to)-utcDay(from))/86400000)+1;}

export function resolveAdminBriefRange({preset='today',from='',to='',now=new Date()}={}){
  preset=PRESETS.has(clean(preset))?clean(preset):'today';const today=cairoParts(now).ymd;let start=today,end=today,label='اليوم';
  if(preset==='yesterday'){start=end=shift(today,-1);label='أمس';}
  else if(preset==='7d'){start=shift(today,-6);label='آخر 7 أيام';}
  else if(preset==='30d'){start=shift(today,-29);label='آخر 30 يوم';}
  else if(preset==='mtd'){const p=cairoParts(now);start=`${p.year}-${String(p.month).padStart(2,'0')}-01`;label='من بداية الشهر';}
  else if(preset==='custom'){
    if(!validYmd(from)||!validYmd(to))throw Object.assign(new Error('حدد تاريخ بداية ونهاية صحيحين'),{status:400,code:'ADMIN_BRIEF_DATE_REQUIRED'});
    start=String(from);end=String(to);label='فترة مخصصة';
  }
  if(utcDay(start)>utcDay(end))throw Object.assign(new Error('تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية'),{status:400,code:'ADMIN_BRIEF_DATE_ORDER'});
  const days=daysInclusive(start,end);if(days>366)throw Object.assign(new Error('الحد الأقصى للبريف سنة واحدة'),{status:400,code:'ADMIN_BRIEF_RANGE_TOO_LARGE'});
  const previousTo=shift(start,-1),previousFrom=shift(previousTo,-days+1);
  return {preset,from:start,to:end,label,days,previous:{from:previousFrom,to:previousTo,label:'الفترة السابقة'}};
}

function mapBy(rows,key='client_id'){return new Map((rows||[]).map(row=>[String(row[key]||''),row]));}
function riskCount({orders={},inventory={},walletBalance=0,marketing={}}={}){
  let count=0;if(n(orders.pending)>0)count++;if(n(orders.total)>=5&&pct(orders.cancelled,orders.total)>20)count++;if(n(orders.total)>=5&&pct(orders.returned,orders.total)>15)count++;if(n(inventory.low_stock)>0)count++;if(n(inventory.out_of_stock)>0)count++;if(n(walletBalance)<=0)count++;if(n(marketing.spend)>0&&n(marketing.realRoas)<1)count++;return count;
}
function compactHomeClient(base,order={},inventory={},ads={},finance={}){
  const orders={total:n(order.total),gmv:r2(order.gmv),pending:n(order.pending),confirmed:n(order.confirmed),shipped:n(order.shipped),delivered:n(order.delivered),collected:n(order.collected),collectedAmount:r2(order.collected_amount),cancelled:n(order.cancelled),returned:n(order.returned),deliveredRevenue:r2(order.delivered_revenue),customers:n(order.customers),aov:n(order.total)?r2(n(order.gmv)/n(order.total)):0};
  orders.deliveryRate=pct(orders.delivered,orders.total);orders.cancellationRate=pct(orders.cancelled,orders.total);orders.returnRate=pct(orders.returned,Math.max(1,orders.delivered+orders.returned));
  const marketing={spend:r2(ads.spend),impressions:n(ads.impressions),clicks:n(ads.clicks),ctr:pct(ads.clicks,ads.impressions),cpc:n(ads.clicks)?r2(n(ads.spend)/n(ads.clicks)):0,realOrderCost:orders.total?r2(n(ads.spend)/orders.total):0,deliveredOrderCost:orders.delivered?r2(n(ads.spend)/orders.delivered):0,realRoas:n(ads.spend)?r2(orders.deliveredRevenue/n(ads.spend)):0};
  const stock={products:n(inventory.products),lowStock:n(inventory.low_stock),outOfStock:n(inventory.out_of_stock)};
  const cash={income:r2(finance.income),expenses:r2(finance.expenses),net:r2(n(finance.income)-n(finance.expenses))};
  const alerts=riskCount({orders,inventory:stock,walletBalance:base.walletBalance,marketing});
  return {...base,orders,marketing,inventory:stock,finance:cash,alerts};
}

export async function adminClientCommandCenter(env,{me,range}={}){
  requireAdmin(me);const period=range||resolveAdminBriefRange();const clients=await listAdminClients(env);
  const [orderRows,inventoryRows,adRows,financeRows]=await Promise.all([
    env.DB.prepare(`SELECT client_id,COUNT(*) total,COALESCE(SUM(total),0) gmv,
      SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN state IN ('confirmed','preparing') THEN 1 ELSE 0 END) confirmed,
      SUM(CASE WHEN state='shipped' THEN 1 ELSE 0 END) shipped,
      SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered,
      SUM(CASE WHEN state='collected' THEN 1 ELSE 0 END) collected,
      COALESCE(SUM(CASE WHEN state='collected' THEN COALESCE(collected_amount,total,0) ELSE 0 END),0) collected_amount,
      SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,
      SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned,
      COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue,
      COUNT(DISTINCT customer_id) customers
      FROM orders WHERE date(date) BETWEEN date(?) AND date(?) GROUP BY client_id`).bind(period.from,period.to).all(),
    env.DB.prepare(`SELECT client_id,COUNT(*) products,
      SUM(CASE WHEN stock<=low_stock_threshold THEN 1 ELSE 0 END) low_stock,
      SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) out_of_stock
      FROM products WHERE active=1 GROUP BY client_id`).all(),
    env.DB.prepare(`SELECT client_id,COALESCE(SUM(spend),0) spend,COALESCE(SUM(impressions),0) impressions,COALESCE(SUM(clicks),0) clicks
      FROM campaign_daily_metrics WHERE metric_date BETWEEN ? AND ? GROUP BY client_id`).bind(period.from,period.to).all().catch(()=>({results:[]})),
    env.DB.prepare(`SELECT client_id,
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expenses
      FROM transactions WHERE date(date) BETWEEN date(?) AND date(?) AND client_id IS NOT NULL GROUP BY client_id`).bind(period.from,period.to).all().catch(()=>({results:[]}))
  ]);
  const om=mapBy(orderRows.results),im=mapBy(inventoryRows.results),am=mapBy(adRows.results),fm=mapBy(financeRows.results);
  const rows=clients.map(c=>compactHomeClient(c,om.get(String(c.clientId))||{},im.get(String(c.clientId))||{},am.get(String(c.clientId))||{},fm.get(String(c.clientId))||{}));
  rows.sort((a,b)=>Number(b.status==='active')-Number(a.status==='active')||n(b.alerts)-n(a.alerts)||n(b.orders.total)-n(a.orders.total)||String(b.lastOrderAt||'').localeCompare(String(a.lastOrderAt||'')));
  const totals=rows.reduce((a,c)=>{a.orders+=c.orders.total;a.gmv+=c.orders.gmv;a.deliveredRevenue+=c.orders.deliveredRevenue;a.collectedAmount+=c.orders.collectedAmount;a.spend+=c.marketing.spend;a.alerts+=c.alerts;if(c.status==='active')a.activeClients++;return a;},{clients:rows.length,activeClients:0,orders:0,gmv:0,deliveredRevenue:0,collectedAmount:0,spend:0,alerts:0});
  for(const k of ['gmv','deliveredRevenue','collectedAmount','spend'])totals[k]=r2(totals[k]);
  return {ok:true,period,totals,clients:rows};
}

async function commercePeriodStats(env,{clientId,from,to}){
  const row=await env.DB.prepare(`SELECT COUNT(*) total,COALESCE(SUM(total),0) gmv,
    SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN state IN ('confirmed','preparing','shipped','signed','collected') THEN 1 ELSE 0 END) confirmed,
    SUM(CASE WHEN state='shipped' THEN 1 ELSE 0 END) shipped,
    SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered,
    SUM(CASE WHEN state='collected' THEN 1 ELSE 0 END) collected,
    COALESCE(SUM(CASE WHEN state='collected' THEN COALESCE(collected_amount,total,0) ELSE 0 END),0) collected_amount,
    SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled,
    SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned,
    COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue,
    COUNT(DISTINCT customer_id) customers
    FROM orders WHERE client_id=? AND date(date) BETWEEN date(?) AND date(?)`).bind(clientId,from,to).first();
  const total=n(row?.total),delivered=n(row?.delivered),returned=n(row?.returned);return {total,gmv:r2(row?.gmv),pending:n(row?.pending),confirmed:n(row?.confirmed),shipped:n(row?.shipped),delivered,collected:n(row?.collected),collectedAmount:r2(row?.collected_amount),cancelled:n(row?.cancelled),returned,deliveredRevenue:r2(row?.delivered_revenue),customers:n(row?.customers),aov:total?r2(n(row?.gmv)/total):0,confirmationRate:pct(row?.confirmed,total),deliveryRate:pct(delivered,total),cancellationRate:pct(row?.cancelled,total),returnRate:pct(returned,Math.max(1,delivered+returned))};
}
function change(current,previous){current=n(current);previous=n(previous);if(previous===0)return current===0?0:null;return r2((current-previous)/Math.abs(previous)*100);}
function compareBrief(current,previous){
  const cm=current.metrics||{},pm=previous.metrics||{},co=current.commerce||{},po=previous.commerce||{};
  return {ordersPct:change(co.total,po.total),gmvPct:change(co.gmv,po.gmv),deliveredRevenuePct:change(co.deliveredRevenue,po.deliveredRevenue),collectedAmountPct:change(co.collectedAmount,po.collectedAmount),aovPct:change(co.aov,po.aov),spendPct:change(cm.marketing?.spend,pm.marketing?.spend),netPct:change(cm.finance?.net,pm.finance?.net),realRoasDelta:r2(n(cm.marketing?.realRoas)-n(pm.marketing?.realRoas)),deliveryRateDelta:r2(n(co.deliveryRate)-n(po.deliveryRate)),cancellationRateDelta:r2(n(co.cancellationRate)-n(po.cancellationRate)),returnRateDelta:r2(n(co.returnRate)-n(po.returnRate))};
}

export async function adminClientCommandBrief(env,{me,clientId,range}={}){
  requireAdmin(me);clientId=clean(clientId);if(!clientId)throw Object.assign(new Error('حدد العميل'),{status:400,code:'CLIENT_ID_REQUIRED'});const period=range||resolveAdminBriefRange();
  const overview=await clientOverview(env,clientId),previous=period.previous;
  const [currentBrief,previousBrief,currentCommerce,previousCommerce,stores,subscription]=await Promise.all([
    businessBrief(env,{clientId,from:period.from,to:period.to}),businessBrief(env,{clientId,from:previous.from,to:previous.to}),
    commercePeriodStats(env,{clientId,from:period.from,to:period.to}),commercePeriodStats(env,{clientId,from:previous.from,to:previous.to}),
    env.DB.prepare(`SELECT id,name,code,status,is_default,currency,timezone FROM stores WHERE client_id=? ORDER BY is_default DESC,created_at,id`).bind(clientId).all(),
    env.DB.prepare(`SELECT plan,status,billing_cycle,amount,currency,updated_at FROM subscriptions WHERE client_id=? ORDER BY updated_at DESC,created_at DESC LIMIT 1`).bind(clientId).first().catch(()=>null)
  ]);
  currentBrief.commerce=currentCommerce;previousBrief.commerce=previousCommerce;
  const comparison=compareBrief(currentBrief,previousBrief);
  const contact={ownerName:overview.ownerName||'',ownerEmail:overview.ownerEmail||'',phone:overview.phone||''};
  return {ok:true,client:{clientId,name:overview.name,status:overview.status,plan:overview.plan,...contact,lastOrderAt:overview.lastOrderAt,teamMembers:overview.teamMembers,storesCount:overview.stores,integrations:overview.integrations,connectedIntegrations:overview.connectedIntegrations,walletBalance:overview.walletBalance},period,current:currentBrief,previous:{from:previous.from,to:previous.to,metrics:previousBrief.metrics,commerce:previousCommerce},comparison,stores:stores.results||[],subscription:subscription||null,account:{wallet:overview.wallet,features:overview.features,challenges:overview.challenges,inventory:overview.inventory,notes:overview.notes}};
}
