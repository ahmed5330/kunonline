/* kun online v23 — central client/store context for Preview UI */
(function(){
  const nativeFetch=window.fetch.bind(window);
  const CLIENT_SCOPED_GET=[
    '/api/state','/api/customers','/api/suppliers','/api/purchase-orders','/api/finance','/api/audit-log',
    '/api/pos/sessions','/api/pos/sales','/api/procurement/invoices','/api/procurement/payments',
    '/api/procurement/returns','/api/procurement/supplier-balances','/api/inbox/conversations',
    '/api/campaigns','/api/ai/insights','/api/ai-actions','/api/approvals','/api/execution-jobs',
    '/api/notifications','/api/workflows','/api/store-connections','/api/support-tickets','/api/integrations/readiness',
    '/api/products/stock-log','/api/onboarding/status','/api/team-members','/api/users','/api/stores','/api/store-access',
    '/api/tenant/overview','/api/system-status','/api/usage','/api/billing','/api/integrations/health',
    '/api/profit-intelligence','/api/cod-reconciliation','/api/transactions','/api/orders','/api/products',
    '/api/variants','/api/coupons','/api/performance','/api/dashboard','/api/ai/business-brief'
  ];
  const CLIENT_SCOPED_WRITES=[
    '/api/orders','/api/customers','/api/products','/api/suppliers','/api/purchase-orders',
    '/api/workflows','/api/campaigns','/api/ai-actions','/api/procurement/invoices',
    '/api/procurement/payments','/api/procurement/returns','/api/pos/sessions','/api/pos/sales','/api/integrations/connections','/api/store-connections',
    '/api/support-tickets','/api/users','/api/store-access','/api/stores','/api/ai/insights','/api/approvals',
    '/api/execution-jobs','/api/cod-reconciliation','/api/integration-secrets','/api/variants','/api/coupons','/api/transactions'
  ];
  const STORE_SCOPED=[
    '/api/state','/api/orders','/api/customers','/api/products','/api/variants','/api/coupons','/api/suppliers','/api/performance',
    '/api/transactions','/api/purchase-orders','/api/procurement','/api/pos','/api/campaigns',
    '/api/inbox','/api/cod-reconciliation','/api/finance','/api/profit-intelligence','/api/analytics',
    '/api/workflows','/api/approvals','/api/execution-jobs','/api/notifications','/api/audit-log',
    '/api/ai/insights','/api/ai-actions','/api/dashboard','/api/ai/business-brief'
  ];
  let cached='',resolving=null,storeCached='',storeResolving=null,storeLoadedFor='';
  const fromState=()=>{try{return String((typeof activeClientId!=='undefined'&&activeClientId)||(typeof state!=='undefined'&&state?.businessClients?.[0]?.id)||(typeof state!=='undefined'&&state?.orders?.find?.(x=>x?.clientId||x?.client_id)?.clientId)||(typeof state!=='undefined'&&state?.orders?.find?.(x=>x?.client_id)?.client_id)||'');}catch{return '';}};
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
        setTimeout(()=>{try{if(typeof load==='function')Promise.resolve(load()).catch(()=>{});}catch{}},0);
        return id;
      }
    }
    return '';
  }
  async function resolve(){if(resolving)return resolving;resolving=resolveFresh().finally(()=>{resolving=null});return resolving;}
  const scopedGet=path=>CLIENT_SCOPED_GET.some(p=>path===p||path.startsWith(p+'/'));
  const scopedWrite=path=>CLIENT_SCOPED_WRITES.some(p=>path===p||path.startsWith(p+'/'));
  const storeScoped=path=>STORE_SCOPED.some(p=>path===p||path.startsWith(p+'/'));
  const storeKey=id=>`kunActiveStore:${id}`;
  const html=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderStorePicker(context,id){
    const select=document.getElementById('storeBtn');if(!select)return;
    const stores=context?.stores||[],saved=localStorage.getItem(storeKey(id))||'';
    let selected=stores.some(s=>String(s.id)===saved)?saved:'';
    if(!context?.allStores&&!selected&&stores.length)selected=String(stores[0].id);
    storeCached=selected;
    select.innerHTML=(context?.allStores?'<option value="">كل المتاجر</option>':'')+stores.map(s=>`<option value="${html(s.id)}">${html(s.name||s.code||s.id)}</option>`).join('');
    select.value=selected;
    select.disabled=!context?.allStores&&stores.length<=1;
    select.onchange=()=>{storeCached=select.value;if(storeCached)localStorage.setItem(storeKey(id),storeCached);else localStorage.removeItem(storeKey(id));location.reload();};
    document.documentElement.dataset.storeContext=storeCached?'scoped':'all';
  }
  async function resolveStore(id){
    if(!id)return '';
    if(storeLoadedFor===id)return storeCached;
    if(storeResolving)return storeResolving;
    storeResolving=nativeFetch(`/api/my-store-context?clientId=${encodeURIComponent(id)}`,{credentials:'include'})
      .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'تعذر تحميل الفروع');renderStorePicker(d,id);storeLoadedFor=id;return storeCached;})
      .catch(()=>{storeCached='';return '';}).finally(()=>{storeResolving=null});
    return storeResolving;
  }
  window.kunClientId=resolve;
  window.kunStoreId=async()=>resolveStore(await resolve());
  window.fetch=async function(input,init={}){
    let url=typeof input==='string'?input:input?.url||'';
    if(!url||!url.startsWith('/api/'))return nativeFetch(input,init);
    const method=String(init.method||'GET').toUpperCase(),u=new URL(url,location.origin),id=await resolve(),storeId=storeScoped(u.pathname)?await resolveStore(id):'';
    if(id&&method==='GET'&&scopedGet(u.pathname)&&!u.searchParams.has('clientId')){u.searchParams.set('clientId',id);url=u.pathname+u.search+u.hash;}
    if(storeId&&method==='GET'&&storeScoped(u.pathname)&&!u.searchParams.has('storeId')){u.searchParams.set('storeId',storeId);url=u.pathname+u.search+u.hash;}
    if(id&&method!=='GET'&&scopedWrite(u.pathname)){
      if(init.body&&typeof init.body==='string'){
        try{const body=JSON.parse(init.body);if(body&&typeof body==='object'&&!Array.isArray(body)){if(!body.clientId)body.clientId=id;if(storeId&&storeScoped(u.pathname))body.storeId=storeId;init={...init,body:JSON.stringify(body)};}}catch{}
      }else if(!init.body){init={...init,headers:{'Content-Type':'application/json',...(init.headers||{})},body:JSON.stringify({clientId:id,...(storeId&&storeScoped(u.pathname)?{storeId}:{})})};}
    }
    const response=await nativeFetch(typeof input==='string'?url:new Request(url,input),init);
    if(response.status===404){
      const data=await response.clone().json().catch(()=>null);
      if(data?.error==='مسار غير معروف'){
        const headers=new Headers(response.headers);headers.set('Content-Type','application/json; charset=utf-8');
        return new Response(JSON.stringify({...data,error:`مسار غير معروف: ${u.pathname}`,path:u.pathname,method}),{status:404,statusText:response.statusText,headers});
      }
    }
    return response;
  };
  document.addEventListener('DOMContentLoaded',async()=>{const id=await resolve();await resolveStore(id);});
})();
