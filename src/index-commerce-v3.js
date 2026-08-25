import workerV2 from './index-commerce-v2.js';
import {requirePermission} from './access-control.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
const now=()=>new Date().toISOString();
const id=p=>`${p}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const round2=v=>Math.round((num(v)+Number.EPSILON)*100)/100;

async function meFromBase(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await workerV2.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data?.role) throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return data;
}
function targetClient(me,requested){
  if(me.role==='client'){
    if(requested&&String(requested)!==String(me.clientId)) throw Object.assign(new Error('مش مسموح'),{status:403});
    return me.clientId;
  }
  if(!requested) throw Object.assign(new Error('محتاج clientId'),{status:400});
  return requested;
}
function canFinanceWrite(me){return me.role==='admin'||me.role==='accountant'||(me.perms||[]).includes('finance')||(me.perms||[]).includes('settings');}
async function audit(env,me,clientId,action,entityType,entityId,metadata={}){
  try{
    await env.DB.prepare(`INSERT INTO audit_log (id,client_id,actor_user_id,actor_email,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id('AUD'),clientId,me.uid||null,me.email||null,action,entityType,entityId,JSON.stringify(metadata),now()).run();
  }catch(_){/* audit must not hide the primary response on preview */}
}

function orderEconomics(o){
  const qty=Math.max(1,num(o.qty)||1);
  const gross=num(o.total);
  const discount=num(o.discount_amount);
  const refunds=num(o.refund_amount);
  const netRevenue=Math.max(0,gross-discount-refunds);
  const cogs=Math.max(0,num(o.product_cost)*qty);
  const shipping=Math.max(0,num(o.shipping_cost));
  const other=Math.max(0,num(o.other_cost));
  const contribution=netRevenue-cogs-shipping-other;
  return {gross,discount,refunds,netRevenue,cogs,shipping,other,contribution};
}
async function profitIntelligence(env,clientId,url){
  const from=url.searchParams.get('from');
  const to=url.searchParams.get('to');
  const groupBy=url.searchParams.get('groupBy')||'summary';
  let sql='SELECT id,date,name,product,product_id,qty,total,discount_amount,refund_amount,product_cost,shipping_cost,other_cost,source,state FROM orders WHERE client_id=?';
  const binds=[clientId];
  if(from){sql+=' AND date>=?';binds.push(from)}
  if(to){sql+=' AND date<=?';binds.push(to)}
  sql+=' ORDER BY date DESC LIMIT 5000';
  const {results}=await env.DB.prepare(sql).bind(...binds).all();
  const rows=(results||[]).map(o=>({...o,economics:orderEconomics(o)}));
  const sum=rows.reduce((a,o)=>{const e=o.economics;a.orders++;a.gross+=e.gross;a.discount+=e.discount;a.refunds+=e.refunds;a.netRevenue+=e.netRevenue;a.cogs+=e.cogs;a.shipping+=e.shipping;a.other+=e.other;a.contribution+=e.contribution;return a},{orders:0,gross:0,discount:0,refunds:0,netRevenue:0,cogs:0,shipping:0,other:0,contribution:0});
  let txSql=`SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expenses, COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income FROM transactions WHERE (client_id=? OR client_id IS NULL)`;
  const txBinds=[clientId];
  if(from){txSql+=' AND date>=?';txBinds.push(from)}
  if(to){txSql+=' AND date<=?';txBinds.push(to)}
  const tx=await env.DB.prepare(txSql).bind(...txBinds).first();
  const operatingExpenses=num(tx?.expenses);
  const otherIncome=num(tx?.income);
  const netProfit=sum.contribution-operatingExpenses+otherIncome;
  const summary={...Object.fromEntries(Object.entries(sum).map(([k,v])=>[k,typeof v==='number'?round2(v):v])),operatingExpenses:round2(operatingExpenses),otherIncome:round2(otherIncome),netProfit:round2(netProfit),marginPct:sum.netRevenue?round2(netProfit/sum.netRevenue*100):0};
  if(groupBy==='summary') return {summary};
  const keyFor=o=>groupBy==='product'?(o.product_id||o.product||'غير محدد'):groupBy==='source'?(o.source||'غير محدد'):o.id;
  const groups=new Map();
  for(const o of rows){const key=String(keyFor(o));const g=groups.get(key)||{key,label:groupBy==='order'?o.id:groupBy==='product'?(o.product||key):key,orders:0,netRevenue:0,cogs:0,shipping:0,other:0,contribution:0};const e=o.economics;g.orders++;g.netRevenue+=e.netRevenue;g.cogs+=e.cogs;g.shipping+=e.shipping;g.other+=e.other;g.contribution+=e.contribution;groups.set(key,g)}
  const breakdown=[...groups.values()].map(g=>({...g,netRevenue:round2(g.netRevenue),cogs:round2(g.cogs),shipping:round2(g.shipping),other:round2(g.other),contribution:round2(g.contribution),marginPct:g.netRevenue?round2(g.contribution/g.netRevenue*100):0})).sort((a,b)=>b.contribution-a.contribution);
  return {summary,groupBy,breakdown};
}

