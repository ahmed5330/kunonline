import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const phoneDigits=value=>String(value??'').replace(/\D+/g,'').slice(-15);
const phoneSql="REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+','')";

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}

export async function handleCollaborationOrderSearch({request,env,ctx,delegate}){
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname!=='/api/collaboration/orders/search')return null;
  try{
    const me=await currentUser(request,env,ctx,delegate);
    const clientId=resolveTenant(me,url.searchParams.get('clientId')||me?.clientId||null);
    const storeId=clean(url.searchParams.get('storeId'));
    if(!storeId)return json({error:'اختار متجر/فرع قبل البحث عن الأوردر',code:'STORE_SELECTION_REQUIRED'},400);
    await resolveStoreScope(env,me,clientId,storeId,{write:false});

    const q=clean(url.searchParams.get('q'),120);
    let rows=[];
    if(!q){
      const result=await env.DB.prepare(`
        SELECT id,name,phone,state,total
        FROM orders
        WHERE client_id=? AND store_id=?
        ORDER BY rowid DESC
        LIMIT 20
      `).bind(clientId,storeId).all();
      rows=result.results||[];
    }else{
      const like=`%${q}%`,prefix=`${q}%`,digits=phoneDigits(q),phoneLike=digits?`%${digits}%`:'';
      if(digits){
        const result=await env.DB.prepare(`
          SELECT id,name,phone,state,total
          FROM orders
          WHERE client_id=? AND store_id=? AND (
            id LIKE ? COLLATE NOCASE OR COALESCE(name,'') LIKE ? COLLATE NOCASE OR COALESCE(phone,'') LIKE ? OR ${phoneSql} LIKE ?
          )
          ORDER BY CASE
            WHEN id=? THEN 0
            WHEN ${phoneSql}=? THEN 1
            WHEN id LIKE ? COLLATE NOCASE THEN 2
            WHEN ${phoneSql} LIKE ? THEN 3
            WHEN COALESCE(name,'') LIKE ? COLLATE NOCASE THEN 4
            ELSE 5 END,
            rowid DESC
          LIMIT 20
        `).bind(clientId,storeId,like,like,like,phoneLike,q,digits,prefix,`${digits}%`,like).all();
        rows=result.results||[];
      }else{
        const result=await env.DB.prepare(`
          SELECT id,name,phone,state,total
          FROM orders
          WHERE client_id=? AND store_id=? AND (
            id LIKE ? COLLATE NOCASE OR COALESCE(name,'') LIKE ? COLLATE NOCASE
          )
          ORDER BY CASE
            WHEN id=? THEN 0
            WHEN id LIKE ? COLLATE NOCASE THEN 1
            WHEN COALESCE(name,'') LIKE ? COLLATE NOCASE THEN 2
            ELSE 3 END,
            rowid DESC
          LIMIT 20
        `).bind(clientId,storeId,like,like,q,prefix,like).all();
        rows=result.results||[];
      }
    }

    return json({ok:true,orders:rows.map(row=>({id:String(row.id),name:row.name||'',phone:row.phone||'',state:row.state||'',total:row.total??null}))});
  }catch(error){
    return json({error:error?.message||'تعذر البحث عن الأوردر',code:error?.code||'COLLAB_ORDER_SEARCH_FAILED'},Number(error?.status)||500);
  }
}
