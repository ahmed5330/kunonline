import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const authText=value=>/(محتاج\s+تسج|تسجيل\s+الدخول|AUTH_REQUIRED|unauthori[sz]ed|authentication\s+required)/i.test(String(value??''));
const isAuthFailure=value=>value?.code==='AUTH_REQUIRED'||authText(value?.error||value?.message);
function normalizeDashboardContract(data){
  if(!data||typeof data!=='object')return data;
  const resolved=data?.costing?.source==='current_inventory_resolved'||data?.overview?.productCostSource==='current_inventory_resolved';
  if(!resolved)return data;
  return {...data,overview:{...(data.overview||{}),productCostSource:'current_inventory'},costing:{...(data.costing||{}),source:'current_inventory',resolution:'current_inventory_resolved'}};
}

async function fetchV38(request,env,ctx){
  try{
    const url=new URL(request.url),dashboardContract=request.method==='GET'&&url.pathname==='/api/dashboard';
    const response=await safety.fetch(request,env,ctx);
    if(response.ok&&dashboardContract){
      const data=await response.clone().json().catch(()=>null),normalized=normalizeDashboardContract(data);
      if(normalized!==data)return json(normalized,response.status);
    }
    if(response.status!==500)return response;
    const data=await response.clone().json().catch(()=>null);
    if(isAuthFailure(data))return json({...data,code:'AUTH_REQUIRED'},401);
    return response;
  }catch(error){
    if(isAuthFailure(error))return json({error:error?.message||'محتاج تسجّل دخول',code:'AUTH_REQUIRED'},401);
    throw error;
  }
}

void core;
export {SyncEntrypoint} from './index-commerce-v38-safety.js';
export default {fetch:fetchV38,scheduled(controller,env,ctx){return safety.scheduled?.(controller,env,ctx);}};
