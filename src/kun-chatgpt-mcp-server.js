import {verifyKunMcpBearer,mcpChallenge,KUN_MCP_RESOURCE} from './kun-chatgpt-mcp-oauth.js';

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const err=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
const result=(id,data)=>({jsonrpc:'2.0',id,result:data});
const DAY=86400000;
function period(days){
 if(!Number.isInteger(days)||days<1||days>90)throw Object.assign(new Error('اختر مدة من 1 إلى 90 يومًا'),{code:-32602});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'})
   .formatToParts(new Date()).reduce((acc,v)=>(v.type!=='literal'&&(acc[v.type]=v.value),acc),{});
 const to=today.year+'-'+today.month+'-'+today.day;
 const from=new Date(Date.parse(to+'T12:00:00Z')-(days-1)*DAY).toISOString().slice(0,10);
 return {days,from,to};
}
const DATE_SQL="substr(COALESCE(NULLIF(o.date,''),o.created_at),1,10) BETWEEN ? AND ?";
const CANONICAL="NOT EXISTS (SELECT 1 FROM order_duplicate_links d WHERE d.duplicate_order_id=o.id)";
const where=`o.client_id=? AND o.store_id=? AND ${DATE_SQL} AND ${CANONICAL}`;
const bind=(auth,p)=>[auth.clientId,auth.storeId,p.from,p.to];
async function stateCounts(env,auth,p){
 const {results=[]}=await env.DB.prepare(`SELECT COALESCE(o.state,'pending') state,COUNT(*) orders,COALESCE(SUM(o.total),0) amount FROM orders o WHERE ${where} GROUP BY o.state ORDER BY orders DESC`).bind(...bind(auth,p)).all();
 return results.map(x=>({state:String(x.state||'pending'),orders:Number(x.orders||0),orderValue:Number(x.amount||0)}));
}
async function spend(env,auth,p){
 try{
  const row=await env.DB.prepare('SELECT COALESCE(SUM(spend),0) spend,COUNT(DISTINCT metric_date) reportedDays FROM campaign_daily_metrics WHERE client_id=? AND store_id=? AND metric_date BETWEEN ? AND ?').bind(...bind(auth,p)).first();
  return {reportedSpend:Number(row?.spend||0),reportedDays:Number(row?.reportedDays||0),currency:'حسب إعدادات الحساب الإعلاني',note:'المبلغ من بيانات الحملات المستوردة فقط؛ صفر لا يعني بالضرورة عدم الإنفاق.'};
 }catch{return {available:false,message:'تعذر قراءة بيانات الإنفاق الإعلاني لهذا المتجر حاليًا.'};}
}
async function topProducts(env,auth,p){
 const {results=[]}=await env.DB.prepare(`SELECT COALESCE(NULLIF(trim(o.product),''),'غير محدد') product,
 SUM(COALESCE(o.qty,1)) units,COUNT(*) orders
 FROM orders o WHERE ${where} AND o.state NOT IN ('cancelled','returned')
 GROUP BY product ORDER BY units DESC LIMIT 10`).bind(...bind(auth,p)).all();
 return results.map(x=>({product:x.product,units:Number(x.units||0),orders:Number(x.orders||0)}));
}
export const KUN_MCP_TOOLS=[
 {name:'get_store_overview',description:'Read aggregate order counts, order value and imported ad spend for the connected Kun Online store. Never includes customer names, phones or addresses.'},
 {name:'get_order_funnel',description:'Analyze aggregate order status funnel for the connected store (pending, confirmed, shipping, collected, cancelled, returned). No customer personal data.'},
 {name:'get_ads_spend',description:'Check imported Meta campaign spending totals for the connected store. Distinguishes missing data from zero spend.'},
 {name:'get_top_products',description:'List the ten highest-volume products by ordered units, excluding cancelled and returned orders. No personal customer data.'}
].map(x=>({...x,inputSchema:{type:'object',properties:{days:{type:'integer',minimum:1,maximum:90,default:30,description:'Reporting window, including today; maximum 90 days'}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:['kun:read']}]}));
export async function runKunMcpTool(env,auth,name,args={}){
 if(!KUN_MCP_TOOLS.some(x=>x.name===name))throw Object.assign(new Error('الأداة المطلوبة غير متاحة'),{code:-32602});
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='days'))throw Object.assign(new Error('معاملات غير صحيحة'),{code:-32602});
 const p=period(args.days===undefined?30:args.days),base={store:{name:auth.storeName,id:auth.storeId},period:p,source:'Kun Online'};
 if(name==='get_order_funnel')return {...base,states:await stateCounts(env,auth,p)};
 if(name==='get_ads_spend')return {...base,advertising:await spend(env,auth,p)};
 if(name==='get_top_products')return {...base,products:await topProducts(env,auth,p)};
 const states=await stateCounts(env,auth,p);
 const totalOrders=states.reduce((sum,x)=>sum+x.orders,0),grossOrderValue=states.reduce((sum,x)=>sum+x.orderValue,0);
 const cancelled=states.find(x=>x.state==='cancelled')?.orders||0,returned=states.find(x=>x.state==='returned')?.orders||0;
 return {...base,orders:{total:totalOrders,byState:states,grossOrderValue,notFinancialRevenue:true,cancellationRate:totalOrders?Math.round(10000*cancelled/totalOrders)/100:0,returnRate:totalOrders?Math.round(10000*returned/totalOrders)/100:0},advertising:await spend(env,auth,p),
  interpretationNotes:['إجمالي قيمة الطلبات ليس صافي أرباح أو مبالغ تم تحصيلها','البيانات مقيدة بالمتجر المختار وقت التفويض','لا توجد تفاصيل تعريفية للعملاء']};
}
export async function handleKunMcpServer({request,env}){
 if(new URL(request.url).pathname!=='/mcp')return null;
 const authorized=await verifyKunMcpBearer(request,env);
 if(!authorized)return mcpChallenge();
 const method=request.method.toUpperCase();
 if(method==='GET')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
 if(method==='DELETE')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
 if(method!=='POST')return json(err(null,-32600,'Unsupported transport method'),405);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json(err(null,-32600,'Content-Type must be application/json'),415);
 const length=Number(request.headers.get('content-length')||0);
 if(length>20000)return json(err(null,-32600,'Payload too large'),413);
 let data;
 try{const body=await request.text();if(body.length>20000)return json(err(null,-32600,'Payload too large'),413);data=JSON.parse(body);}catch{return json(err(null,-32700,'Parse error'),400);}
 if(!data||Array.isArray(data)||typeof data!=='object'||data.jsonrpc!=='2.0')return json(err(null,-32600,'Invalid request'));
 if(data.method==='notifications/initialized')return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
 if(data.method==='initialize')return json(result(data.id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'kun-online',version:'1.0.0'}}));
 if(data.method==='ping')return json(result(data.id,{}));
 if(data.method==='tools/list')return json(result(data.id,{tools:KUN_MCP_TOOLS}));
 if(data.method==='tools/call'){
  try{
   const {name,arguments:args={}}=data.params||{};
   const payload=await runKunMcpTool(env,authorized,name,args);
   return json(result(data.id,{content:[{type:'text',text:JSON.stringify(payload)}],structuredContent:payload,isError:false}));
  }catch(error){return json(result(data.id,{content:[{type:'text',text:error?.message||'تعذر تنفيذ التحليل'}],isError:true}));}
 }
 return json(err(data.id,-32601,'Method not found'));
}
