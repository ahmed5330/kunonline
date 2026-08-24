import commerceV23 from './index-commerce-v23.js';

const json=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...h}});

async function me(request,env,ctx){
  const u=new URL(request.url);u.pathname='/api/me';u.search='';
  const r=await commerceV23.fetch(new Request(u,{method:'GET',headers:request.headers}),env,ctx);
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.error||'محتاج تسجّل دخول'),{status:r.status||401});
  return d;
}

async function ensurePreviewClient(request,env,ctx){
  if(env.APP_ENV!=='preview')return json({error:'المسار متاح على Preview فقط'},404);
  const current=await me(request,env,ctx);
  if(current.role!=='admin')return json({error:'المسار متاح للأدمن فقط'},403);
  const row=await env.DB.prepare('SELECT json FROM state WHERE id=1').first();
  let state={agency:{name:'كن أونلاين'},clients:[],entries:[],funding:[]};
  if(row?.json){try{state=JSON.parse(row.json);}catch{}}
  state.agency=state.agency||{name:'كن أونلاين'};
  state.clients=Array.isArray(state.clients)?state.clients:[];
  state.entries=Array.isArray(state.entries)?state.entries:[];
  state.funding=Array.isArray(state.funding)?state.funding:[];
  let client=state.clients.find(c=>c&&c.status==='active')||state.clients[0];
  if(!client){
    client={
      id:'PREVIEW-STORE-001',
      name:'Preview Store',
      status:'active',
      currency:'EGP',
      market:'EG',
      deliveryRateMode:'auto',
      taxEnabled:false,
      taxRate:14,
      adminFee:0,
      inventoryEnabled:true,
      customerServiceEnabled:true,
      createdAt:new Date().toISOString()
    };
    state.clients.push(client);
    const now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO state (id,json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at`).bind(JSON.stringify(state),now).run();
  }
  return json({ok:true,clientId:client.id,name:client.name,created:client.id==='PREVIEW-STORE-001'});
}

async function fetchV24(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/preview/ensure-client'&&request.method.toUpperCase()==='POST'){
    try{return await ensurePreviewClient(request,env,ctx);}catch(e){return json({error:e.message||'تعذر تجهيز المتجر'},e.status||500);}
  }
  return commerceV23.fetch(request,env,ctx);
}

export default {fetch:fetchV24,scheduled(controller,env,ctx){return commerceV23.scheduled?.(controller,env,ctx);}};
