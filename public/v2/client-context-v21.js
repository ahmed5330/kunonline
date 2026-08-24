/* kun online v21 — central client/store context for Preview UI */
(function(){
  const nativeFetch=window.fetch.bind(window);
  const CLIENT_SCOPED_GET=[
    '/api/customers','/api/suppliers','/api/purchase-orders','/api/finance','/api/audit-log',
    '/api/pos/sessions','/api/pos/sales','/api/procurement/invoices','/api/procurement/payments',
    '/api/procurement/returns','/api/procurement/supplier-balances','/api/inbox/conversations',
    '/api/campaigns','/api/ai/insights','/api/ai-actions','/api/approvals','/api/execution-jobs',
    '/api/notifications','/api/store-connections','/api/support-tickets','/api/integrations/readiness',
    '/api/products/stock-log'
  ];
  const CLIENT_SCOPED_WRITES=[
    '/api/orders','/api/customers','/api/products','/api/suppliers','/api/purchase-orders',
    '/api/pos/sessions','/api/integrations/connections'
  ];
  let cached='',resolving=null;
  const fromState=()=>{
    try{
      return String(
        (typeof activeClientId!=='undefined'&&activeClientId)||
        (typeof state!=='undefined'&&state?.businessClients?.[0]?.id)||
        (typeof state!=='undefined'&&state?.orders?.find?.(x=>x?.clientId||x?.client_id)?.clientId)||
        (typeof state!=='undefined'&&state?.orders?.find?.(x=>x?.client_id)?.client_id)||''
      );
    }catch{return '';}
  };
  const apply=id=>{if(!id)return '';cached=String(id);try{if(typeof activeClientId!=='undefined')activeClientId=cached;}catch{};document.documentElement.dataset.clientContext='ready';return cached;};
  async function resolveFresh(){
    const local=fromState();if(local)return apply(local);if(cached)return cached;
    const me=await nativeFetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(me?.clientId)return apply(me.clientId);
    let s=await nativeFetch('/api/state',{credentials:'include'}).then(r=>r.ok?r.json():null).catch(()=>null);
    let id=s?.clients?.[0]?.id||s?.state?.clients?.[0]?.id||s?.orders?.find?.(x=>x?.clientId||x?.client_id)?.clientId||s?.orders?.find?.(x=>x?.client_id)?.client_id||'';
    if(id)return apply(id);
    if(me?.role==='admin'){
      const boot=await nativeFetch('/api/preview/ensure-client',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.ok?r.json():null).catch(()=>null);
      if(boot?.clientId){
        id=apply(boot.clientId);
        try{if(typeof load==='function')await load();}catch{}
        return id;
      }
    }
    return '';
  }
  async function resolve(){if(resolving)return resolving;resolving=resolveFresh().finally(()=>{resolving=null});return resolving;}
  const scopedGet=path=>CLIENT_SCOPED_GET.some(p=>path===p||path.startsWith(p+'/'));
  const scopedWrite=path=>CLIENT_SCOPED_WRITES.some(p=>path===p||path.startsWith(p+'/'));
  window.kunClientId=resolve;
  window.fetch=async function(input,init={}){
    let url=typeof input==='string'?input:input?.url||'';
    if(!url||!url.startsWith('/api/'))return nativeFetch(input,init);
    const method=String(init.method||'GET').toUpperCase();
    const u=new URL(url,location.origin);
    const id=await resolve();
    if(id&&method==='GET'&&scopedGet(u.pathname)&&!u.searchParams.has('clientId')){
      u.searchParams.set('clientId',id);url=u.pathname+u.search+u.hash;
    }
    if(id&&method!=='GET'&&scopedWrite(u.pathname)&&init.body&&typeof init.body==='string'){
      try{const body=JSON.parse(init.body);if(body&&typeof body==='object'&&!Array.isArray(body)&&!body.clientId){body.clientId=id;init={...init,body:JSON.stringify(body)};}}catch{}
    }
    return nativeFetch(typeof input==='string'?url:new Request(url,input),init);
  };
  document.addEventListener('DOMContentLoaded',()=>{resolve();});
})();
