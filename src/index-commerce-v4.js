import commerceV3 from './index-commerce-v3.js';
import {requirePermission,permissionSnapshot} from './access-control.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});

async function currentUser(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV3.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data?.role)throw Object.assign(new Error(data?.error||'محتاج تسجّل دخول'),{status:!r.ok?r.status:401});
  return data;
}

function requiredRule(path,method){
  if(path==='/api/purchase-orders'&&method==='POST')return ['procurement','write'];
  if(/^\/api\/purchase-orders\/[^/]+\/receive$/.test(path)&&method==='POST')return ['procurement','write'];
  if(path==='/api/workflows'&&method==='POST')return ['automation','write'];
  if(/^\/api\/workflows\/[^/]+\/(plan|dry-run)$/.test(path)&&method==='POST')return ['automation','write'];
  if(path==='/api/audit-log'&&method==='GET')return ['audit','read'];
  if(path==='/api/profit-intelligence'&&method==='GET')return ['profit','read'];
  if(path.startsWith('/api/cod-reconciliation'))return ['cod',method==='GET'?'read':'write'];
  return null;
}

async function fetchV4(request,env,ctx){
  const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
  try{
    if(path==='/api/access/snapshot'&&method==='GET'){
      const me=await currentUser(request,env,ctx);
      return json(permissionSnapshot(me));
    }
    const rule=requiredRule(path,method);
    if(rule){
      const me=await currentUser(request,env,ctx);
      requirePermission(me,rule[0],rule[1]);
    }
    return commerceV3.fetch(request,env,ctx);
  }catch(e){
    return json({error:e.message||'حدث خطأ',code:e.code||null,resource:e.resource||null,action:e.action||null},e.status||500);
  }
}

export default {fetch:fetchV4,scheduled(controller,env,ctx){return commerceV3.scheduled?.(controller,env,ctx);}};
