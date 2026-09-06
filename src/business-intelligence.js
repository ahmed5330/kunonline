import {campaignPerformance} from './marketing-performance.js';
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const pct=(a,b)=>b?r2(a/b*100):0;

function recommendation(type,severity,title,detail,action=null){return {type,severity,title,detail,action};}
function compactCampaign(c){return {id:c.id,name:c.name,platform:c.platform,status:c.status,spend:r2(c.spend),impressions:n(c.impressions),reach:n(c.reach),clicks:n(c.clicks),ctr:r2(c.ctr),cpc:r2(c.cpc),cpm:r2(c.cpm),frequency:r2(c.frequency),leads:n(c.leads),platformPurchases:n(c.platformPurchases),platformPurchaseValue:r2(c.platformPurchaseValue),platformCpp:r2(c.platformCpp),platformRoas:r2(c.platformRoas),realOrders:n(c.realOrders),confirmedOrders:n(c.confirmedOrders),deliveredOrders:n(c.deliveredOrders),cancelledOrders:n(c.cancelledOrders),returnedOrders:n(c.returnedOrders),realOrderCost:r2(c.realOrderCost),confirmedOrderCost:r2(c.confirmedOrderCost),deliveredOrderCost:r2(c.deliveredOrderCost),newCustomers:n(c.newCustomers),cac:r2(c.cac),deliveredRevenue:r2(c.deliveredRevenue),realRoas:r2(c.realRoas),cancellationRate:r2(c.cancellationRate),returnRate:r2(c.returnRate)};}
function ruleAdAnalysis(marketing){
  const campaigns=(marketing.campaigns||[]).filter(c=>n(c.spend)>0||n(c.impressions)>0||n(c.clicks)>0||n(c.realOrders)>0||n(c.platformPurchases)>0).map(compactCampaign);
  const paid=campaigns.filter(c=>c.spend>0),best=[...paid].filter(c=>c.realRoas>0).sort((a,b)=>b.realRoas-a.realRoas)[0]||null,worst=[...paid].sort((a,b)=>a.realRoas-b.realRoas)[0]||null;
  const risks=[];
  for(const c of paid){
    if(c.impressions>=1000&&c.ctr<1)risks.push({campaign:c.name,type:'low_ctr',detail:`CTR ${c.ctr}%`});
    if(c.realOrders>0&&c.confirmedOrders/Math.max(1,c.realOrders)<.6)risks.push({campaign:c.name,type:'low_confirmation',detail:`تأكيد ${pct(c.confirmedOrders,c.realOrders)}%`});
    if(c.deliveredOrders+c.returnedOrders>=3&&c.returnRate>20)risks.push({campaign:c.name,type:'high_returns',detail:`مرتجع ${c.returnRate}%`});
    if(c.platformRoas>=1.5&&c.realRoas<1)risks.push({campaign:c.name,type:'attribution_gap',detail:`ROAS المنصة ${c.platformRoas}x مقابل الحقيقي ${c.realRoas}x`});
  }
  return {summary:paid.length?`تم تحليل ${paid.length} حملة لها إنفاق داخل الفترة المحددة.`:'لا توجد حملات مدفوعة ذات إنفاق داخل الفترة المحددة.',campaignCount:campaigns.length,winners:best?[{campaign:best.name,detail:`Real ROAS ${best.realRoas}x — تكلفة الطلب ${best.realOrderCost}`}]:[],risks:risks.slice(0,12),campaigns};
}

