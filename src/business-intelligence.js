import {campaignPerformance} from './marketing-performance.js';
const now=()=>new Date().toISOString();
const rid=p=>`${p}-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
const n=v=>Number(v)||0;
const r2=v=>Math.round(n(v)*100)/100;
const pct=(a,b)=>b?r2(a/b*100):0;

function recommendation(type,severity,title,detail,action=null){return {type,severity,title,detail,action};}

export async function businessBrief(env,{clientId,storeId=null,from,to}){
  const storeSql=storeId?' AND store_id=?':'';const sb=storeId?[clientId,storeId]:[clientId];
  const [orders,inventory,finance,wallet,marketing]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN state='cancelled' THEN 1 ELSE 0 END) cancelled, SUM(CASE WHEN state='returned' THEN 1 ELSE 0 END) returned, SUM(CASE WHEN state IN ('signed','collected') THEN 1 ELSE 0 END) delivered, COALESCE(SUM(CASE WHEN state IN ('signed','collected') THEN total ELSE 0 END),0) delivered_revenue FROM orders WHERE client_id=? ${storeSql} AND date(date) BETWEEN date(?) AND date(?)`).bind(...(storeId?[clientId,storeId,from,to]:[clientId,from,to])).first(),
    env.DB.prepare(`SELECT COUNT(*) products, SUM(CASE WHEN stock<=low_stock_threshold THEN 1 ELSE 0 END) low_stock, SUM(CASE WHEN stock<=0 THEN 1 ELSE 0 END) out_of_stock, COALESCE(SUM(stock*cost),0) inventory_value FROM products WHERE client_id=? ${storeSql} AND active=1`).bind(...sb).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expenses FROM transactions WHERE client_id=? ${storeSql} AND date(date) BETWEEN date(?) AND date(?)`).bind(...(storeId?[clientId,storeId,from,to]:[clientId,from,to])).first(),
    env.DB.prepare('SELECT balance,credit_limit,status,billing_version FROM wallet_accounts WHERE client_id=?').bind(clientId).first(),
    campaignPerformance(env,{clientId,storeId,from,to})
  ]);
  const recs=[];const total=n(orders?.total),del=n(orders?.delivered),cancel=n(orders?.cancelled),ret=n(orders?.returned),pending=n(orders?.pending);
  if(pending>0)recs.push(recommendation('operations','warning','طلبات تحتاج متابعة',`${pending} طلب ما زال في حالة Pending.`,'فتح الطلبات الجديدة'));
  if(total>=5&&pct(cancel,total)>20)recs.push(recommendation('operations','danger','نسبة الإلغاء مرتفعة',`الإلغاء ${pct(cancel,total)}% من الطلبات في الفترة.`,'راجع جودة الـleads وسرعة التأكيد'));
  if(total>=5&&pct(del,total)<60)recs.push(recommendation('shipping','warning','نسبة التسليم أقل من المستهدف',`تم تسليم ${pct(del,total)}% فقط من الطلبات.`,'قارن شركات الشحن وجودة العناوين'));
  if(n(inventory?.low_stock)>0)recs.push(recommendation('inventory','warning','مخزون منخفض',`${n(inventory.low_stock)} منتج وصل لحد إعادة الطلب.`,'إنشاء Purchase Order'));
  if(n(inventory?.out_of_stock)>0)recs.push(recommendation('inventory','danger','منتجات نفدت',`${n(inventory.out_of_stock)} منتج مخزونه صفر.`,'إعادة التوريد أو إيقاف الإعلان'));
  if(wallet&&n(wallet.balance)<=Math.max(20,marketing.total?.realOrderCost||0))recs.push(recommendation('wallet','warning','رصيد المحفظة منخفض',`الرصيد الحالي ${r2(wallet.balance)} EGP.`,'شحن المحفظة'));
  if(n(marketing.total?.spend)>0&&n(marketing.total?.realRoas)<1)recs.push(recommendation('marketing','danger','الإنفاق الإعلاني لا يغطي الإيراد المسلم',`Real ROAS = ${r2(marketing.total.realRoas)}x.`,'راجع الحملات والزوايا الإعلانية'));
  const worst=[...marketing.campaigns].filter(c=>c.spend>0).sort((a,b)=>a.realRoas-b.realRoas)[0];if(worst&&worst.realRoas<1)recs.push(recommendation('marketing','warning','حملة تحتاج تدخل',`${worst.name}: Real ROAS ${worst.realRoas}x وDelivered CPP ${worst.deliveredOrderCost} EGP.`,'اقتراح خفض/إيقاف عبر Ad Studio'));
  if(!recs.length)recs.push(recommendation('business','success','لا توجد إشارات حرجة','المؤشرات الرئيسية ضمن نطاق مستقر في الفترة المحددة.'));
  const metrics={orders:{total,pending,cancelled:cancel,returned:ret,delivered:del,deliveredRevenue:r2(orders?.delivered_revenue)},inventory:{products:n(inventory?.products),lowStock:n(inventory?.low_stock),outOfStock:n(inventory?.out_of_stock),value:r2(inventory?.inventory_value)},finance:{income:r2(finance?.income),expenses:r2(finance?.expenses),net:r2(n(finance?.income)-n(finance?.expenses))},wallet:wallet||null,marketing:marketing.total};
  return {from,to,clientId,storeId,metrics,recommendations:recs};
}

export async function persistBrief(env,{clientId,storeId=null,brief,actor=null}){
  const id=rid('AIS'),ts=now(),engine=brief?.ai?.used?(brief.ai.model||'ai'):'rules-v27';
  await env.DB.prepare('INSERT INTO ai_insight_snapshots (id,client_id,store_id,scope,engine,summary,metrics_json,recommendations_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id,clientId,storeId||null,'business',engine,String(brief?.summary||brief?.recommendations?.[0]?.title||''),JSON.stringify(brief?.metrics||{}),JSON.stringify(brief?.recommendations||[]),ts).run();
  return id;
}

