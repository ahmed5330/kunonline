import {resolveTenant} from './access-control.js';
import {resolveStoreScope} from './store-scope.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const phoneDigits=value=>String(value??'').replace(/\D+/g,'').slice(-15);
const normalizeText=value=>String(value??'')
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
  .replace(/[أإآٱ]/g,'ا')
  .replace(/ى/g,'ي')
  .replace(/ة/g,'ه')
  .replace(/ؤ/g,'و')
  .replace(/ئ/g,'ي')
  .toLowerCase()
  .replace(/\s+/g,' ')
  .trim();
const phoneSql="REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+','')";
const normalizedNameSql="REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(name,''),'أ','ا'),'إ','ا'),'آ','ا'),'ٱ','ا'),'ى','ي'),'ة','ه'),'ؤ','و'),'ئ','ي')";

async function currentUser(request,env,ctx,delegate){
  const url=new URL(request.url);url.pathname='/api/me';url.search='';
  const response=await delegate.fetch(new Request(url,{method:'GET',headers:request.headers}),env,ctx);
  const me=await response.json().catch(()=>({}));
  if(!response.ok||!me?.role)throw Object.assign(new Error(me?.error||'محتاج تسجّل دخول'),{status:response.ok?401:response.status,code:'AUTH_REQUIRED'});
  return me;
}

function classify(row,{q,normalizedQuery,digits}){
  const id=String(row.id||''),name=String(row.name||''),phone=String(row.phone||''),normalizedName=normalizeText(name),normalizedPhone=phoneDigits(phone);
  const raw=q.toLowerCase(),idLower=id.toLowerCase();
  if((raw&&idLower===raw)||(normalizedQuery&&normalizedName===normalizedQuery)||(digits&&normalizedPhone===digits))return 'exact';
  if((raw&&idLower.startsWith(raw))||(normalizedQuery&&normalizedName.startsWith(normalizedQuery))||(digits&&normalizedPhone.startsWith(digits)))return 'prefix';
  return 'similar';
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

    const q=clean(url.searchParams.get('q'),120),normalizedQuery=normalizeText(q),digits=phoneDigits(q);
    let rows=[];
    if(!q){
      const result=await env.DB.prepare(`
        SELECT id,name,phone,state,total
        FROM orders
        WHERE client_id=? AND store_id=?
        ORDER BY rowid DESC
        LIMIT 30
      `).bind(clientId,storeId).all();
      rows=result.results||[];
    }else{
      const like=`%${q}%`,prefix=`${q}%`,normalizedLike=`%${normalizedQuery}%`,normalizedPrefix=`${normalizedQuery}%`,phoneLike=digits?`%${digits}%`:'',phonePrefix=digits?`${digits}%`:'';
      if(digits){
        const result=await env.DB.prepare(`
          SELECT id,name,phone,state,total
          FROM orders
          WHERE client_id=? AND store_id=? AND (
            id LIKE ? COLLATE NOCASE
            OR COALESCE(name,'') LIKE ? COLLATE NOCASE
            OR ${normalizedNameSql} LIKE ? COLLATE NOCASE
            OR COALESCE(phone,'') LIKE ?
            OR ${phoneSql} LIKE ?
          )
          ORDER BY CASE
            WHEN id=? COLLATE NOCASE THEN 0
            WHEN ${phoneSql}=? THEN 1
            WHEN ${normalizedNameSql}=? COLLATE NOCASE THEN 2
            WHEN id LIKE ? COLLATE NOCASE THEN 3
            WHEN ${phoneSql} LIKE ? THEN 4
            WHEN ${normalizedNameSql} LIKE ? COLLATE NOCASE THEN 5
            WHEN COALESCE(name,'') LIKE ? COLLATE NOCASE THEN 6
            ELSE 7 END,
            rowid DESC
          LIMIT 100
        `).bind(clientId,storeId,like,like,normalizedLike,like,phoneLike,q,digits,normalizedQuery,prefix,phonePrefix,normalizedPrefix,prefix).all();
        rows=result.results||[];
      }else{
        const result=await env.DB.prepare(`
          SELECT id,name,phone,state,total
          FROM orders
          WHERE client_id=? AND store_id=? AND (
            id LIKE ? COLLATE NOCASE
            OR COALESCE(name,'') LIKE ? COLLATE NOCASE
            OR ${normalizedNameSql} LIKE ? COLLATE NOCASE
          )
          ORDER BY CASE
            WHEN id=? COLLATE NOCASE THEN 0
            WHEN ${normalizedNameSql}=? COLLATE NOCASE THEN 1
            WHEN id LIKE ? COLLATE NOCASE THEN 2
            WHEN ${normalizedNameSql} LIKE ? COLLATE NOCASE THEN 3
            WHEN COALESCE(name,'') LIKE ? COLLATE NOCASE THEN 4
            ELSE 5 END,
            rowid DESC
          LIMIT 100
        `).bind(clientId,storeId,like,like,normalizedLike,q,normalizedQuery,prefix,normalizedPrefix,prefix).all();
        rows=result.results||[];
      }
    }

    return json({
      ok:true,
      query:q,
      orders:rows.map(row=>({id:String(row.id),name:row.name||'',phone:row.phone||'',state:row.state||'',total:row.total??null,match:q?classify(row,{q,normalizedQuery,digits}):'recent'})),
      truncated:Boolean(q&&rows.length>=100)
    });
  }catch(error){
    return json({error:error?.message||'تعذر البحث عن الأوردر',code:error?.code||'COLLAB_ORDER_SEARCH_FAILED'},Number(error?.status)||500);
  }
}