export async function businessBrief(env,{clientId,storeId=null,from,to}){
  const storeSql=storeId?' AND store_id=?':'';const sb=storeId?[clientId,storeId]:[clientId];
  const [orders,inventory,finance,wallet,marketing]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled, SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned, SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered, COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue FROM orders WHERE client_id=? ${storeSql} AND date(date) BETWEEN date(?) AND date(?)`).bind(...(storeId?[clientId,storeId,from,to]:[clientId,from,to])).first(),
    env.DB.prepare(`SELECT COUNT(*) products, SUM(CASE WHEN stock<=low_stock_threshold THEN 1 ELSE 0 END) low_stock, SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) out_of_stock, COALESCE(SUM(stock*cost),0) inventory_value FROM products WHERE client_id=? ${storeSql} AND active=1`).bind(...sb).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expenses FROM transactions WHERE client_id=? ${storeSql} AND date(date) BETWEEN date(?) AND date(?)`).bind(...(storeId?[clientId,storeId,from,to]:[clientId,from,to])).first(),
    env.DB.prepare('SELECT balance,credit_limit,status,billing_version FROM wallet_accounts WHERE client_id=?').bind(clientId).first(),
    campaignPerformance(env,{clientId,storeId,from,to})
  ]);
  const recs=[];const total=n(orders?.total),del=n(orders?.delivered),cancel=n(orders?.cancelled),ret=n(orders?.returned),pending=n(orders?.pending),adAnalysis=ruleAdAnalysis(marketing);
  if(pending>0)recs.push(recommendation('operations','warning','طلبات تحتاج متابعة',`${pending} طلب ما زال في حالة Pending.`,'فتح الطلبات الجديدة'));
  if(total>=5&&pct(cancel,total)>20)recs.push(recommendation('operations','danger','نسبة الإلغاء مرتفعة',`الإلغاء ${pct(cancel,total)}% من الطلبات في الفترة.`,'راجع جودة الـleads وسرعة التأكيد'));
  if(total>=5&&pct(del,total)<60)recs.push(recommendation('shipping','warning','نسبة التسليم أقل من المستهدف',`تم تسليم ${pct(del,total)}% فقط من الطلبات.`,'قارن شركات الشحن وجودة العناوين'));
  if(n(inventory?.low_stock)>0)recs.push(recommendation('inventory','warning','مخزون منخفض',`${n(inventory.low_stock)} منتج وصل لحد إعادة الطلب.`,'إنشاء Purchase Order'));
  if(n(inventory?.out_of_stock)>0)recs.push(recommendation('inventory','danger','منتجات نفدت',`${n(inventory.out_of_stock)} منتج مخزونه صفر.`,'إعادة التوريد أو إيقاف الإعلان'));
  if(wallet&&n(wallet.balance)<=Math.max(20,marketing.total?.realOrderCost||0))recs.push(recommendation('wallet','warning','رصيد المحفظة منخفض',`الرصيد الحالي ${r2(wallet.balance)} EGP.`,'شحن المحفظة'));
  if(n(marketing.total?.spend)>0&&n(marketing.total?.realRoas)<1)recs.push(recommendation('marketing','danger','الإنفاق الإعلاني لا يغطي الإيراد المسلم',`Real ROAS = ${r2(marketing.total.realRoas)}x.`,'راجع الحملات والزوايا الإعلانية'));
  const activeCampaigns=adAnalysis.campaigns||[],totalCpp=n(marketing.total?.realOrderCost);
  for(const c of activeCampaigns){
    if(c.spend>0&&c.impressions>=1000&&c.ctr<1)recs.push(recommendation('marketing','warning',`CTR منخفض في ${c.name}`,`CTR = ${c.ctr}% مع إنفاق ${c.spend}.`,'اختبر Hook وزاوية وكريتيف مختلفين لهذه الحملة.'));
    if(c.spend>0&&totalCpp>0&&c.realOrderCost>totalCpp*1.5)recs.push(recommendation('marketing','warning',`تكلفة الطلب مرتفعة في ${c.name}`,`CPP الفعلي ${c.realOrderCost} مقابل متوسط ${r2(totalCpp)} للفترة.`,'خفّض الإنفاق أو اختبر Audience/Creative جديد قبل التوسع.'));
    if(c.platformRoas>=1.5&&c.realRoas<1)recs.push(recommendation('marketing','danger',`فجوة بين ROAS المنصة والحقيقي في ${c.name}`,`ROAS المنصة ${c.platformRoas}x بينما Real ROAS ${c.realRoas}x.`,'راجع جودة الطلبات والتأكيد والتسليم قبل زيادة الميزانية.'));
    if(c.deliveredOrders+c.returnedOrders>=3&&c.returnRate>20)recs.push(recommendation('marketing','danger',`مرتجعات مرتفعة من ${c.name}`,`نسبة المرتجع ${c.returnRate}% من نتائج الشحن المرتبطة بالحملة.`,'راجع الرسالة الإعلانية وتوقعات العميل والمحافظات القادمة من الحملة.'));
  }
  if(!recs.length)recs.push(recommendation('business','success','لا توجد إشارات حرجة','المؤشرات الرئيسية ضمن نطاق مستقر في الفترة المحددة.'));
  const metrics={period:{from,to},orders:{total,pending,cancelled:cancel,returned:ret,delivered:del,deliveredRevenue:r2(orders?.delivered_revenue)},inventory:{products:n(inventory?.products),lowStock:n(inventory?.low_stock),outOfStock:n(inventory?.out_of_stock),value:r2(inventory?.inventory_value)},finance:{income:r2(finance?.income),expenses:r2(finance?.expenses),net:r2(n(finance?.income)-n(finance?.expenses))},wallet:wallet||null,marketing:{...marketing.total,campaigns:activeCampaigns}};
  return {from,to,clientId,storeId,metrics,adAnalysis,recommendations:recs.slice(0,18)};
}

export async function persistBrief(env,{clientId,storeId=null,brief,actor=null}){
  const id=rid('AIS'),ts=now(),engine=brief?.ai?.used?(brief.ai.model||'ai'):'rules-v27';
  const recommendations=Array.isArray(brief?.recommendations)?brief.recommendations:[];
  const top=recommendations[0]||{};
  const severity=['info','warning','danger','success'].includes(top.severity)?top.severity:'info';
  const title=String(brief?.summary||top.title||'Kun AI Business Brief'),period={from:brief?.from||null,to:brief?.to||null};
  await env.DB.prepare(`INSERT INTO ai_insight_snapshots
    (id,client_id,store_id,insight_type,severity,title,rationale,metric_json,suggested_action_type,suggested_payload_json,status,generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,clientId,storeId||null,'business_brief',severity,title,
      String(top.detail||`Generated by ${engine}`),JSON.stringify({engine,period,summary:brief?.summary||'',metrics:brief?.metrics||{},adAnalysis:brief?.adAnalysis||null}),
      top.action?'review_business_brief':null,JSON.stringify({engine,period,summary:brief?.summary||'',adAnalysis:brief?.adAnalysis||null,recommendations}),
      'active',ts).run();
  return id;
}