async function codCandidates(env,clientId){
  const {results}=await env.DB.prepare(`SELECT o.id,o.date,o.name,o.awb,o.total,o.discount_amount,o.refund_amount,o.state,o.checkpoint FROM orders o LEFT JOIN cod_reconciliation_items i ON i.client_id=o.client_id AND i.order_id=o.id WHERE o.client_id=? AND o.state='signed' AND i.id IS NULL ORDER BY o.date DESC LIMIT 500`).bind(clientId).all();
  return (results||[]).map(o=>({...o,expectedAmount:round2(Math.max(0,num(o.total)-num(o.discount_amount)-num(o.refund_amount)))}));
}
async function listReconciliations(env,clientId){
  const {results}=await env.DB.prepare(`SELECT id,provider,reference,status,expected_amount,actual_amount,difference,currency,reconciled_at,note,created_by,created_at,updated_at FROM cod_reconciliations WHERE client_id=? ORDER BY created_at DESC LIMIT 200`).bind(clientId).all();
  return results||[];
}
async function createReconciliation(request,env,me,clientId){
  if(!canFinanceWrite(me)) return json({error:'مش مسموح بتسوية التحصيلات'},403);
  const b=await request.json().catch(()=>({}));
  const orderIds=[...new Set((Array.isArray(b.orderIds)?b.orderIds:[]).map(String).filter(Boolean))];
  if(!orderIds.length) return json({error:'اختر طلبًا واحدًا على الأقل'},400);
  const placeholders=orderIds.map(()=>'?').join(',');
  const {results}=await env.DB.prepare(`SELECT o.id,o.awb,o.total,o.discount_amount,o.refund_amount FROM orders o LEFT JOIN cod_reconciliation_items i ON i.client_id=o.client_id AND i.order_id=o.id WHERE o.client_id=? AND o.state='signed' AND i.id IS NULL AND o.id IN (${placeholders})`).bind(clientId,...orderIds).all();
  if((results||[]).length!==orderIds.length) return json({error:'بعض الطلبات غير متاحة للتسوية أو تمت تسويتها سابقًا'},400);
  const expected=round2((results||[]).reduce((s,o)=>s+Math.max(0,num(o.total)-num(o.discount_amount)-num(o.refund_amount)),0));
  const actual=b.actualAmount===undefined||b.actualAmount===null||b.actualAmount===''?null:round2(Math.max(0,num(b.actualAmount)));
  const difference=actual===null?null:round2(actual-expected);
  const status=actual===null?'open':Math.abs(difference)<0.01?'reconciled':'disputed';
  const rid=id('COD'),ts=now();
  const stmts=[env.DB.prepare(`INSERT INTO cod_reconciliations (id,client_id,provider,reference,status,expected_amount,actual_amount,difference,currency,reconciled_at,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid,clientId,b.provider||null,b.reference||null,status,expected,actual,difference,b.currency||'EGP',status==='reconciled'?ts:null,b.note||'',me.email||me.uid||'',ts,ts)];
  for(const o of results||[]){const itemExpected=round2(Math.max(0,num(o.total)-num(o.discount_amount)-num(o.refund_amount)));stmts.push(env.DB.prepare(`INSERT INTO cod_reconciliation_items (id,reconciliation_id,client_id,order_id,awb,expected_amount,actual_amount,difference,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id('CODI'),rid,clientId,o.id,o.awb||null,itemExpected,null,null,'pending',ts));}
  await env.DB.batch(stmts);
  await audit(env,me,clientId,'cod_reconciliation.create','cod_reconciliation',rid,{orderCount:orderIds.length,expected,actual,difference,status});
  return json({ok:true,id:rid,status,expectedAmount:expected,actualAmount:actual,difference},201);
}

async function fetchV3(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path==='/api/profit-intelligence'&&request.method==='GET'){
      const me=await meFromBase(request,env,ctx);const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await profitIntelligence(env,clientId,url));
    }
    if(path==='/api/cod-reconciliation/candidates'&&request.method==='GET'){
      const me=await meFromBase(request,env,ctx);requirePermission(me,'cod','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await codCandidates(env,clientId));
    }
    if(path==='/api/cod-reconciliation'&&request.method==='GET'){
      const me=await meFromBase(request,env,ctx);requirePermission(me,'cod','read');const clientId=targetClient(me,url.searchParams.get('clientId')||(me.role==='client'?me.clientId:null));return json(await listReconciliations(env,clientId));
    }
    if(path==='/api/cod-reconciliation'&&request.method==='POST'){
      const me=await meFromBase(request,env,ctx);const b=await request.clone().json().catch(()=>({}));const clientId=targetClient(me,b.clientId||b.client_id||(me.role==='client'?me.clientId:null));return createReconciliation(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(b)}),env,me,clientId);
    }
    return workerV2.fetch(request,env,ctx);
  }catch(e){return json({error:e.message||'حدث خطأ'},e.status||500);}
}

export default {fetch:fetchV3,scheduled(controller,env,ctx){return workerV2.scheduled?.(controller,env,ctx);}};
