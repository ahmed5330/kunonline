import production from './index-production-sync.js';
import {readConnectionSecrets} from './integration-provider-validation.js';
import {jtCredentials,__jtApiInternals} from './jt-express-eg-api.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=600)=>String(value??'').trim().slice(0,max);
const parseArray=value=>{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
function constantTimeEqual(a,b){const x=String(a||''),y=String(b||'');if(!x||!y||x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}
function scalar(value){return value===null||['string','number','boolean'].includes(typeof value);}
function printSignals(value){
  const out=[],seen=new Set(),wanted=/(print|status|state|bill.?code|waybill|tx.?logistic|order.?type|service.?type|operate.?type|source.?code)/i;
  function walk(node,path='',depth=0){
    if(depth>7||node===null||node===undefined)return;
    if(Array.isArray(node)){node.slice(0,20).forEach((item,index)=>walk(item,`${path}[${index}]`,depth+1));return;}
    if(typeof node!=='object'||seen.has(node))return;seen.add(node);
    for(const [key,val] of Object.entries(node)){
      const next=path?`${path}.${key}`:key;
      if(wanted.test(key)&&scalar(val))out.push({path:next,value:clean(val,300)});
      else if(val&&typeof val==='object')walk(val,next,depth+1);
    }
  }
  walk(value);
  return out.slice(0,120);
}
function responseShape(data){
  if(Array.isArray(data))return {type:'array',length:data.length,firstKeys:data[0]&&typeof data[0]==='object'?Object.keys(data[0]).slice(0,80):[]};
  if(data&&typeof data==='object')return {type:'object',keys:Object.keys(data).slice(0,100)};
  return {type:typeof data};
}
async function connectionFor(env,clientId){
  const row=await env.DB.prepare("SELECT id,status,external_store_id FROM store_connections WHERE client_id=? AND provider='jt' ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'configured' THEN 1 ELSE 2 END,updated_at DESC,created_at DESC LIMIT 1").bind(clientId).first();
  if(!row)throw new Error('No J&T connection');
  return {row,secrets:await readConnectionSecrets(env,clientId,row.id)};
}
async function signedResult(path,payload,secrets){
  try{
    const result=await __jtApiInternals.signedPost(path,payload,secrets,{fetcher:fetch});
    return {ok:true,httpStatus:result.response.status,code:result.code||null,message:clean(result.message,500),success:__jtApiInternals.success(result),data:result.data};
  }catch(error){return {ok:false,httpStatus:Number(error?.status)||0,code:error?.code||null,message:clean(error?.message,500),success:false,data:null};}
}
async function getExistingOrder(serialNumber,secrets,cred){
  const base={sourceCode:cred.fields.sourceCode,command:1,serialNumber:[serialNumber]};
  let result=await signedResult(__jtApiInternals.GET_ORDERS_PATH,base,secrets);
  if(!result.success&&cred.enterpriseReady)result=await signedResult(__jtApiInternals.GET_ORDERS_PATH,__jtApiInternals.withEnterprise(base,cred.fields),secrets);
  return {httpStatus:result.httpStatus,code:result.code,message:result.message,success:result.success,shape:responseShape(result.data),signals:printSignals(result.data)};
}
async function endpointProbe(path,secrets,cred){
  const deliberatelyInvalid={sourceCode:cred.fields.sourceCode,txlogisticId:'',orderType:'1',serviceType:'01',operateType:1};
  const payload=cred.enterpriseReady?__jtApiInternals.withEnterprise(deliberatelyInvalid,cred.fields):deliberatelyInvalid;
  const result=await signedResult(path,payload,secrets);
  return {path,httpStatus:result.httpStatus,code:result.code,message:result.message,success:result.success,shape:responseShape(result.data),signals:printSignals(result.data)};
}
async function diagnostic(request,env){
  if(!env.JT_DIAGNOSTIC_TOKEN||!constantTimeEqual(request.headers.get('x-kun-diagnostic-token'),env.JT_DIAGNOSTIC_TOKEN))return json({error:'Not found'},404);
  const counts=await env.DB.prepare("SELECT COUNT(*) total_orders, SUM(CASE WHEN COALESCE(TRIM(awb),'')<>'' THEN 1 ELSE 0 END) orders_with_awb, SUM(CASE WHEN COALESCE(TRIM(awb),'')<>'' AND history LIKE '%jt_shipment_created%' THEN 1 ELSE 0 END) awb_with_jt_created_history FROM orders").first();
  const {results=[]}=await env.DB.prepare("SELECT id,client_id,state,awb,history,created_at FROM orders WHERE COALESCE(TRIM(awb),'')<>'' ORDER BY created_at DESC LIMIT 12").all();
  const {results:connectionRows=[]}=await env.DB.prepare("SELECT id,client_id,status,external_store_id,updated_at FROM store_connections WHERE provider='jt' ORDER BY updated_at DESC LIMIT 20").all();
  const rows=[],cache=new Map();
  for(const row of results){
    const history=parseArray(row.history),event=[...history].reverse().find(item=>item?.type==='jt_shipment_created'),serialNumber=clean(event?.txlogisticId||row.id,160);
    let connection=cache.get(row.client_id);
    if(!connection){try{connection=await connectionFor(env,row.client_id);cache.set(row.client_id,connection);}catch(error){rows.push({orderId:row.id,state:row.state,awb:clean(row.awb,160),serialNumber,createdAt:row.created_at||null,historyTypes:[...new Set(history.map(x=>clean(x?.type,100)).filter(Boolean))].slice(-20),error:clean(error.message)});continue;}}
    const cred=jtCredentials(connection.secrets),lookup=await getExistingOrder(serialNumber,connection.secrets,cred);
    rows.push({orderId:row.id,state:row.state,awb:clean(row.awb,160),serialNumber,createdAt:row.created_at||null,historyTypes:[...new Set(history.map(x=>clean(x?.type,100)).filter(Boolean))].slice(-20),connectionStatus:connection.row.status,connectionExternalStoreId:clean(connection.row.external_store_id,160),hasEnterpriseCredentials:cred.enterpriseReady,lookup});
  }
  let probeConnection=[...cache.values()][0]||null;
  if(!probeConnection&&connectionRows.length){try{probeConnection=await connectionFor(env,connectionRows[0].client_id);}catch{}}
  let endpointProbes=null;
  if(probeConnection){
    const cred=jtCredentials(probeConnection.secrets);
    endpointProbes={addOrder:await endpointProbe(__jtApiInternals.ADD_ORDER_PATH,probeConnection.secrets,cred),createOrder:await endpointProbe(__jtApiInternals.CREATE_ORDER_PATH,probeConnection.secrets,cred)};
  }
  return json({ok:true,readOnly:true,createdNoOrders:true,printedNoLabels:true,checkedAt:new Date().toISOString(),counts:{totalOrders:Number(counts?.total_orders||0),ordersWithAwb:Number(counts?.orders_with_awb||0),awbWithJtCreatedHistory:Number(counts?.awb_with_jt_created_history||0)},connections:connectionRows.map(row=>({id:row.id,clientId:row.client_id,status:row.status,externalStoreId:clean(row.external_store_id,160),updatedAt:row.updated_at||null})),orders:rows,endpointProbes});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/__internal/jt/print-state-diagnostic'&&request.method==='POST')return diagnostic(request,env);
    return production.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){return production.scheduled?.(controller,env,ctx);}
};
