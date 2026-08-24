/* kun online v21 — central client/store context for Preview UI */
(function(){
  const nativeFetch=window.fetch.bind(window);
  const CLIENT_SCOPED_GET=[
    '/api/customers','/api/suppliers','/api/purchase-orders','/api/finance','/api/audit-log',
    '/api/pos/sessions','/api/pos/sales','/api/procurement/invoices','/api/procurement/payments',
    '/api/procurement/returns','/api/procurement/supplier-balances','/api/inbox/conversations',
    '/api/campaigns','/api/ai/insights','/api/ai-actions','/api/approvals','/api/execution-jobs',
    '/api/notifications','/api/store-connections','/api/support-tickets','/api/integrations/readiness'
  ];
  const CLIENT_SCOPED_WRITES=[
    '/api/orders','/api/customers','/api/products','/api/suppliers','/api/purchase-orders',
    '/api/pos/sessions','/api/integrations/connections'
  ];
  let cached='';
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
  async function resolve(){
    const local=fromState();if(local){cached=local;return local;}if(cached)return cached;
    try{
      const me=await nativeFetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json():null);
      if(me?.clientId){cached=String(me.clientId);return cached;}
      const s=await nativeFetch('/api/state',{credentials:'include'}).then(r=>r.ok?r.json():null);
      const id=s?.clients?.[0]?.id||s?.state?.clients?.[0]?.id||s?.orders?.find?.(x=>x?.clientId||x?.client_id)?.clientId||s?.orders?.find?.(x=>x?.client_id)?.client_id||'';
      if(id){cached=String(id);try{if(typeof activeClientId!=='undefined')activeClientId=cached;}catch{} }
      return cached;
    }catch{return '';}
  }
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
  document.addEventListener('DOMContentLoaded',()=>{resolve().then(id=>{if(id)document.documentElement.dataset.clientContext='ready';});});
})();
