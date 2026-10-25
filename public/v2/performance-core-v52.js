/* Kun Online v52.2 — lightweight shared frontend performance primitives. */
(function(){
  if(window.KunPerformanceCore)return;
  const baseFetch=window.fetch.bind(window);
  const inflight=new Map(),cache=new Map(),generations=new Map();
  const now=()=>Date.now();
  function requestInfo(input,init={}){
    const raw=typeof input==='string'?input:input?.url||'';
    const method=String(init.method||(typeof input!=='string'&&input?.method)||'GET').toUpperCase();
    let url;try{url=new URL(raw,location.origin);}catch{return {method,url:null,key:''};}
    return {method,url,key:`${method}:${url.pathname}${url.search}`};
  }
  function ttl(path){
    if(path==='/api/me')return 15000;
    if(path==='/api/navigation-access')return 8000;
    if(path==='/api/tenant/features')return 5000;
    if(path==='/api/catalog/products')return 1200;
    if(path==='/api/team-role-catalog')return 15000;
    if(path==='/api/state')return 3000;
    if(path==='/api/customer-service')return 2000;
    if(path==='/api/post-shipping')return 2000;
    if(path==='/api/dashboard')return 2000;
    return 0;
  }
  function cached(key){const hit=cache.get(key);if(!hit)return null;if(hit.expires<=now()){cache.delete(key);return null;}return hit.response.clone();}
  window.fetch=async function(input,init={}){
    const info=requestInfo(input,init),ms=info.url?.origin===location.origin&&info.method==='GET'?ttl(info.url.pathname):0;
    if(!ms)return baseFetch(input,init);
    const hit=cached(info.key);if(hit)return hit;
    const generation=generations.get(info.key)||0;
    async function current(promise){
      const response=await promise;
      if((generations.get(info.key)||0)!==generation)return window.fetch(input,init);
      return response.clone();
    }
    if(inflight.has(info.key))return current(inflight.get(info.key));
    const work=baseFetch(input,init).then(response=>{
      if(response.ok&&(generations.get(info.key)||0)===generation)cache.set(info.key,{expires:now()+ms,response:response.clone()});
      return response;
    }).finally(()=>{if(inflight.get(info.key)===work)inflight.delete(info.key);});
    inflight.set(info.key,work);
    return current(work);
  };
  function invalidate(path=''){
    for(const key of new Set([...cache.keys(),...inflight.keys()])){
      if(path&&!key.includes(`:${path}`))continue;
      generations.set(key,(generations.get(key)||0)+1);
      cache.delete(key);inflight.delete(key);
    }
  }
  function idle(fn,timeout=1200){
    if('requestIdleCallback' in window)return requestIdleCallback(fn,{timeout});
    return setTimeout(fn,Math.min(timeout,600));
  }
  const activeView=()=>document.querySelector('.nav button.active[data-view]')?.dataset.view||'';
  window.KunPerformanceCore={invalidate,idle,activeView,inflight,cache,version:'52.2'};
})();