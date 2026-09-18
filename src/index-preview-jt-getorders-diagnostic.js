import app from './index-commerce-v38.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(v,max=700)=>String(v??'').trim().slice(0,max);
const parseArray=v=>{try{const x=JSON.parse(v||'[]');return Array.isArray(x)?x:[];}catch{return [];}};
function safeEq(a,b){const x=String(a||''),y=String(b||'');if(!x||!y||x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
function scalar(v){return v===null||['string','number','boolean'].includes(typeof v);}
function signals(data){
  const out=[],seen=new Set(),wanted=/(print|status|state|bill.?code|waybill|tx.?logistic|serial|order.?type|service.?type|operate.?type|source.?code|sorting|sort.?code)/i;
  const walk=(node,path='',depth=0)=>{if(depth>8||node==null)return;if(Array.isArray(node)){node.slice(0,30).forEach((v,i)=>walk(v,`${path}[${i}]`,depth+1));return;}if(typeof node!=='object'||seen.has(node))return;seen.add(node);for(const [k,v] of Object.entries(node)){const p=path?`${path}.${k}`:k;if(wanted.test(k)&&scalar(v))out.push({path:p,value:clean(v,300)});else if(v&&typeof v==='object')walk(v,p,depth+1);}};
  walk(data);return out.slice(0,160);
}
function shape(data){if(Array.isArray(data))return {type:'array',length:data.length,firstKeys:data[0]&&typeof data[0]==='object'?Object.keys(data[0]).slice(0,100):[]};if(data&&typeof data==='object')return {type:'object',keys:Object.keys(data).slice(0,120)};return {type:typeof data};}
async function signed(path,payload,secrets){
  try{const r=await __jtApiInternals.signedPost(path,payload,secrets,{fetcher:fetch});return {httpStatus:r.response.status,code:clean(r.code,100),message:clean(r.message,500),success:__jtApiInternals.success(r),data:r.data};}
  catch(e){return {httpStatus:Number(e?.status)||0,code:clean(e?.code,100),message:clean(e?.message,500),success:false,data:null};}
}
async function lookup(serialNumber,secrets,cred){
  const base={sourceCode:cred.fields.sourceCode,command:1,serialNumber:[serialNumber]};
  const attempts=[];
  if(cred.enterpriseReady){const r=await signed(__jtApiInternals.GET_ORDERS_PATH,__jtApiInternals.withEnterprise(base,cred.fields),secrets);attempts.push({auth:'enterprise',httpStatus:r.httpStatus,code:r.code,message:r.message,success:r.success,shape:shape(r.data),signals:signals(r.data)});if(r.success)return attempts;}
  const r=await signed(__jtApiInternals.GET_ORDERS_PATH,base,secrets);attempts.push({auth:'developer',httpStatus:r.httpStatus,code:r.code,message:r.message,success:r.success,shape:shape(r.data),signals:signals(r.data)});return attempts;
}
async function invalidEndpointProbe(path,secrets,cred){
  const base={sourceCode:cred.fields.sourceCode,txlogisticId:'',orderType:'INVALID',serviceType:'INVALID',operateType:999,receiver:{},sender:{},items:[]};
  const payload=cred.enterpriseReady?__jtApiInternals.withEnterprise(base,cred.fields):base;
  const r=await signed(path,payload,secrets);
  return {path,httpStatus:r.httpStatus,code:r.code,message:r.message,success:r.success,shape:shape(r.data),signals:signals(r.data),deliberatelyInvalid:true,canCreateOrder:false};
}
async function diagnostic(request,env){
  if(env.APP_ENV!=='preview')return json({error:'Not found'},404);
  if(!env.JT_DIAGNOSTIC_TOKEN||!safeEq(request.headers.get('x-kun-diagnostic-token'),env.JT_DIAGNOSTIC_TOKEN))return json({error:'Not found'},404);
  const {results=[]}=await env.DB.prepare("SELECT id,client_id,awb,history,created_at FROM orders WHERE history LIKE '%jt_shipment_created%' ORDER BY created_at DESC LIMIT 10").all();
  const connection=await env.DB.prepare("SELECT id,client_id,status,external_store_id FROM store_connections WHERE provider='jt' AND status='connected' ORDER BY updated_at DESC LIMIT 1").first();
  if(!connection)return json({ok:true,readOnly:true,error:'No active J&T connection',orders:[]});
  const secrets=await readConnectionSecrets(env,connection.client_id,connection.id),cred=jtCredentials(secrets),orders=[];
  for(const row of results){
    if(String(row.client_id)!==String(connection.client_id))continue;
    const history=parseArray(row.history),created=[...history].reverse().find(x=>x?.type==='jt_shipment_created'),txlogisticId=clean(created?.txlogisticId||row.id,180),awb=clean(row.awb||created?.awb,180);
    orders.push({orderId:row.id,awb,txlogisticId,createdAt:created?.at||row.created_at||null,hasInternalPrintedEvent:history.some(x=>x?.type==='jt_label_printed'&&(!x.awb||String(x.awb)===awb)),getOrders:await lookup(txlogisticId,secrets,cred)});
  }
  const endpointProbes={addOrder:await invalidEndpointProbe(__jtApiInternals.ADD_ORDER_PATH,secrets,cred),createOrder:await invalidEndpointProbe(__jtApiInternals.CREATE_ORDER_PATH,secrets,cred)};
  return json({ok:true,readOnly:true,createdNoOrders:true,printedNoLabels:true,invalidProbeCannotCreate:true,connection:{id:connection.id,clientId:connection.client_id,status:connection.status,externalStoreId:connection.external_store_id||null,enterpriseReady:cred.enterpriseReady,sourceCodePresent:Boolean(cred.fields.sourceCode)},orders,endpointProbes});
}
export default {fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/__internal/jt/getorders-diagnostic'&&request.method==='POST')return diagnostic(request,env);return app.fetch(request,env,ctx);},scheduled(controller,env,ctx){return app.scheduled?.(controller,env,ctx);}};
