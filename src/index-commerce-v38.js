import safety from './index-commerce-v38-safety.js';
import core from './index-commerce-v38-core.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const authText=value=>/(محتاج\s+تسج|تسجيل\s+الدخول|AUTH_REQUIRED|unauthori[sz]ed|authentication\s+required)/i.test(String(value??''));
const isAuthFailure=value=>value?.code==='AUTH_REQUIRED'||authText(value?.error||value?.message);

async function fetchV38(request,env,ctx){
  try{
    const response=await safety.fetch(request,env,ctx);
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
